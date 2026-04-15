import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { extname, join, resolve } from 'node:path';
import { db } from '../db.js';
import { parseS3Uri, presignOutputUrl } from '../lib/s3Outputs.js';
import { StyleSpecSchema } from '../shared/styleSpec.js';
import { PRESETS, mergeStyleSpec } from '../shared/presets.js';
import type { AssetKind, ProductionRow } from '../shared/productionTypes.js';

const STORAGE_DIR = resolve(process.env.STORAGE_DIR ?? './storage');

// Prepared statements for the producer flow. Kept here (not in server.ts)
// so the existing single-video endpoints stay as-is.
const insertProduction = db.prepare(`
  insert into productions (id, capSeconds, voiceId, prompt, presetId, styleSpec, userId, username)
  values (@id, @capSeconds, @voiceId, @prompt, @presetId, @styleSpec, @userId, @username)
  returning id, status, capSeconds, createdAt
`);
const insertAsset = db.prepare(`
  insert into production_assets (id, productionId, ordinal, kind, path, mime)
  values (@id, @productionId, @ordinal, @kind, @path, @mime)
`);
const selectProduction = db.prepare(`select * from productions where id = ?`);
const selectProductionAssets = db.prepare(
  `select * from production_assets where productionId = ? order by ordinal asc`,
);
const selectProductionOutput = db.prepare(
  `select status, outputPath from productions where id = ?`,
);
const listProductions = db.prepare(`
  select id, status, stage, mode, capSeconds, createdAt, finishedAt
  from productions
  order by createdAt desc
  limit 50
`);

type ProductionOutputRow = { status: string; outputPath: string | null };

function kindFromMime(mime: string | undefined, filename: string): AssetKind | null {
  if (mime?.startsWith('video/')) return 'video';
  if (mime?.startsWith('image/')) return 'image';
  // Fallback on extension — fastify-multipart sometimes reports
  // application/octet-stream for less common containers.
  const ext = extname(filename).toLowerCase();
  if (['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi'].includes(ext)) return 'video';
  if (['.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic'].includes(ext)) return 'image';
  return null;
}

function hydrateAsset(row: Record<string, unknown>): Record<string, unknown> {
  const parse = (k: string) => {
    const v = row[k];
    if (typeof v === 'string' && v.length > 0) {
      try {
        row[k] = JSON.parse(v);
      } catch {
        // leave as string; likely an empty JSON write
      }
    }
  };
  parse('transcript');
  parse('diarization');
  parse('faces');
  parse('analysis');
  return row;
}

function hydrateProduction(row: Record<string, unknown>): ProductionRow {
  const parse = (k: string) => {
    const v = row[k];
    if (typeof v === 'string' && v.length > 0) {
      try {
        row[k] = JSON.parse(v);
      } catch {
        // leave raw
      }
    }
  };
  parse('styleSpec');
  parse('productionPlan');
  parse('timeline');
  parse('narrationScript');
  parse('progress');
  return row as unknown as ProductionRow;
}

