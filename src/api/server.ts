// MUST be the first import. Loads .env into process.env before any other
// module's top-level code runs. See src/env.ts for the full explanation —
// the short version is that ES imports hoist, so a try/catch at the top
// of this file runs AFTER every imported module's init, which means
// module-init env var reads (db.ts SQLITE_PATH, pipeline.ts STORAGE_DIR,
// etc.) wouldn't see .env values.
import '../env.js';

import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '../db.js';
import { parseS3Uri, presignOutputUrl } from '../lib/s3Outputs.js';
import { StyleSpecSchema, type StyleSpec } from '../shared/styleSpec.js';
import { PRESETS, mergeStyleSpec, type Preset, type TemplateId } from '../shared/presets.js';

// Single source of truth for which templateIds the API will accept on
// POST /jobs and POST /presets. Adding a new template means: register it in
// remotion/src/Root.tsx, add an entry here, expose it in viewer.html's
// dropdown, and (optionally) add a preset to PRESETS.
const VALID_TEMPLATE_IDS: readonly TemplateId[] = [
  'pop-words',
  'single-word',
  'three-effects',
  'kinetic-burst',
];
function isValidTemplateId(s: string): s is TemplateId {
  return (VALID_TEMPLATE_IDS as readonly string[]).includes(s);
}
import { renderStillFrame } from '../stages/renderStill.js';
import { generateStyle } from '../stages/generateStyle.js';
import { registerProductionRoutes } from './productions.js';
import type { CaptionPlan, FaceData, Transcript } from '../shared/types.js';

const STORAGE_DIR = resolve(process.env.STORAGE_DIR ?? './storage');

const here = dirname(fileURLToPath(import.meta.url));
const VIEWER_HTML = readFileSync(join(here, 'viewer.html'), 'utf8');

const app = Fastify({ logger: true });
await app.register(multipart, {
  limits: { fileSize: 2 * 1024 * 1024 * 1024 }, // 2 GB
});

// Prepared statements — better-sqlite3 caches and reuses these.
const insertJob = db.prepare(`
  insert into jobs (id, inputPath, templateId, styleSpec)
  values (@id, @inputPath, @templateId, @styleSpec)
  returning id, status, createdAt
`);
const selectJob = db.prepare(`select * from jobs where id = ?`);
const selectJobOutput = db.prepare(`select status, outputPath from jobs where id = ?`);
const listJobs = db.prepare(`
  select id, status, stage, templateId, createdAt, finishedAt
  from jobs
  order by createdAt desc
  limit 50
`);

// Custom preset statements.
const selectCustomPreset = db.prepare(`select * from custom_presets where id = ?`);
const listCustomPresets = db.prepare(
  `select id, name, description, templateId, styleSpec from custom_presets order by createdAt desc`,
);
const insertCustomPreset = db.prepare(`
  insert into custom_presets (id, name, description, templateId, styleSpec)
  values (@id, @name, @description, @templateId, @styleSpec)
`);
const deleteCustomPreset = db.prepare(`delete from custom_presets where id = ?`);

type JobOutputRow = { status: string; outputPath: string | null };

// Union built-in and custom presets. Custom rows are marked with
// `source: "custom"` so the viewer can render them differently. Preset
// IDs are a single flat namespace; POST /presets rejects custom ids that
// collide with built-in ones.
type PresetView = Omit<Preset, 'id'> & {
  id: string;
  source: 'builtin' | 'custom';
};

function listAllPresets(): PresetView[] {
  const builtin: PresetView[] = Object.values(PRESETS).map((p) => ({
    ...p,
    source: 'builtin',
  }));
  const custom = listCustomPresets.all() as Array<{
    id: string;
    name: string;
    description: string;
    templateId: string;
    styleSpec: string;
  }>;
  const customViews: PresetView[] = custom.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    templateId: row.templateId as TemplateId,
    styleSpec: JSON.parse(row.styleSpec),
    source: 'custom',
  }));
  return [...builtin, ...customViews];
}

