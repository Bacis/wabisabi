// MUST be the first import. Loads .env into process.env before any other
// module's top-level code runs. See src/env.ts for the full explanation —
// the short version is that ES imports hoist, so a try/catch at the top
// of this file runs AFTER every imported module's init, which means
// module-init env var reads (db.ts SQLITE_PATH, pipeline.ts STORAGE_DIR,
// etc.) wouldn't see .env values.
import '../env.js';

import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import fastifyCookie from '@fastify/cookie';
import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
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
const VALID_TEMPLATE_IDS: readonly TemplateId[] = ['pop-words', 'reel-clone'];
function isValidTemplateId(s: string): s is TemplateId {
  return (VALID_TEMPLATE_IDS as readonly string[]).includes(s);
}
import { renderStillFrame } from '../stages/renderStill.js';
import { generateStyle } from '../stages/generateStyle.js';
import type { CaptionPlan, FaceData, Transcript } from '../shared/types.js';
import { requireAuth } from '../auth/middleware.js';
import { authenticate } from '../auth/users.js';
import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  createSession,
  revokeSession,
} from '../auth/sessions.js';

const STORAGE_DIR = resolve(process.env.STORAGE_DIR ?? './storage');

const here = dirname(fileURLToPath(import.meta.url));
// The new web/ frontend builds to web/dist. In production we serve it as
// static files; in dev the user runs `npm run dev:web` which proxies API
// requests to this server. If the bundle is missing (e.g. running the API
// without having built the web app), we fall back to a one-line message at /
// rather than 404'ing — matches what people expect during a fresh checkout.
const WEB_DIST = resolve(here, '../../web/dist');
const WEB_DIST_AVAILABLE = existsSync(join(WEB_DIST, 'index.html'));

const app = Fastify({ logger: true });
await app.register(fastifyCookie);
await app.register(multipart, {
  limits: { fileSize: 2 * 1024 * 1024 * 1024 }, // 2 GB
});
if (WEB_DIST_AVAILABLE) {
  await app.register(fastifyStatic, {
    root: WEB_DIST,
    prefix: '/',
    decorateReply: false,
  });
}

// Prepared statements — better-sqlite3 caches and reuses these.
const insertJob = db.prepare(`
  insert into jobs (id, userId, inputPath, templateId, styleSpec, keepInputUntil, hidden)
  values (@id, @userId, @inputPath, @templateId, @styleSpec, @keepInputUntil, @hidden)
  returning id, status, createdAt
`);
const selectJob = db.prepare(`select * from jobs where id = ?`);
const selectJobOutput = db.prepare(
  `select status, outputPath, userId from jobs where id = ?`,
);
const listJobs = db.prepare(`
  select id, status, stage, templateId, createdAt, finishedAt, outputPath
  from jobs
  where coalesce(hidden, 0) = 0 and userId = ?
  order by createdAt desc
  limit 50
`);

// Hide done jobs whose rendered output is no longer playable. Two cases:
//
//   1. Local mode — the worker's retention sweeper drops files in
//      storage/outputs/ older than 24h (worker/index.ts). existsSync()
//      catches these immediately.
//   2. Lambda mode — the bucket lifecycle on the `jobs/` prefix expires
//      objects after 1 day (s3Outputs.ts OWNED_RULES). HEAD-ing S3 on
//      every /jobs list would be a per-row network call, so we use the
//      `finishedAt` age as a cheap proxy: anything older than the
//      retention window is presumed expired even if S3 hasn't actually
//      deleted yet. Both modes share the same 24h window, so one cutoff
//      covers them.
//
// Inputs are intentionally NOT checked here: the pipeline deletes the
// input at the end of a successful render (unless keepInputUntil is set),
// and a just-finished row would otherwise vanish from the list.
const RENDER_RETENTION_MS = 24 * 60 * 60 * 1000;

function parseSqliteUtc(s: string): number {
  // SQLite's datetime('now') is UTC and stored as 'YYYY-MM-DD HH:MM:SS'.
  // Convert to ISO + Z suffix so Date.parse treats it as UTC, not local.
  return Date.parse(s.replace(' ', 'T') + 'Z');
}

type JobListRow = {
  id: string;
  status: string;
  stage: string | null;
  templateId: string;
  createdAt: string;
  finishedAt: string | null;
  outputPath: string | null;
};
function filterListedJobs(rows: JobListRow[]): Omit<JobListRow, 'outputPath'>[] {
  const out: Omit<JobListRow, 'outputPath'>[] = [];
  const ageCutoff = Date.now() - RENDER_RETENTION_MS;
  for (const row of rows) {
    const { outputPath, ...rest } = row;
    if (row.status === 'done') {
      if (outputPath && !parseS3Uri(outputPath) && !existsSync(outputPath)) {
        continue;
      }
      if (row.finishedAt) {
        const finishedMs = parseSqliteUtc(row.finishedAt);
        if (Number.isFinite(finishedMs) && finishedMs < ageCutoff) continue;
      }
    }
    out.push(rest);
  }
  return out;
}