export async function registerProductionRoutes(app: FastifyInstance): Promise<void> {
  app.get('/productions', async () => listProductions.all());

  app.get('/productions/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = selectProduction.get(id) as Record<string, unknown> | undefined;
    if (!row) return reply.code(404).send({ error: 'not found' });
    const assets = selectProductionAssets.all(id) as Record<string, unknown>[];
    const hydrated = hydrateProduction(row);
    return { ...hydrated, assets: assets.map(hydrateAsset) };
  });

  app.get('/productions/:id/output', async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = selectProductionOutput.get(id) as ProductionOutputRow | undefined;
    if (!row) return reply.code(404).send({ error: 'not found' });
    if (row.status !== 'done' || !row.outputPath) {
      return reply.code(409).send({ error: 'not ready', status: row.status });
    }
    // Lambda renders store an s3:// URI in outputPath; local renders store
    // an absolute filesystem path. Dispatch on the URI scheme so the same
    // endpoint serves both without the caller needing to know the mode.
    const s3 = parseS3Uri(row.outputPath);
    if (s3) {
      try {
        const signed = await presignOutputUrl(row.outputPath);
        return reply.redirect(signed, 302);
      } catch (err) {
        console.error(`[api] presign failed for ${row.outputPath}:`, err);
        return reply
          .code(502)
          .send({ error: 'could not sign S3 URL', message: (err as Error).message });
      }
    }
    const stats = await stat(row.outputPath);
    reply.header('content-type', 'video/mp4');
    reply.header('content-length', stats.size);
    return reply.send(createReadStream(row.outputPath));
  });

  app.post('/productions', async (req, reply) => {
    const productionId = randomUUID();
    const assetDir = join(STORAGE_DIR, 'productions', productionId, 'assets');
    await mkdir(assetDir, { recursive: true });

    type StagedAsset = {
      id: string;
      ordinal: number;
      kind: AssetKind;
      path: string;
      mime: string | null;
    };
    const assets: StagedAsset[] = [];
    let capSecondsRaw: string | null = null;
    let voiceId: string | null = null;
    let presetId: string | null = null;
    let prompt: string | null = null;
    let userId: string | null = null;
    let username: string | null = null;
    let styleSpecRaw: Record<string, unknown> = {};
    let nextOrdinal = 0;

    for await (const part of req.parts()) {
      if (part.type === 'file') {
        const kind = kindFromMime(part.mimetype, part.filename || '');
        if (!kind) {
          // Drain the file so the request doesn't stall, then reject.
          for await (const _chunk of part.file) void _chunk;
          return reply.code(400).send({
            error: `unsupported file type: ${part.filename} (${part.mimetype ?? 'unknown'})`,
          });
        }
        const id = randomUUID();
        const ext = extname(part.filename || '') || (kind === 'video' ? '.mp4' : '.jpg');
        const ordinal = nextOrdinal++;
        const path = join(assetDir, `${String(ordinal).padStart(3, '0')}${ext}`);
        await pipeline(part.file, createWriteStream(path));
        assets.push({ id, ordinal, kind, path, mime: part.mimetype ?? null });
      } else if (part.type === 'field') {
        const value = String(part.value);
        if (part.fieldname === 'capSeconds') capSecondsRaw = value;
        else if (part.fieldname === 'voiceId') voiceId = value || null;
        else if (part.fieldname === 'presetId') presetId = value || null;
        else if (part.fieldname === 'prompt') {
          // Creative brief from the uploader — informs the orchestrator's
          // story choices. Keep raw except for whitespace trim so the LLM
          // sees exactly what the user wrote.
          const trimmed = value.trim();
          prompt = trimmed.length > 0 ? trimmed.slice(0, 2000) : null;
        } else if (part.fieldname === 'userId') {
          // Opaque submitter id (Telegram user id today). Used as the
          // rotation key for hook selection; capped to a sane length so
          // rogue callers can't blow up the index.
          const trimmed = value.trim();
          userId = trimmed.length > 0 ? trimmed.slice(0, 128) : null;
        } else if (part.fieldname === 'username') {
          const trimmed = value.trim();
          username = trimmed.length > 0 ? trimmed.slice(0, 128) : null;
        } else if (part.fieldname === 'styleSpec') {
          try {
            styleSpecRaw = JSON.parse(value);
          } catch {
            return reply.code(400).send({ error: 'styleSpec must be valid JSON' });
          }
        }
      }
    }

    if (assets.length === 0) {
      return reply.code(400).send({ error: 'at least one video or image file is required' });
    }

    const capSeconds = capSecondsRaw ? Number(capSecondsRaw) : 45;
    if (!Number.isFinite(capSeconds) || capSeconds < 20 || capSeconds > 60) {
      return reply.code(400).send({ error: 'capSeconds must be between 20 and 60' });
    }

    // Resolve preset (built-in only for productions for now — custom presets
    // can be added later). User styleSpec merges on top.
    let mergedStyle: Record<string, unknown> = styleSpecRaw;
    if (presetId) {
      const preset = PRESETS[presetId];
      if (!preset) {
        return reply.code(400).send({ error: `unknown preset: ${presetId}` });
      }
      mergedStyle = mergeStyleSpec(preset.styleSpec, styleSpecRaw);
    }
    const parsed = StyleSpecSchema.safeParse(mergedStyle);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: 'invalid styleSpec', details: parsed.error.flatten() });
    }

    // Insert production + all assets in a single transaction so we never
    // leave orphaned rows on a partial failure.
    const writeAll = db.transaction(() => {
      const created = insertProduction.get({
        id: productionId,
        capSeconds: Math.round(capSeconds),
        voiceId,
        prompt,
        presetId,
        styleSpec: JSON.stringify(parsed.data),
        userId,
        username,
      });
      for (const a of assets) {
        insertAsset.run({
          id: a.id,
          productionId,
          ordinal: a.ordinal,
          kind: a.kind,
          path: a.path,
          mime: a.mime,
        });
      }
      return created as { id: string; status: string; capSeconds: number; createdAt: string };
    });
    const row = writeAll();
    return { ...row, assetCount: assets.length };
  });
}