// Resolve a preset id to its { templateId, styleSpec }. Looks at built-in
// first (in-memory, O(1)), then custom_presets (single SQLite query).
function findPresetById(
  id: string,
): { templateId: string; styleSpec: Record<string, unknown> } | null {
  const builtin = PRESETS[id];
  if (builtin) {
    return {
      templateId: builtin.templateId,
      styleSpec: builtin.styleSpec as Record<string, unknown>,
    };
  }
  const custom = selectCustomPreset.get(id) as
    | { templateId: string; styleSpec: string }
    | undefined;
  if (custom) {
    return {
      templateId: custom.templateId,
      styleSpec: JSON.parse(custom.styleSpec) as Record<string, unknown>,
    };
  }
  return null;
}

app.get('/health', async () => ({ ok: true }));

// Static viewer HTML at /. Read once at startup; the file's small enough that
// reloading per-request would just be wasted I/O.
app.get('/', async (_req, reply) => {
  reply.header('content-type', 'text/html; charset=utf-8');
  return VIEWER_HTML;
});

// JSON endpoints consumed by the viewer.
app.get('/jobs', async () => listJobs.all());

app.get('/presets', async () => listAllPresets());

// Save a new custom preset. Rejects collisions with built-in ids and
// validates the styleSpec via the canonical schema.
app.post('/presets', async (req, reply) => {
  const body = req.body as {
    id?: string;
    name?: string;
    description?: string;
    templateId?: string;
    styleSpec?: unknown;
  };
  if (!body || typeof body !== 'object') {
    return reply.code(400).send({ error: 'body must be a JSON object' });
  }
  const id = String(body.id ?? '').trim();
  const name = String(body.name ?? '').trim();
  if (!id) return reply.code(400).send({ error: 'id is required' });
  if (!name) return reply.code(400).send({ error: 'name is required' });
  if (PRESETS[id]) {
    return reply
      .code(409)
      .send({ error: `preset id "${id}" is reserved by a built-in preset` });
  }
  const templateId = String(body.templateId ?? 'pop-words');
  if (!isValidTemplateId(templateId)) {
    return reply
      .code(400)
      .send({ error: `templateId must be one of: ${VALID_TEMPLATE_IDS.join(', ')}` });
  }
  const parsed = StyleSpecSchema.safeParse(body.styleSpec ?? {});
  if (!parsed.success) {
    return reply.code(400).send({ error: 'invalid styleSpec', details: parsed.error.flatten() });
  }
  try {
    insertCustomPreset.run({
      id,
      name,
      description: String(body.description ?? ''),
      templateId,
      styleSpec: JSON.stringify(parsed.data),
    });
  } catch (err) {
    return reply
      .code(409)
      .send({ error: `preset id "${id}" already exists`, cause: (err as Error).message });
  }
  return { id, name, templateId, source: 'custom' as const };
});

app.delete('/presets/:id', async (req, reply) => {
  const { id } = req.params as { id: string };
  if (PRESETS[id]) {
    return reply.code(403).send({ error: 'cannot delete a built-in preset' });
  }
  const result = deleteCustomPreset.run(id);
  if (result.changes === 0) {
    return reply.code(404).send({ error: 'not found' });
  }
  return { id, deleted: true };
});