// Custom preset statements. userId scopes ownership; built-ins are
// universally available so the listing union doesn't filter them.
const selectCustomPreset = db.prepare(`select * from custom_presets where id = ?`);
const listCustomPresetsForUser = db.prepare(
  `select id, name, description, templateId, styleSpec
   from custom_presets
   where userId = ?
   order by createdAt desc`,
);
const insertCustomPreset = db.prepare(`
  insert into custom_presets (id, userId, name, description, templateId, styleSpec)
  values (@id, @userId, @name, @description, @templateId, @styleSpec)
`);
const deleteCustomPresetForUser = db.prepare(
  `delete from custom_presets where id = ? and userId = ?`,
);

type JobOutputRow = { status: string; outputPath: string | null; userId: string | null };

// Union built-in and custom presets. Custom rows are marked with
// `source: "custom"` so the viewer can render them differently. Preset
// IDs are a single flat namespace; POST /presets rejects custom ids that
// collide with built-in ones.
type PresetView = Omit<Preset, 'id'> & {
  id: string;
  source: 'builtin' | 'custom';
};

function listAllPresets(userId: string): PresetView[] {
  const builtin: PresetView[] = Object.values(PRESETS).map((p) => ({
    ...p,
    source: 'builtin',
  }));
  const custom = listCustomPresetsForUser.all(userId) as Array<{
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
// first (in-memory, O(1)), then a custom preset owned by the supplied
// user (single SQLite query). Other users' custom presets are invisible.
function findPresetById(
  id: string,
  userId: string,
): { templateId: string; styleSpec: Record<string, unknown> } | null {
  const builtin = PRESETS[id];
  if (builtin) {
    return {
      templateId: builtin.templateId,
      styleSpec: builtin.styleSpec as Record<string, unknown>,
    };
  }
  const custom = selectCustomPreset.get(id) as
    | { templateId: string; styleSpec: string; userId: string | null }
    | undefined;
  if (custom && custom.userId === userId) {
    return {
      templateId: custom.templateId,
      styleSpec: JSON.parse(custom.styleSpec) as Record<string, unknown>,
    };
  }
  return null;
}

app.get('/health', async () => ({ ok: true }));

// Root falls through to the static-file handler when web/dist exists. Without
// a build we serve a one-liner so a fresh checkout's API is still browsable.
if (!WEB_DIST_AVAILABLE) {
  app.get('/', async (_req, reply) => {
    reply.header('content-type', 'text/html; charset=utf-8');
    return '<!doctype html><meta charset="utf-8"><title>Caption Studio</title>' +
      '<body style="font-family:system-ui;padding:2rem;color:#222;">' +
      '<h1>Caption Studio</h1>' +
      '<p>Run <code>npm run build:web</code> (or <code>npm run dev:web</code>) ' +
      'to bring up the editor frontend. JSON API is live at <code>/jobs</code>, ' +
      '<code>/presets</code>, <code>/health</code>, etc.</p>';
  });
}

// --- Auth ----------------------------------------------------------------
// Cookie config: HttpOnly + SameSite=Lax keeps it out of JS and out of
// cross-site requests (good enough CSRF defense for a same-origin SPA with
// no state-changing GETs). `secure` is on whenever NODE_ENV=production —
// Railway terminates TLS upstream so the cookie always travels over HTTPS
// in deployment.
const COOKIE_SECURE = process.env.NODE_ENV === 'production';
const SESSION_COOKIE_OPTS = {
  httpOnly: true as const,
  sameSite: 'lax' as const,
  secure: COOKIE_SECURE,
  path: '/',
};

app.post('/auth/login', async (req, reply) => {
  const body = req.body as { email?: unknown; password?: unknown } | null;
  const email = typeof body?.email === 'string' ? body.email : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  if (!email || !password) {
    return reply.code(400).send({ error: 'email and password are required' });
  }
  const user = await authenticate(email, password);
  if (!user) {
    return reply.code(401).send({ error: 'invalid_credentials' });
  }
  const { token, expiresAt } = createSession(user.id);
  reply.setCookie(SESSION_COOKIE, token, {
    ...SESSION_COOKIE_OPTS,
    expires: expiresAt,
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
  return { user };
});

app.post('/auth/logout', async (req, reply) => {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) revokeSession(token);
  reply.clearCookie(SESSION_COOKIE, SESSION_COOKIE_OPTS);
  return { ok: true };
});

app.get('/auth/me', { preHandler: requireAuth }, async (req) => ({ user: req.user }));

// JSON endpoints consumed by the viewer. All are session-gated; data is
// scoped to the authenticated user.
app.get('/jobs', { preHandler: requireAuth }, async (req) =>
  filterListedJobs(listJobs.all(req.user!.id) as JobListRow[]),
);

app.get('/presets', { preHandler: requireAuth }, async (req) =>
  listAllPresets(req.user!.id),
);

// Save a new custom preset. Rejects collisions with built-in ids and
// validates the styleSpec via the canonical schema.
app.post('/presets', { preHandler: requireAuth }, async (req, reply) => {
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
      userId: req.user!.id,
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

app.delete('/presets/:id', { preHandler: requireAuth }, async (req, reply) => {
  const { id } = req.params as { id: string };
  if (PRESETS[id]) {
    return reply.code(403).send({ error: 'cannot delete a built-in preset' });
  }
  const result = deleteCustomPresetForUser.run(id, req.user!.id);
  if (result.changes === 0) {
    return reply.code(404).send({ error: 'not found' });
  }
  return { id, deleted: true };
});

app.post('/jobs', { preHandler: requireAuth }, async (req, reply) => {
  let videoPath: string | null = null;
  let styleSpecRaw: Record<string, unknown> = {};
  let templateIdField: string | null = null;
  let presetId: string | null = null;
  let keepInputMinutes: number | null = null;
  let hidden = 0;

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
      } else if (part.fieldname === 'keepInputMinutes') {
        // Editor opt-in: the new web frontend uploads with this set so the
        // per-job cleanup in pipeline.ts skips deleting the input until the
        // deadline passes. Capped to keep storage costs bounded — 1 day is
        // generous for an editing session, and the sweeper still wins after.
        const n = Number(value);
        if (Number.isFinite(n) && n > 0) {
          keepInputMinutes = Math.min(n, 60 * 24);
        }
      } else if (part.fieldname === 'hidden') {
        // 'true' / '1' both flag the job as a hidden export render — it
        // runs through the same pipeline but doesn't appear in the
        // sidebar (filtered by listJobs).
        hidden = value === 'true' || value === '1' ? 1 : 0;
      }
    }
  }

  if (!videoPath) {
    return reply.code(400).send({ error: 'video file is required' });
  }

  // Resolve preset (built-in or custom), then merge user styleSpec on top
  // so user overrides always win. The user's templateId field takes
  // precedence over the preset's templateId.
  let mergedStyle: Record<string, unknown> = styleSpecRaw;
  let resolvedTemplateId = templateIdField ?? 'pop-words';
  if (presetId) {
    const preset = findPresetById(presetId, req.user!.id);
    if (!preset) {
      return reply.code(400).send({
        error: `unknown preset: ${presetId}`,
        available: listAllPresets(req.user!.id).map((p) => p.id),
      });
    }
    mergedStyle = mergeStyleSpec(preset.styleSpec, styleSpecRaw);
    resolvedTemplateId = templateIdField ?? preset.templateId;
  }

  const parsed = StyleSpecSchema.safeParse(mergedStyle);
  if (!parsed.success) {
    return reply.code(400).send({ error: 'invalid styleSpec', details: parsed.error.flatten() });
  }

  const keepInputUntil =
    keepInputMinutes != null
      ? new Date(Date.now() + keepInputMinutes * 60_000).toISOString().replace('T', ' ').slice(0, 19)
      : null;

  const job = insertJob.get({
    id: randomUUID(),
    userId: req.user!.id,
    inputPath: videoPath,
    templateId: resolvedTemplateId,
    styleSpec: JSON.stringify(parsed.data),
    keepInputUntil,
    hidden,
  });
  return job;
});

app.get('/jobs/:id', { preHandler: requireAuth }, async (req, reply) => {
  const { id } = req.params as { id: string };
  const row = selectJob.get(id) as (Record<string, unknown> & { userId?: string | null }) | undefined;
  if (!row || row.userId !== req.user!.id) {
    return reply.code(404).send({ error: 'not found' });
  }
  // Hydrate JSON columns for the response.
  if (typeof row.styleSpec === 'string') row.styleSpec = JSON.parse(row.styleSpec);
  if (typeof row.transcript === 'string') row.transcript = JSON.parse(row.transcript);
  if (typeof row.captionPlan === 'string') row.captionPlan = JSON.parse(row.captionPlan);
  if (typeof row.faces === 'string') row.faces = JSON.parse(row.faces);
  if (typeof row.progress === 'string') row.progress = JSON.parse(row.progress);
  // Tell the editor whether it can run the live <Player> overlay (which
  // needs the source video) or has to fall back to playing the rendered
  // output mp4 directly. The pipeline routinely deletes inputs at end-of-
  // render, and the worker's sweeper finishes off anything that lingers
  // past 1h — so a "done" job's input is often gone even when the output
  // is still available. S3 inputs are presumed available (cheap and the
  // render-time staging step uploads them to a 1d-retention prefix).
  const inputPath = typeof row.inputPath === 'string' ? row.inputPath : null;
  row.inputAvailable = inputPath
    ? parseS3Uri(inputPath) !== null || existsSync(inputPath)
    : false;
  return row;
});

// Stream the original uploaded input video to the browser. The new web
// editor's <Player> needs an HTTP URL to load — staticFile() only works
// inside the Remotion render bundle. Local jobs stream from disk; Lambda
// jobs (input copied to S3 by the staging step) get a 302 to a presigned
// URL. Honors the same expired-input semantics as /jobs/:id/output.
app.get('/jobs/:id/input', { preHandler: requireAuth }, async (req, reply) => {
  const { id } = req.params as { id: string };
  const row = selectJob.get(id) as { inputPath?: string; userId?: string | null } | undefined;
  if (!row || row.userId !== req.user!.id) {
    return reply.code(404).send({ error: 'not found' });
  }
  if (!row.inputPath) return reply.code(404).send({ error: 'no inputPath' });
  const s3 = parseS3Uri(row.inputPath);
  if (s3) {
    try {
      const signed = await presignOutputUrl(row.inputPath);
      return reply.redirect(signed, 302);
    } catch (err) {
      req.log.error({ err }, `presign input failed for ${row.inputPath}`);
      return reply
        .code(502)
        .send({ error: 'could not sign input URL', message: (err as Error).message });
    }
  }
  try {
    const stats = await stat(row.inputPath);
    reply.header('content-type', 'video/mp4');
    reply.header('content-length', stats.size);
    reply.header('accept-ranges', 'bytes');
    return reply.send(createReadStream(row.inputPath));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return reply.code(410).send({ error: 'input expired' });
    }
    throw err;
  }
});

app.get('/jobs/:id/output', { preHandler: requireAuth }, async (req, reply) => {
  const { id } = req.params as { id: string };
  const row = selectJobOutput.get(id) as JobOutputRow | undefined;
  if (!row || row.userId !== req.user!.id) {
    return reply.code(404).send({ error: 'not found' });
  }
  if (row.status !== 'done' || !row.outputPath) {
    return reply.code(409).send({ error: 'not ready', status: row.status });
  }
  // ?download=<basename> opts the response into "save as" mode (instead of
  // playing inline in a <video> tag). The editor's Export-render flow uses
  // it to trigger a real browser download even though the file lives on
  // S3 cross-origin — fetch+blob would CORS-fail, but a plain anchor click
  // following a 302 to a URL with `Content-Disposition: attachment` set
  // works in every browser.
  const downloadName = (req.query as { download?: string } | null)?.download;
  const s3 = parseS3Uri(row.outputPath);
  if (s3) {
    try {
      const signed = await presignOutputUrl(row.outputPath, 3600, downloadName);
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
    if (downloadName) {
      const safe = downloadName.replace(/"/g, '');
      reply.header('content-disposition', `attachment; filename="${safe}"`);
    }
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
app.post('/jobs/:id/preview', { preHandler: requireAuth }, async (req, reply) => {
  const { id } = req.params as { id: string };
  const row = selectJob.get(id) as (Record<string, unknown> & { userId?: string | null }) | undefined;
  if (!row || row.userId !== req.user!.id) {
    return reply.code(404).send({ error: 'not found' });
  }
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
app.post('/style/generate', { preHandler: requireAuth }, async (req, reply) => {
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

// Heads-up if existing rows are still unowned after the auth migration.
// First-time setup is: create an admin via `npm run admin:create -- ...`
// then run `npm run admin:claim -- ...` to assign legacy rows.
const orphanJobsCount = (
  db.prepare(`select count(*) as n from jobs where userId is null`).get() as { n: number }
).n;
if (orphanJobsCount > 0) {
  app.log.warn(
    { orphanJobs: orphanJobsCount },
    `${orphanJobsCount} job(s) have no userId. Run \`npm run admin:claim -- <email>\` to assign them.`,
  );
}

const port = Number(process.env.PORT ?? 3000);
await app.listen({ port, host: '0.0.0.0' });