app.post('/jobs', async (req, reply) => {
  let videoPath: string | null = null;
  let styleSpecRaw: Record<string, unknown> = {};
  let templateIdField: string | null = null;
  let presetId: string | null = null;
  let sourceJobId: string | null = null;

  for await (const part of req.parts()) {
    if (part.type === 'file' && part.fieldname === 'video') {
      const id = randomUUID();
      const dir = join(STORAGE_DIR, 'inputs');
      await mkdir(dir, { recursive: true });
      const ext = extname(part.filename || '') || '.mp4';
      videoPath = join(dir, `${id}${ext}`);
      await pipeline(part.file, createWriteStream(videoPath));
    } else if (part.type === 'field') {
      const value = String(part.value);
      if (part.fieldname === 'styleSpec') {
        try {
          styleSpecRaw = JSON.parse(value);
        } catch {
          return reply.code(400).send({ error: 'styleSpec must be valid JSON' });
        }
      } else if (part.fieldname === 'templateId') {
        templateIdField = value;
      } else if (part.fieldname === 'preset') {
        presetId = value;
      } else if (part.fieldname === 'sourceJobId') {
        sourceJobId = value;
      }
    }
  }

  // sourceJobId lets the viewer's editor re-submit a job using an existing
  // job's input video without re-uploading the file. The new job points at
  // the same inputPath on disk. NOTE: on Railway / 24-7 deployments the
  // per-job cleanup (pipeline.ts) deletes the input immediately after the
  // render finishes, so this feature only works while the source job is
  // still in flight. When the file is gone we return 410 so the UI can
  // prompt the user to re-upload.
  if (!videoPath && sourceJobId) {
    const sourceRow = selectJob.get(sourceJobId) as { inputPath?: string } | undefined;
    if (!sourceRow) {
      return reply.code(404).send({ error: `sourceJobId not found: ${sourceJobId}` });
    }
    if (!sourceRow.inputPath) {
      return reply.code(400).send({ error: 'source job has no inputPath' });
    }
    try {
      await stat(sourceRow.inputPath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return reply
          .code(410)
          .send({ error: 'source input expired — please re-upload the video' });
      }
      throw err;
    }
    videoPath = sourceRow.inputPath;
  }

  if (!videoPath) {
    return reply
      .code(400)
      .send({ error: 'video file or sourceJobId is required' });
  }

  // Resolve preset (built-in or custom), then merge user styleSpec on top
  // so user overrides always win. The user's templateId field takes
  // precedence over the preset's templateId.
  let mergedStyle: Record<string, unknown> = styleSpecRaw;
  let resolvedTemplateId = templateIdField ?? 'pop-words';
  if (presetId) {
    const preset = findPresetById(presetId);
    if (!preset) {
      return reply.code(400).send({
        error: `unknown preset: ${presetId}`,
        available: listAllPresets().map((p) => p.id),
      });
    }
    mergedStyle = mergeStyleSpec(preset.styleSpec, styleSpecRaw);
    resolvedTemplateId = templateIdField ?? preset.templateId;
  }

  const parsed = StyleSpecSchema.safeParse(mergedStyle);
  if (!parsed.success) {
    return reply.code(400).send({ error: 'invalid styleSpec', details: parsed.error.flatten() });
  }

  const job = insertJob.get({
    id: randomUUID(),
    inputPath: videoPath,
    templateId: resolvedTemplateId,
    styleSpec: JSON.stringify(parsed.data),
  });
  return job;
});

app.get('/jobs/:id', async (req, reply) => {
  const { id } = req.params as { id: string };
  const row = selectJob.get(id) as Record<string, unknown> | undefined;
  if (!row) return reply.code(404).send({ error: 'not found' });
  // Hydrate JSON columns for the response.
  if (typeof row.styleSpec === 'string') row.styleSpec = JSON.parse(row.styleSpec);
  if (typeof row.transcript === 'string') row.transcript = JSON.parse(row.transcript);
  if (typeof row.captionPlan === 'string') row.captionPlan = JSON.parse(row.captionPlan);
  if (typeof row.faces === 'string') row.faces = JSON.parse(row.faces);
  if (typeof row.progress === 'string') row.progress = JSON.parse(row.progress);
  return row;
});

app.get('/jobs/:id/output', async (req, reply) => {
  const { id } = req.params as { id: string };
  const row = selectJobOutput.get(id) as JobOutputRow | undefined;
  if (!row) return reply.code(404).send({ error: 'not found' });
  if (row.status !== 'done' || !row.outputPath) {
    return reply.code(409).send({ error: 'not ready', status: row.status });
  }
  // Lambda renders store an s3:// URI in outputPath; local renders store an
  // absolute filesystem path. Dispatch on the URI scheme so one endpoint
  // serves both modes — matches the productions endpoint's behavior
  // (src/api/productions.ts:~112).
  const s3 = parseS3Uri(row.outputPath);
  if (s3) {
    try {
      const signed = await presignOutputUrl(row.outputPath);
      return reply.redirect(signed, 302);
    } catch (err) {
      req.log.error({ err }, `presign failed for ${row.outputPath}`);
      return reply
        .code(502)
        .send({ error: 'could not sign S3 URL', message: (err as Error).message });
    }
  }
  try {
    const stats = await stat(row.outputPath);
    reply.header('content-type', 'video/mp4');
    reply.header('content-length', stats.size);
    return reply.send(createReadStream(row.outputPath));
  } catch (err) {
    // Local file vanished (retention sweeper, manual cleanup). Treat as
    // gone-for-good rather than a server error — the viewer can show a
    // "expired" state.
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return reply.code(410).send({ error: 'output expired' });
    }
    throw err;
  }
});

// Single-frame live preview for the editor. Takes an existing job id, a
// candidate styleSpec, optional templateId, and a frame time in seconds.
// Returns a PNG. Renders via renderStill which is ~1-2s — fast enough to
// debounce at 500ms and feel live-ish.
app.post('/jobs/:id/preview', async (req, reply) => {
  const { id } = req.params as { id: string };
  const row = selectJob.get(id) as Record<string, unknown> | undefined;
  if (!row) return reply.code(404).send({ error: 'not found' });
  if (typeof row.inputPath !== 'string' || typeof row.transcript !== 'string') {
    return reply
      .code(400)
      .send({ error: 'source job is missing transcript or input — is it still running?' });
  }

  const body = req.body as {
    styleSpec?: unknown;
    templateId?: string;
    frameSec?: number;
  };
  const parsed = StyleSpecSchema.safeParse(body?.styleSpec ?? {});
  if (!parsed.success) {
    return reply.code(400).send({ error: 'invalid styleSpec', details: parsed.error.flatten() });
  }

  const transcript = JSON.parse(row.transcript) as Transcript;
  const captionPlan =
    typeof row.captionPlan === 'string' ? (JSON.parse(row.captionPlan) as CaptionPlan) : null;
  const faces = typeof row.faces === 'string' ? (JSON.parse(row.faces) as FaceData) : null;
  const templateId = String(body?.templateId ?? row.templateId ?? 'pop-words');
  const frameSec = Number.isFinite(body?.frameSec) ? Number(body!.frameSec) : 0;

  const tmp = await mkdtemp(join(tmpdir(), 'preview-'));
  const pngPath = join(tmp, 'preview.png');
  try {
    await renderStillFrame({
      inputVideo: row.inputPath,
      transcript,
      captionPlan,
      faces,
      styleSpec: parsed.data as StyleSpec,
      templateId,
      frameSec,
      outputPath: pngPath,
    });
    const buf = await readFile(pngPath);
    reply.header('content-type', 'image/png');
    reply.header('content-length', buf.length);
    return reply.send(buf);
  } catch (err) {
    req.log.error({ err }, 'preview render failed');
    return reply
      .code(500)
      .send({ error: 'preview render failed', message: (err as Error).message });
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => undefined);
  }
});

// LLM-driven style generation. The user writes a natural-language query
// ("make it look neon with pink emphasis #ff3366"); Claude Haiku converts
// it to a StyleSpec, which we validate and merge with the caller-provided
// current spec so incremental edits work. Prompt caching is on inside
// generateStyle() so the ~2500-token system prompt is cheap after the
// first call.
app.post('/style/generate', async (req, reply) => {
  const body = req.body as {
    query?: string;
    currentSpec?: Record<string, unknown>;
    templateId?: string;
  };
  if (!body?.query || typeof body.query !== 'string' || body.query.trim().length === 0) {
    return reply.code(400).send({ error: 'query is required' });
  }
  try {
    const result = await generateStyle({
      query: body.query.trim(),
      currentSpec: body.currentSpec,
      currentTemplateId: body.templateId,
    });
    return result;
  } catch (err) {
    req.log.error({ err }, 'style generation failed');
    return reply.code(502).send({
      error: 'style generation failed',
      message: (err as Error).message,
    });
  }
});

// Multi-file video producer routes. Lives in a separate module so it doesn't
// entangle with the single-video /jobs endpoints.
await registerProductionRoutes(app);

const port = Number(process.env.PORT ?? 3000);
await app.listen({ port, host: '0.0.0.0' });
