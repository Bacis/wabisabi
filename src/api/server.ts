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
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '../db.js';
import {
  deleteObject,
  ensureUploadCors,
  fetchOutputStream,
  getUploadBucket,
  headObject,
  parseS3Uri,
  presignOutputUrl,
  presignPutUrl,
} from '../lib/s3Outputs.js';
import { ffprobe } from '../stages/ffprobe.js';
import { StyleSpecSchema, type StyleSpec } from '../shared/styleSpec.js';
import { PRESETS, mergeStyleSpec, type Preset, type TemplateId } from '../shared/presets.js';

// Single source of truth for which templateIds the API will accept on
// POST /jobs and POST /presets. Adding a new template means: register it in
// remotion/src/Root.tsx, add an entry here, expose it in viewer.html's
// dropdown, and (optionally) add a preset to PRESETS.
const VALID_TEMPLATE_IDS: readonly TemplateId[] = ['pop-words', 'reel-clone', 'caption-designer'];
function isValidTemplateId(s: string): s is TemplateId {
  return (VALID_TEMPLATE_IDS as readonly string[]).includes(s);
}
import { renderStillFrame } from '../stages/renderStill.js';
import { generateStyle } from '../stages/generateStyle.js';
import { runAgentChat } from '../stages/agentChat.js';
import {
  proposeDirectorScript,
  type PlannerWord,
} from '../stages/proposeDirectorScript.js';
import type { CaptionPlan, FaceData, Transcript } from '../shared/types.js';
import { requireAuth, requireOwnership } from '../auth/middleware.js';
import { authenticate } from '../auth/users.js';
import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  createSession,
  revokeSession,
} from '../auth/sessions.js';
import { createApiKey, listApiKeys, revokeApiKey } from '../auth/apiKeys.js';
import { mountMcp } from '../mcp/server.js';

const STORAGE_DIR = resolve(process.env.STORAGE_DIR ?? './storage');

const here = dirname(fileURLToPath(import.meta.url));
// The new web/ frontend builds to web/dist. In production we serve it as
// static files; in dev the user runs `npm run dev:web` which proxies API
// requests to this server. If the bundle is missing (e.g. running the API
// without having built the web app), we fall back to a one-line message at /
// rather than 404'ing — matches what people expect during a fresh checkout.
const WEB_DIST = resolve(here, '../../web/dist');
const WEB_DIST_AVAILABLE = existsSync(join(WEB_DIST, 'index.html'));

// Themes feature: curated stock clips (mp4 + sidecar transcript/captionPlan
// JSON) live in remotion/public/stock/. Same dir Remotion's bundler reads
// from, so a one-time dev run of scripts/seed-stock-clips.ts produces files
// that work for both render-time (staticFile()) and the browser <Player>
// (HTTP via the fastifyStatic mount registered below).
const STOCK_CLIPS_DIR = resolve(here, '../../remotion/public/stock');
const STOCK_INDEX_PATH = join(STOCK_CLIPS_DIR, 'index.json');

// Director audio samples (remotion/public/audio/<gesture>/NN.mp3). The
// Remotion <CueLayer> resolves these via staticFile() which maps to
// `<bundle>/public/audio/...` at render time; for the live editor preview
// the same path needs to be reachable on the dev server, so we mount
// `remotion/public/audio/` at `/audio/` and let Vite proxy it.
const AUDIO_SAMPLES_DIR = resolve(here, '../../remotion/public/audio');

const app = Fastify({ logger: true });
await app.register(fastifyCookie);
await app.register(multipart, {
  limits: { fileSize: 2 * 1024 * 1024 * 1024 }, // 2 GB
});
// Stock clips static mount. Registered before the web/dist mount so the
// /stock/ prefix wins over the SPA's catchall. mkdirSync ensures the dir
// exists at boot — fastifyStatic throws on register if `root` is missing,
// and we want the mount live before the seeder runs (so a tsx-watch
// reload picks up freshly seeded files immediately).
mkdirSync(STOCK_CLIPS_DIR, { recursive: true });
await app.register(fastifyStatic, {
  root: STOCK_CLIPS_DIR,
  prefix: '/stock/',
  decorateReply: false,
});
// Director audio samples. Mount BEFORE the SPA fallback so cue mp3 fetches
// don't hit the index.html catchall.
mkdirSync(AUDIO_SAMPLES_DIR, { recursive: true });
await app.register(fastifyStatic, {
  root: AUDIO_SAMPLES_DIR,
  prefix: '/audio/',
  decorateReply: false,
});
if (WEB_DIST_AVAILABLE) {
  await app.register(fastifyStatic, {
    root: WEB_DIST,
    prefix: '/',
    decorateReply: false,
  });

  // SPA fallback. The API and the React app share URL space — e.g. /jobs/:id
  // is both a JSON endpoint and a react-router route. A browser reload or
  // deep-link sends `Accept: text/html`; XHR/fetch from app code does not.
  // For HTML GETs that don't look like a static asset, serve index.html so
  // react-router can handle the route. JSON requests fall through to the
  // normal API handlers unchanged.
  const INDEX_HTML = readFileSync(join(WEB_DIST, 'index.html'), 'utf8');
  app.addHook('onRequest', async (req, reply) => {
    if (req.method !== 'GET') return;
    const accept = req.headers.accept ?? '';
    if (!accept.includes('text/html')) return;
    const pathname = req.url.split('?')[0]!;
    // Asset paths (anything with a file extension) are served by
    // fastifyStatic — leave them alone. The bare "/" is also handled by
    // the static plugin (it serves index.html itself).
    if (pathname === '/' || /\.[a-zA-Z0-9]+$/.test(pathname)) return;
    reply.type('text/html').send(INDEX_HTML);
  });
}

// Prepared statements — better-sqlite3 caches and reuses these.
const insertJob = db.prepare(`
  insert into jobs (id, userId, inputPath, templateId, styleSpec, keepInputUntil, hidden, userVideoId, widthPx, heightPx)
  values (@id, @userId, @inputPath, @templateId, @styleSpec, @keepInputUntil, @hidden, @userVideoId, @widthPx, @heightPx)
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

// Theme statements. Themes are the user-facing rename for custom_presets;
// the table stays put and three columns (isPublished, publishedAt,
// showcaseClipId) gate the publish flow. Joining users for authorEmail so
// the community feed can display "by alice@..." next to each card.
const insertTheme = db.prepare(`
  insert into custom_presets
    (id, userId, name, description, templateId, styleSpec, showcaseClipId)
  values
    (@id, @userId, @name, @description, @templateId, @styleSpec, @showcaseClipId)
`);
const selectThemeRow = db.prepare(`
  select cp.*, u.email as authorEmail
  from custom_presets cp
  left join users u on u.id = cp.userId
  where cp.id = ?
`);
// Own drafts + own published + everyone else's published, newest first
// inside each bucket. Drafts (own only) come first so the user sees their
// in-progress work at the top.
const listThemesForFeed = db.prepare(`
  select cp.id, cp.userId, cp.name, cp.description, cp.templateId,
         cp.styleSpec, cp.showcaseClipId, cp.isPublished, cp.publishedAt,
         cp.createdAt, u.email as authorEmail
  from custom_presets cp
  left join users u on u.id = cp.userId
  where cp.userId = @userId or cp.isPublished = 1
  order by
    case when cp.userId = @userId and cp.isPublished = 0 then 0 else 1 end,
    coalesce(cp.publishedAt, cp.createdAt) desc
`);
const updateThemeFields = db.prepare(`
  update custom_presets
  set name = coalesce(@name, name),
      description = coalesce(@description, description),
      templateId = coalesce(@templateId, templateId),
      styleSpec = coalesce(@styleSpec, styleSpec),
      showcaseClipId = coalesce(@showcaseClipId, showcaseClipId)
  where id = @id and userId = @userId
`);
const publishTheme = db.prepare(`
  update custom_presets
  set isPublished = 1, publishedAt = datetime('now')
  where id = @id and userId = @userId
`);
const unpublishTheme = db.prepare(`
  update custom_presets
  set isPublished = 0, publishedAt = null
  where id = @id and userId = @userId
`);
const deleteThemeForUser = db.prepare(
  `delete from custom_presets where id = ? and userId = ?`,
);

// --- Designs ------------------------------------------------------------
// A "design" is the Caption Designer editor's persisted state for one
// session. Each row owns: a name, a source reference (stock clip or upload
// job), and a JSON blob of the EditorState (tracks, groupStyles, etc.).
// Rendering a design queues a hidden job with templateId='caption-designer'
// and a styleSpec.designer payload derived from `state`.
const insertDesign = db.prepare(`
  insert into designs (id, userId, name, sourceKind, sourceId, templateId, state)
  values (@id, @userId, @name, @sourceKind, @sourceId, @templateId, @state)
`);
const listDesignsForUser = db.prepare(`
  select id, name, sourceKind, sourceId, templateId, thumbnailPath, createdAt, updatedAt
  from designs
  where userId = ?
  order by updatedAt desc
`);
const selectDesignRow = db.prepare(`select * from designs where id = ?`);
const updateDesignFields = db.prepare(`
  update designs
  set name = coalesce(@name, name),
      state = coalesce(@state, state),
      updatedAt = datetime('now')
  where id = @id and userId = @userId
`);
const deleteDesignForUser = db.prepare(
  `delete from designs where id = ? and userId = ?`,
);

type DesignRow = {
  id: string;
  userId: string;
  name: string;
  sourceKind: 'stock' | 'job';
  sourceId: string;
  templateId: string;
  state: string;             // JSON
  thumbnailPath: string | null;
  createdAt: string;
  updatedAt: string;
};

type DesignView = Omit<DesignRow, 'state'> & {
  state: unknown;            // parsed JSON
};

function designViewFromRow(row: DesignRow): DesignView {
  return {
    ...row,
    state: JSON.parse(row.state),
  };
}

// --- Designer sessions --------------------------------------------------
// A "designer session" is a saved agent conversation at /designer/:id —
// the chat transcript plus enough source/state info that reopening the
// URL restores the exact editor view. Created on the user's first chat
// turn (POST /designer/sessions) and PATCHed after every successful
// /agent/chat reply so the latest messages + styleSpec are durable.
const insertDesignerSession = db.prepare(`
  insert into designer_sessions
    (id, userId, title, templateId, sourceKind, sourceId, styleSpec, directorScript, messages)
  values
    (@id, @userId, @title, @templateId, @sourceKind, @sourceId, @styleSpec, @directorScript, @messages)
`);
const listDesignerSessionsForUser = db.prepare(`
  select id, title, templateId, sourceKind, sourceId, createdAt, updatedAt
  from designer_sessions
  where userId = ?
  order by updatedAt desc
  limit 100
`);
const selectDesignerSessionRow = db.prepare(
  `select * from designer_sessions where id = ?`,
);
// directorScript uses a sentinel string '__null__' to distinguish "don't
// touch" (coalesce keeps the old value) from "the agent reverted the plan
// to null" (PATCH should clear it). All other JSON columns reuse coalesce
// because they're never validly null after creation.
const updateDesignerSessionFields = db.prepare(`
  update designer_sessions
  set title          = coalesce(@title, title),
      messages       = coalesce(@messages, messages),
      styleSpec      = coalesce(@styleSpec, styleSpec),
      directorScript = case
        when @directorScript is null then directorScript
        when @directorScript = '__null__' then null
        else @directorScript
      end,
      updatedAt      = datetime('now')
  where id = @id and userId = @userId
`);
const deleteDesignerSessionForUser = db.prepare(
  `delete from designer_sessions where id = ? and userId = ?`,
);

// user_videos: persistent uploads on S3, independent of any single job.
// The init/finalize handshake is two-step: insertUserVideo on /uploads/init
// (status='pending'), then markUserVideoReady on /uploads/:id/finalize once
// the browser confirms its presigned PUT landed.
const insertUserVideo = db.prepare(`
  insert into user_videos
    (id, userId, displayName, originalFilename, s3Bucket, s3Key, sizeBytes, mimeType, status)
  values
    (@id, @userId, @displayName, @originalFilename, @s3Bucket, @s3Key, @sizeBytes, @mimeType, 'pending')
  returning id, userId, displayName, originalFilename, s3Bucket, s3Key, sizeBytes, mimeType, status, createdAt
`);
const markUserVideoReady = db.prepare(`
  update user_videos
     set status      = 'ready',
         sizeBytes   = coalesce(@sizeBytes, sizeBytes),
         durationSec = coalesce(@durationSec, durationSec),
         widthPx     = coalesce(@widthPx, widthPx),
         heightPx    = coalesce(@heightPx, heightPx),
         updatedAt   = datetime('now')
   where id = @id and userId = @userId
`);
const selectUserVideoForUser = db.prepare(
  `select * from user_videos where id = ? and userId = ?`,
);
const listUserVideosForUser = db.prepare(
  `select id, displayName, originalFilename, sizeBytes, durationSec, mimeType, status, createdAt
     from user_videos
    where userId = ? and status = 'ready'
    order by createdAt desc`,
);
const renameUserVideo = db.prepare(
  `update user_videos
      set displayName = @displayName,
          updatedAt   = datetime('now')
    where id = @id and userId = @userId`,
);
const deleteUserVideoForUser = db.prepare(
  `delete from user_videos where id = ? and userId = ?`,
);
// Block delete if there's still an active job using this upload — the
// worker is mid-render, deleting the source would crash it.
const countActiveJobsForUserVideo = db.prepare(
  `select count(*) as n from jobs
    where userVideoId = ?
      and status in ('queued', 'running')`,
);

type DesignerSessionRow = {
  id: string;
  userId: string;
  title: string;
  templateId: string;
  sourceKind: 'stock' | 'job';
  sourceId: string;
  styleSpec: string;            // JSON
  directorScript: string | null; // JSON | null
  messages: string;             // JSON
  createdAt: string;
  updatedAt: string;
};

type DesignerSessionView = Omit<
  DesignerSessionRow,
  'styleSpec' | 'directorScript' | 'messages'
> & {
  styleSpec: Record<string, unknown>;
  directorScript: unknown | null;
  messages: unknown[];
};

function designerSessionViewFromRow(row: DesignerSessionRow): DesignerSessionView {
  return {
    ...row,
    styleSpec: JSON.parse(row.styleSpec),
    directorScript: row.directorScript ? JSON.parse(row.directorScript) : null,
    messages: JSON.parse(row.messages),
  };
}

// Title auto-derivation: trim, collapse whitespace, cap at 60 chars. Empty
// fallback so the column never holds an empty string (UI shows "Untitled
// session" if every word ends up filtered).
function deriveSessionTitle(raw: string): string {
  const cleaned = raw.replace(/\s+/g, ' ').trim();
  if (!cleaned) return 'Untitled session';
  return cleaned.length > 60 ? cleaned.slice(0, 60).trimEnd() + '…' : cleaned;
}

// Insert-with-prebuilt-JSON path used by /designs/:id/render. The standard
// insertJob doesn't take transcript/captionPlan/faces — they're populated
// by the worker pipeline. For caption-designer renders we already know all
// of those (the editor authored them), so the worker can skip transcribe/
// enrich/face_detect entirely.
const insertJobWithAnalysis = db.prepare(`
  insert into jobs
    (id, userId, inputPath, templateId, styleSpec, transcript, captionPlan, faces, directorScript, keepInputUntil, hidden)
  values
    (@id, @userId, @inputPath, @templateId, @styleSpec, @transcript, @captionPlan, @faces, @directorScript, @keepInputUntil, @hidden)
  returning id, status, createdAt
`);

type ThemeRow = {
  id: string;
  userId: string | null;
  name: string;
  description: string;
  templateId: string;
  styleSpec: string;
  showcaseClipId: string | null;
  isPublished: number;
  publishedAt: string | null;
  createdAt: string;
  authorEmail: string | null;
};

type ThemeView = {
  id: string;
  name: string;
  description: string;
  templateId: TemplateId;
  styleSpec: Record<string, unknown>;
  showcaseClipId: string | null;
  isPublished: boolean;
  publishedAt: string | null;
  createdAt: string;
  authorEmail: string | null;
  isOwner: boolean;
};

function themeViewFromRow(row: ThemeRow, currentUserId: string): ThemeView {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? '',
    templateId: row.templateId as TemplateId,
    styleSpec: JSON.parse(row.styleSpec) as Record<string, unknown>,
    showcaseClipId: row.showcaseClipId,
    isPublished: row.isPublished === 1,
    publishedAt: row.publishedAt,
    createdAt: row.createdAt,
    authorEmail: row.authorEmail,
    isOwner: row.userId === currentUserId,
  };
}

// --- Stock clip loader ---------------------------------------------------

type StockClipMeta = {
  id: string;
  name: string;
  durationSec: number;
  width: number;
  height: number;
  fps: number;
};
type StockClipSummary = StockClipMeta & { hasTranscript: boolean };

function readStockIndex(): StockClipSummary[] {
  if (!existsSync(STOCK_INDEX_PATH)) return [];
  try {
    const parsed = JSON.parse(readFileSync(STOCK_INDEX_PATH, 'utf8'));
    if (!Array.isArray(parsed)) return [];
    // clip.mp4 is gitignored; deployments only have meta/transcript json.
    // Skip clips whose mp4 isn't actually on disk so prod doesn't advertise
    // entries that GET /clips/stock/:id will 404 on.
    return (parsed as StockClipSummary[]).filter((c) =>
      existsSync(join(STOCK_CLIPS_DIR, c.id, 'clip.mp4')),
    );
  } catch (err) {
    app.log.warn({ err }, 'stock clip index.json is invalid — treating as empty');
    return [];
  }
}

// Load the full payload for a single stock clip, or null if anything is
// missing on disk. The transcript/captionPlan files are produced by
// scripts/seed-stock-clips.ts, never by user runtime.
function readStockClipDetail(
  clipId: string,
): {
  meta: StockClipMeta;
  transcript: Transcript;
  captionPlan: CaptionPlan | null;
} | null {
  // Defense in depth: clipId is used as a path segment.
  if (!/^[a-zA-Z0-9_-]+$/.test(clipId)) return null;
  const dir = join(STOCK_CLIPS_DIR, clipId);
  const metaPath = join(dir, 'meta.json');
  const transcriptPath = join(dir, 'transcript.json');
  const captionPlanPath = join(dir, 'captionPlan.json');
  const clipPath = join(dir, 'clip.mp4');
  if (!existsSync(metaPath) || !existsSync(transcriptPath) || !existsSync(clipPath)) {
    return null;
  }
  try {
    const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as StockClipMeta;
    const transcript = JSON.parse(readFileSync(transcriptPath, 'utf8')) as Transcript;
    const captionPlan = existsSync(captionPlanPath)
      ? (JSON.parse(readFileSync(captionPlanPath, 'utf8')) as CaptionPlan)
      : null;
    return { meta, transcript, captionPlan };
  } catch (err) {
    app.log.warn({ err, clipId }, 'failed to load stock clip files');
    return null;
  }
}

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

// ─── API keys (for MCP clients) ──────────────────────────────────────────
//
// All three endpoints are session-gated (NOT api-key-gated) — a user mints
// keys from the web app's Settings page and pastes them into their MCP
// client. The plaintext token is returned by POST exactly once and never
// stored on the server.
app.get('/keys', { preHandler: requireAuth }, async (req) => ({
  keys: listApiKeys(req.user!.id),
}));

app.post('/keys', { preHandler: requireAuth }, async (req, reply) => {
  const body = (req.body ?? {}) as { name?: unknown };
  const name = typeof body.name === 'string' ? body.name : '';
  if (!name.trim()) return reply.code(400).send({ error: 'name is required' });
  try {
    const { plaintext, key } = await createApiKey({ userId: req.user!.id, name });
    return { key, plaintext };
  } catch (err) {
    return reply.code(400).send({ error: (err as Error).message });
  }
});

app.delete('/keys/:id', { preHandler: requireAuth }, async (req, reply) => {
  const { id } = req.params as { id: string };
  const ok = revokeApiKey({ id, userId: req.user!.id });
  if (!ok) return reply.code(404).send({ error: 'key not found or already revoked' });
  return { ok: true };
});

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

// --- Stock clips ---------------------------------------------------------
// Curated short videos with prebaked transcripts (by scripts/seed-stock-clips.ts).
// The themes feature uses these as the showcase backdrop so a published theme
// can be replayed live in the browser without storing a per-theme MP4 — the
// 24h render-output sweep doesn't apply to /stock/, the files are committed
// to the repo.

app.get('/clips/stock', { preHandler: requireAuth }, async () => readStockIndex());

app.get('/clips/stock/:id', { preHandler: requireAuth }, async (req, reply) => {
  const { id } = req.params as { id: string };
  const detail = readStockClipDetail(id);
  if (!detail) {
    return reply.code(404).send({ error: 'not found' });
  }
  return {
    id: detail.meta.id,
    name: detail.meta.name,
    src: `/stock/${detail.meta.id}/clip.mp4`,
    durationSec: detail.meta.durationSec,
    width: detail.meta.width,
    height: detail.meta.height,
    fps: detail.meta.fps,
    transcript: detail.transcript,
    captionPlan: detail.captionPlan,
    faces: null,
  };
});

// --- Themes --------------------------------------------------------------
// Themes are owned (name, templateId, styleSpec) configs that can be
// published for other authenticated users to browse. The DB row is in the
// same custom_presets table as legacy presets — three extra columns
// (isPublished, publishedAt, showcaseClipId) drive the publish flow.

app.get('/themes', { preHandler: requireAuth }, async (req) => {
  const rows = listThemesForFeed.all({ userId: req.user!.id }) as ThemeRow[];
  return rows.map((r) => themeViewFromRow(r, req.user!.id));
});

app.post('/themes', { preHandler: requireAuth }, async (req, reply) => {
  const body = req.body as {
    name?: unknown;
    description?: unknown;
    templateId?: unknown;
    styleSpec?: unknown;
    showcaseClipId?: unknown;
  } | null;
  if (!body || typeof body !== 'object') {
    return reply.code(400).send({ error: 'body must be a JSON object' });
  }
  const name = String(body.name ?? '').trim();
  if (!name) return reply.code(400).send({ error: 'name is required' });
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
  let showcaseClipId: string | null = null;
  if (body.showcaseClipId != null) {
    const requested = String(body.showcaseClipId);
    if (!readStockClipDetail(requested)) {
      return reply.code(400).send({ error: `unknown stock clip: ${requested}` });
    }
    showcaseClipId = requested;
  }
  const id = randomUUID();
  insertTheme.run({
    id,
    userId: req.user!.id,
    name,
    description: String(body.description ?? ''),
    templateId,
    styleSpec: JSON.stringify(parsed.data),
    showcaseClipId,
  });
  const row = selectThemeRow.get(id) as ThemeRow | undefined;
  if (!row) return reply.code(500).send({ error: 'theme insert disappeared' });
  return themeViewFromRow(row, req.user!.id);
});

app.get('/themes/:id', { preHandler: requireAuth }, async (req, reply) => {
  const { id } = req.params as { id: string };
  const row = selectThemeRow.get(id) as ThemeRow | undefined;
  if (!row) return reply.code(404).send({ error: 'not found' });
  const isOwner = row.userId === req.user!.id;
  if (!isOwner && row.isPublished !== 1) {
    return reply.code(404).send({ error: 'not found' });
  }
  const view = themeViewFromRow(row, req.user!.id);
  // Inline the showcase clip payload so the viewer page is one fetch.
  let showcaseClip = null;
  if (view.showcaseClipId) {
    const detail = readStockClipDetail(view.showcaseClipId);
    if (detail) {
      showcaseClip = {
        id: detail.meta.id,
        name: detail.meta.name,
        src: `/stock/${detail.meta.id}/clip.mp4`,
        durationSec: detail.meta.durationSec,
        width: detail.meta.width,
        height: detail.meta.height,
        fps: detail.meta.fps,
        transcript: detail.transcript,
        captionPlan: detail.captionPlan,
        faces: null,
      };
    }
  }
  return { ...view, showcaseClip };
});

app.patch('/themes/:id', { preHandler: requireAuth }, async (req, reply) => {
  const { id } = req.params as { id: string };
  const row = selectThemeRow.get(id) as ThemeRow | undefined;
  if (!row || row.userId !== req.user!.id) {
    return reply.code(404).send({ error: 'not found' });
  }
  const body = req.body as {
    name?: unknown;
    description?: unknown;
    templateId?: unknown;
    styleSpec?: unknown;
    showcaseClipId?: unknown;
  } | null;
  if (!body || typeof body !== 'object') {
    return reply.code(400).send({ error: 'body must be a JSON object' });
  }
  let nameVal: string | null = null;
  if (body.name !== undefined) {
    const n = String(body.name).trim();
    if (!n) return reply.code(400).send({ error: 'name cannot be empty' });
    nameVal = n;
  }
  let descriptionVal: string | null = null;
  if (body.description !== undefined) descriptionVal = String(body.description);
  let templateIdVal: string | null = null;
  if (body.templateId !== undefined) {
    const t = String(body.templateId);
    if (!isValidTemplateId(t)) {
      return reply
        .code(400)
        .send({ error: `templateId must be one of: ${VALID_TEMPLATE_IDS.join(', ')}` });
    }
    templateIdVal = t;
  }
  let styleSpecVal: string | null = null;
  if (body.styleSpec !== undefined) {
    const parsed = StyleSpecSchema.safeParse(body.styleSpec);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid styleSpec', details: parsed.error.flatten() });
    }
    styleSpecVal = JSON.stringify(parsed.data);
  }
  let showcaseClipIdVal: string | null = null;
  if (body.showcaseClipId !== undefined && body.showcaseClipId !== null) {
    const requested = String(body.showcaseClipId);
    if (!readStockClipDetail(requested)) {
      return reply.code(400).send({ error: `unknown stock clip: ${requested}` });
    }
    showcaseClipIdVal = requested;
  }
  updateThemeFields.run({
    id,
    userId: req.user!.id,
    name: nameVal,
    description: descriptionVal,
    templateId: templateIdVal,
    styleSpec: styleSpecVal,
    showcaseClipId: showcaseClipIdVal,
  });
  const updated = selectThemeRow.get(id) as ThemeRow;
  return themeViewFromRow(updated, req.user!.id);
});

app.post('/themes/:id/publish', { preHandler: requireAuth }, async (req, reply) => {
  const { id } = req.params as { id: string };
  const row = selectThemeRow.get(id) as ThemeRow | undefined;
  if (!row || row.userId !== req.user!.id) {
    return reply.code(404).send({ error: 'not found' });
  }
  if (!row.showcaseClipId) {
    return reply.code(400).send({
      error: 'showcaseClipId is required to publish — pick a stock clip first',
    });
  }
  publishTheme.run({ id, userId: req.user!.id });
  const updated = selectThemeRow.get(id) as ThemeRow;
  return themeViewFromRow(updated, req.user!.id);
});

app.post('/themes/:id/unpublish', { preHandler: requireAuth }, async (req, reply) => {
  const { id } = req.params as { id: string };
  const row = selectThemeRow.get(id) as ThemeRow | undefined;
  if (!row || row.userId !== req.user!.id) {
    return reply.code(404).send({ error: 'not found' });
  }
  unpublishTheme.run({ id, userId: req.user!.id });
  const updated = selectThemeRow.get(id) as ThemeRow;
  return themeViewFromRow(updated, req.user!.id);
});

app.delete('/themes/:id', { preHandler: requireAuth }, async (req, reply) => {
  const { id } = req.params as { id: string };
  const result = deleteThemeForUser.run(id, req.user!.id);
  if (result.changes === 0) {
    return reply.code(404).send({ error: 'not found' });
  }
  return { id, deleted: true };
});

// --- Designs endpoints --------------------------------------------------

app.get('/designs', { preHandler: requireAuth }, async (req) => {
  return listDesignsForUser.all(req.user!.id);
});

app.post('/designs', { preHandler: requireAuth }, async (req, reply) => {
  const body = req.body as {
    name?: unknown;
    sourceKind?: unknown;
    sourceId?: unknown;
    state?: unknown;
  } | null;
  if (!body || typeof body !== 'object') {
    return reply.code(400).send({ error: 'body must be a JSON object' });
  }
  const name = String(body.name ?? '').trim();
  if (!name) return reply.code(400).send({ error: 'name is required' });
  const sourceKind = String(body.sourceKind ?? '');
  if (sourceKind !== 'stock' && sourceKind !== 'job') {
    return reply.code(400).send({ error: 'sourceKind must be "stock" or "job"' });
  }
  const sourceId = String(body.sourceId ?? '').trim();
  if (!sourceId) return reply.code(400).send({ error: 'sourceId is required' });
  if (!body.state || typeof body.state !== 'object') {
    return reply.code(400).send({ error: 'state must be an object' });
  }

  const id = randomUUID();
  insertDesign.run({
    id,
    userId: req.user!.id,
    name,
    sourceKind,
    sourceId,
    templateId: 'caption-designer',
    state: JSON.stringify(body.state),
  });
  const row = selectDesignRow.get(id) as DesignRow | undefined;
  if (!row) return reply.code(500).send({ error: 'design insert disappeared' });
  return designViewFromRow(row);
});

app.get('/designs/:id', { preHandler: requireAuth }, async (req, reply) => {
  const { id } = req.params as { id: string };
  const row = selectDesignRow.get(id) as DesignRow | undefined;
  if (!row || row.userId !== req.user!.id) {
    return reply.code(404).send({ error: 'not found' });
  }
  return designViewFromRow(row);
});

app.patch('/designs/:id', { preHandler: requireAuth }, async (req, reply) => {
  const { id } = req.params as { id: string };
  const row = selectDesignRow.get(id) as DesignRow | undefined;
  if (!row || row.userId !== req.user!.id) {
    return reply.code(404).send({ error: 'not found' });
  }
  const body = req.body as { name?: unknown; state?: unknown } | null;
  if (!body || typeof body !== 'object') {
    return reply.code(400).send({ error: 'body must be a JSON object' });
  }
  let nameVal: string | null = null;
  if (body.name !== undefined) {
    const n = String(body.name).trim();
    if (!n) return reply.code(400).send({ error: 'name cannot be empty' });
    nameVal = n;
  }
  let stateVal: string | null = null;
  if (body.state !== undefined) {
    if (!body.state || typeof body.state !== 'object') {
      return reply.code(400).send({ error: 'state must be an object' });
    }
    stateVal = JSON.stringify(body.state);
  }
  updateDesignFields.run({ id, userId: req.user!.id, name: nameVal, state: stateVal });
  const updated = selectDesignRow.get(id) as DesignRow;
  return designViewFromRow(updated);
});

app.delete('/designs/:id', { preHandler: requireAuth }, async (req, reply) => {
  const { id } = req.params as { id: string };
  const result = deleteDesignForUser.run(id, req.user!.id);
  if (result.changes === 0) {
    return reply.code(404).send({ error: 'not found' });
  }
  return { id, deleted: true };
});

// --- Designer sessions endpoints ----------------------------------------

app.get('/designer/sessions', { preHandler: requireAuth }, async (req) => {
  return listDesignerSessionsForUser.all(req.user!.id);
});

app.post('/designer/sessions', { preHandler: requireAuth }, async (req, reply) => {
  const body = req.body as {
    templateId?: unknown;
    sourceKind?: unknown;
    sourceId?: unknown;
    styleSpec?: unknown;
    directorScript?: unknown;
    firstMessage?: unknown;
    messages?: unknown;
  } | null;
  if (!body || typeof body !== 'object') {
    return reply.code(400).send({ error: 'body must be a JSON object' });
  }
  const sourceKind = String(body.sourceKind ?? '');
  if (sourceKind !== 'stock' && sourceKind !== 'job') {
    return reply.code(400).send({ error: 'sourceKind must be "stock" or "job"' });
  }
  const sourceId = String(body.sourceId ?? '').trim();
  if (!sourceId) return reply.code(400).send({ error: 'sourceId is required' });
  const templateId = String(body.templateId ?? 'reel-clone');
  if (body.styleSpec === undefined || typeof body.styleSpec !== 'object' || body.styleSpec === null) {
    return reply.code(400).send({ error: 'styleSpec must be an object' });
  }
  const firstMessage = typeof body.firstMessage === 'string' ? body.firstMessage : '';
  const messages = Array.isArray(body.messages) ? body.messages : [];

  const id = randomUUID();
  insertDesignerSession.run({
    id,
    userId: req.user!.id,
    title: deriveSessionTitle(firstMessage),
    templateId,
    sourceKind,
    sourceId,
    styleSpec: JSON.stringify(body.styleSpec),
    directorScript:
      body.directorScript !== undefined && body.directorScript !== null
        ? JSON.stringify(body.directorScript)
        : null,
    messages: JSON.stringify(messages),
  });
  const row = selectDesignerSessionRow.get(id) as DesignerSessionRow | undefined;
  if (!row) return reply.code(500).send({ error: 'session insert disappeared' });
  return designerSessionViewFromRow(row);
});

app.get('/designer/sessions/:id', { preHandler: requireAuth }, async (req, reply) => {
  const { id } = req.params as { id: string };
  const row = selectDesignerSessionRow.get(id) as DesignerSessionRow | undefined;
  const owned = requireOwnership(req, reply, row);
  if (!owned) return reply;
  return designerSessionViewFromRow(owned);
});

app.patch('/designer/sessions/:id', { preHandler: requireAuth }, async (req, reply) => {
  const { id } = req.params as { id: string };
  const row = selectDesignerSessionRow.get(id) as DesignerSessionRow | undefined;
  const owned = requireOwnership(req, reply, row);
  if (!owned) return reply;
  const body = req.body as {
    title?: unknown;
    messages?: unknown;
    styleSpec?: unknown;
    // null = explicit clear; undefined = don't touch.
    directorScript?: unknown;
  } | null;
  if (!body || typeof body !== 'object') {
    return reply.code(400).send({ error: 'body must be a JSON object' });
  }
  let titleVal: string | null = null;
  if (body.title !== undefined) {
    const t = String(body.title).trim();
    if (!t) return reply.code(400).send({ error: 'title cannot be empty' });
    titleVal = t.length > 60 ? t.slice(0, 60).trimEnd() + '…' : t;
  }
  let messagesVal: string | null = null;
  if (body.messages !== undefined) {
    if (!Array.isArray(body.messages)) {
      return reply.code(400).send({ error: 'messages must be an array' });
    }
    messagesVal = JSON.stringify(body.messages);
  }
  let styleSpecVal: string | null = null;
  if (body.styleSpec !== undefined) {
    if (!body.styleSpec || typeof body.styleSpec !== 'object') {
      return reply.code(400).send({ error: 'styleSpec must be an object' });
    }
    styleSpecVal = JSON.stringify(body.styleSpec);
  }
  // directorScript needs a tri-state: undefined = leave alone, null =
  // clear, object = replace. The prepared statement decodes the '__null__'
  // sentinel back to a SQL NULL on the column.
  let directorScriptVal: string | null = null;
  if (body.directorScript !== undefined) {
    if (body.directorScript === null) {
      directorScriptVal = '__null__';
    } else if (typeof body.directorScript !== 'object') {
      return reply
        .code(400)
        .send({ error: 'directorScript must be an object or null' });
    } else {
      directorScriptVal = JSON.stringify(body.directorScript);
    }
  }
  updateDesignerSessionFields.run({
    id,
    userId: req.user!.id,
    title: titleVal,
    messages: messagesVal,
    styleSpec: styleSpecVal,
    directorScript: directorScriptVal,
  });
  const updated = selectDesignerSessionRow.get(id) as DesignerSessionRow;
  return designerSessionViewFromRow(updated);
});

app.delete('/designer/sessions/:id', { preHandler: requireAuth }, async (req, reply) => {
  const { id } = req.params as { id: string };
  const result = deleteDesignerSessionForUser.run(id, req.user!.id);
  if (result.changes === 0) {
    return reply.code(404).send({ error: 'not found' });
  }
  return { id, deleted: true };
});

// Kick off a render of a design. Resolves the source video (stock or job),
// copies it into storage/inputs/ as the input for the new job, derives
// transcript + captionPlan from the design's caption track, packs the
// editor state into styleSpec.designer, and inserts a hidden job. The
// worker pipeline detects templateId='caption-designer' + a pre-populated
// transcript and skips the transcribe/enrich/face_detect stages.
app.post('/designs/:id/render', { preHandler: requireAuth }, async (req, reply) => {
  const { id } = req.params as { id: string };
  const row = selectDesignRow.get(id) as DesignRow | undefined;
  if (!row || row.userId !== req.user!.id) {
    return reply.code(404).send({ error: 'not found' });
  }

  // Resolve source path. Three flavors:
  //   - stock clip → on local disk under remotion/public/stock
  //   - job with local inputPath (legacy multipart upload)
  //   - job with s3:// inputPath (new user-video flow) — passed through
  //     untouched, the worker downloads to its workDir at render time.
  let sourceAbs: string;
  let sourceIsS3 = false;
  if (row.sourceKind === 'stock') {
    const detail = readStockClipDetail(row.sourceId);
    if (!detail) return reply.code(400).send({ error: `stock clip missing: ${row.sourceId}` });
    sourceAbs = join(STOCK_CLIPS_DIR, detail.meta.id, 'clip.mp4');
  } else {
    const job = selectJob.get(row.sourceId) as { inputPath?: string; userId?: string | null } | undefined;
    if (!job || job.userId !== req.user!.id || !job.inputPath) {
      return reply.code(400).send({ error: `source job missing or expired: ${row.sourceId}` });
    }
    sourceIsS3 = parseS3Uri(job.inputPath) !== null;
    if (!sourceIsS3 && !existsSync(job.inputPath)) {
      return reply.code(400).send({ error: 'source job input file no longer on disk' });
    }
    sourceAbs = job.inputPath;
  }

  // For s3:// sources we don't need to copy — the canonical asset lives
  // on S3 forever (until the user deletes the upload) and the worker's
  // ensureLocalInput downloads it into the per-job workDir at render time.
  // For local sources (stock, legacy job) we still copy into the inputs
  // dir so this render's cleanup doesn't touch the original.
  const newJobId = randomUUID();
  let newInputPath: string;
  if (sourceIsS3) {
    newInputPath = sourceAbs;
  } else {
    const inputsDir = join(STORAGE_DIR, 'inputs');
    await mkdir(inputsDir, { recursive: true });
    newInputPath = join(inputsDir, `${newJobId}${extname(sourceAbs) || '.mp4'}`);
    await pipeline(createReadStream(sourceAbs), createWriteStream(newInputPath));
  }

  // Derive transcript + captionPlan from the design's caption track. The
  // design also carries the user's chosen templateId + base styleSpec, set
  // via the form pane. For caption-designer renders, the editor's tracks +
  // groupStyles get packed into styleSpec.designer so the composition can
  // place groups at their authored positions.
  const state = JSON.parse(row.state) as {
    tracks: Array<any>;
    groupStyles: Record<string, any>;
    durationSec?: number;
    templateId?: string;
    styleSpec?: Record<string, any>;
    // The whole-video scene plan when the agent's apply_director_script ran.
    // Threaded straight through to the renderer's <CueLayer> so audio cues
    // fire identically to the live preview.
    directorScript?: unknown | null;
  };
  const captionTrack = state.tracks.find((t) => t?.type === 'captions');
  const captionWords: Array<{ id: string; text: string; start: number; duration: number; groupId: string }> =
    captionTrack?.items ?? [];
  const groups: Array<any> = captionTrack?.groups ?? [];
  const wordGroupAssignments: Record<string, string> = {};
  for (const w of captionWords) wordGroupAssignments[w.id] = w.groupId;

  const transcriptJson: Transcript = {
    language: 'en',
    duration: state.durationSec ?? 0,
    words: captionWords.map((w) => ({
      word: w.text,
      start: w.start,
      end: w.start + w.duration,
      confidence: 1,
    })),
  };
  const captionPlanJson: CaptionPlan = {
    chunks: [],
    groups: groups.map((g) => ({
      id: g.id,
      name: g.name,
      styleId: g.styleId,
      transform: g.transform,
    })),
    wordGroupAssignments,
  };

  const renderTemplateId = isValidTemplateId(state.templateId ?? '')
    ? (state.templateId as TemplateId)
    : 'caption-designer';
  const baseStyleSpec = (state.styleSpec ?? {}) as Record<string, unknown>;
  const renderStyleSpec =
    renderTemplateId === 'caption-designer'
      ? { ...baseStyleSpec, designer: { tracks: state.tracks, groupStyles: state.groupStyles } }
      : baseStyleSpec;

  const newRow = insertJobWithAnalysis.get({
    id: newJobId,
    userId: req.user!.id,
    inputPath: newInputPath,
    templateId: renderTemplateId,
    styleSpec: JSON.stringify(renderStyleSpec),
    transcript: JSON.stringify(transcriptJson),
    captionPlan: JSON.stringify(captionPlanJson),
    faces: 'null',
    directorScript:
      state.directorScript == null ? null : JSON.stringify(state.directorScript),
    keepInputUntil: null,
    hidden: 0,
  });
  return newRow;
});

// Still-frame preview against a stock clip. Mirrors POST /jobs/:id/preview
// but the source is a stock clip with a prebaked transcript instead of a
// job row. Used as fallback for templates that don't support live <Player>.
app.post('/themes/preview', { preHandler: requireAuth }, async (req, reply) => {
  const body = req.body as {
    clipId?: unknown;
    templateId?: unknown;
    styleSpec?: unknown;
    frameSec?: unknown;
  } | null;
  if (!body || typeof body !== 'object') {
    return reply.code(400).send({ error: 'body must be a JSON object' });
  }
  const clipId = String(body.clipId ?? '');
  const detail = readStockClipDetail(clipId);
  if (!detail) {
    return reply.code(400).send({ error: `unknown stock clip: ${clipId}` });
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
  const frameSec = Number.isFinite(body.frameSec) ? Number(body.frameSec) : 0;
  const tmp = await mkdtemp(join(tmpdir(), 'theme-preview-'));
  const pngPath = join(tmp, 'preview.png');
  try {
    await renderStillFrame({
      inputVideo: join(STOCK_CLIPS_DIR, detail.meta.id, 'clip.mp4'),
      transcript: detail.transcript,
      captionPlan: detail.captionPlan,
      faces: null,
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
    req.log.error({ err }, 'theme preview render failed');
    return reply
      .code(500)
      .send({ error: 'theme preview render failed', message: (err as Error).message });
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => undefined);
  }
});

app.post('/jobs', { preHandler: requireAuth }, async (req, reply) => {
  // JSON path: { userVideoId, styleSpec?, templateId?, preset?, keepInputMinutes?, hidden? }.
  // Used by the new upload flow — the browser already PUT the file to S3
  // via /uploads/init + /uploads/:id/finalize, so this call is metadata-only.
  // The multipart path below is preserved for legacy clients / tests.
  if (!req.isMultipart()) {
    const body = (req.body ?? {}) as {
      userVideoId?: unknown;
      styleSpec?: unknown;
      templateId?: unknown;
      preset?: unknown;
      keepInputMinutes?: unknown;
      hidden?: unknown;
    };
    const userVideoId = typeof body.userVideoId === 'string' ? body.userVideoId : null;
    if (!userVideoId) {
      return reply.code(400).send({ error: 'userVideoId is required' });
    }
    const uv = selectUserVideoForUser.get(userVideoId, req.user!.id) as
      | {
          id: string;
          s3Bucket: string;
          s3Key: string;
          status: string;
          widthPx: number | null;
          heightPx: number | null;
        }
      | undefined;
    if (!uv) return reply.code(404).send({ error: 'upload not found' });
    if (uv.status !== 'ready') {
      return reply.code(409).send({ error: 'upload not finalized', status: uv.status });
    }

    // Backfill dims at job-creation time if the upload still has NULL
    // widthPx/heightPx (uploaded before the server-side probe fallback,
    // or a probe failure that wasn't retried). This means horizontal
    // sources open in the right canvas even for older uploads.
    if (uv.widthPx == null || uv.heightPx == null) {
      const probed = await probeUserVideoDims(uv.s3Bucket, uv.s3Key);
      if (probed) {
        markUserVideoReady.run({
          id: uv.id,
          userId: req.user!.id,
          sizeBytes: null,
          durationSec: null,
          widthPx: probed.widthPx,
          heightPx: probed.heightPx,
        });
        uv.widthPx = probed.widthPx;
        uv.heightPx = probed.heightPx;
      }
    }

    const styleSpecRaw =
      body.styleSpec && typeof body.styleSpec === 'object'
        ? (body.styleSpec as Record<string, unknown>)
        : {};
    const presetId = typeof body.preset === 'string' ? body.preset : null;
    const templateIdField = typeof body.templateId === 'string' ? body.templateId : null;
    const keepInputMinutesRaw = Number(body.keepInputMinutes);
    const keepInputMinutes =
      Number.isFinite(keepInputMinutesRaw) && keepInputMinutesRaw > 0
        ? Math.min(keepInputMinutesRaw, 60 * 24)
        : null;
    const hidden = body.hidden === true || body.hidden === 'true' || body.hidden === 1 ? 1 : 0;

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
      inputPath: `s3://${uv.s3Bucket}/${uv.s3Key}`,
      templateId: resolvedTemplateId,
      styleSpec: JSON.stringify(parsed.data),
      keepInputUntil,
      hidden,
      userVideoId: uv.id,
      widthPx: uv.widthPx,
      heightPx: uv.heightPx,
    });
    return job;
  }

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
    userVideoId: null,
    // Multipart legacy path — dims are populated by the worker via
    // ffprobe at render-time. Editor falls back to 1080×1920 for legacy
    // jobs and that's been correct historically.
    widthPx: null,
    heightPx: null,
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
  // playing inline in a <video> tag). For Lambda-stored outputs we used to
  // 302-redirect to a presigned S3 URL with the `Content-Disposition`
  // override baked in. That works, but the redirect always causes a brief
  // navigation visible in the URL bar / new-tab flash — the request has
  // to go cross-origin to S3 and back.
  //
  // To get a TRULY silent download (same tab, no URL change, no flash),
  // stream the S3 object server-side and relay the bytes with our own
  // `Content-Disposition: attachment` header. The browser sees a
  // same-origin response and saves it without any navigation.
  //
  // Without `?download` we still 302 to a presigned URL so the editor's
  // <video> tag can stream the rendered output for inline preview.
  const downloadName = (req.query as { download?: string } | null)?.download;
  const s3 = parseS3Uri(row.outputPath);
  if (s3) {
    if (downloadName) {
      try {
        const { body, contentLength } = await fetchOutputStream(row.outputPath);
        reply.header('content-type', 'video/mp4');
        if (typeof contentLength === 'number') {
          reply.header('content-length', contentLength);
        }
        const safe = downloadName.replace(/"/g, '');
        reply.header(
          'content-disposition',
          `attachment; filename="${safe}"`,
        );
        return reply.send(body);
      } catch (err) {
        req.log.error({ err }, `s3 stream failed for ${row.outputPath}`);
        return reply.code(502).send({
          error: 'could not stream output',
          message: (err as Error).message,
        });
      }
    }
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

// Multi-turn agentic caption editor for /agent/new. Stateless on the wire —
// LangGraph's MemorySaver owns the conversation history per threadId. The
// model returns a staged patch which the client applies via applyThemePatch().
// Soft cap of 30 calls/hour/user lives in agentChat.ts to honor the
// "avoid API credit burn" preference.
app.post('/agent/chat', { preHandler: requireAuth }, async (req, reply) => {
  const body = req.body as {
    threadId?: string;
    message?: string;
    currentSpec?: Record<string, unknown>;
    templateId?: string;
    selectedWord?: { idx: number; text: string; t: number; d: number };
    transcriptSummary?: { totalWords: number; durationSec: number };
    transcript?: PlannerWord[];
    directorScript?: unknown;
    model?: string;
  };
  if (!body?.threadId || typeof body.threadId !== 'string') {
    return reply.code(400).send({ error: 'threadId is required' });
  }
  if (!body?.message || typeof body.message !== 'string' || body.message.trim().length === 0) {
    return reply.code(400).send({ error: 'message is required' });
  }
  if (!body?.templateId || typeof body.templateId !== 'string') {
    return reply.code(400).send({ error: 'templateId is required' });
  }
  try {
    const result = await runAgentChat({
      threadId: body.threadId,
      userId: req.user!.id,
      message: body.message.trim(),
      currentSpec: body.currentSpec ?? {},
      templateId: body.templateId,
      selectedWord: body.selectedWord,
      transcriptSummary: body.transcriptSummary,
      transcript: body.transcript,
      directorScript: body.directorScript ?? null,
      model: body.model,
    });
    return result;
  } catch (err) {
    req.log.error({ err }, 'agent chat failed');
    return reply.code(502).send({
      error: 'agent failed',
      message: (err as Error).message,
    });
  }
});

// POST /director/plan — Director planner endpoint. Day 9 of the Director
// feature. Takes a compact transcript + user prompt + optional currentScript,
// runs the proposeDirectorScript LangGraph node, returns a validated
// DirectorScript or an error. Used by the scaffold-sized agent path
// ("build me a cinematic reel from this clip") that auto-routes through
// the planner instead of the per-tweak ReAct loop.
app.post('/director/plan', { preHandler: requireAuth }, async (req, reply) => {
  const body = req.body as {
    transcript?: PlannerWord[];
    message?: string;
    currentScript?: unknown;
    model?: string;
  };
  if (!Array.isArray(body?.transcript) || body.transcript.length === 0) {
    return reply.code(400).send({ error: 'transcript must be a non-empty array of {idx, t, w}' });
  }
  if (!body?.message || typeof body.message !== 'string' || body.message.trim().length === 0) {
    return reply.code(400).send({ error: 'message is required' });
  }
  // Light shape check on transcript items — full validation happens inside
  // the planner if needed. We only protect against obviously broken inputs
  // here so we don't waste a Sonnet call on garbage.
  for (let i = 0; i < body.transcript.length; i++) {
    const w = body.transcript[i];
    if (
      !w ||
      typeof w.idx !== 'number' ||
      typeof w.t !== 'number' ||
      typeof w.w !== 'string'
    ) {
      return reply
        .code(400)
        .send({ error: `transcript[${i}] must be { idx: number, t: number, w: string }` });
    }
  }
  try {
    const result = await proposeDirectorScript({
      transcript: body.transcript,
      message: body.message.trim(),
      // currentScript validation defers to directorScriptSchema inside the
      // planner; passing it through untyped keeps this handler thin.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      currentScript: body.currentScript as any,
      model: body.model,
    });
    if (!result.ok) {
      // Planner reports validation/format failures cleanly — surface as 422
      // so the client can render the error instead of treating it as 5xx.
      return reply.code(422).send({
        error: 'director plan failed validation',
        message: result.error,
        attempts: result.attempts,
      });
    }
    return { script: result.script, attempts: result.attempts };
  } catch (err) {
    req.log.error({ err }, 'director plan failed');
    return reply.code(502).send({
      error: 'director plan failed',
      message: (err as Error).message,
    });
  }
});

// ─── User uploads (persistent S3-backed source videos) ────────────────────
//
// The browser uploads bytes straight to S3 via a presigned PUT and only talks
// to us for metadata. Three-step flow:
//
//   1. POST /uploads/init     → reserve a row + presigned PUT URL
//   2. (browser) PUT to S3    → bytes never touch the Fastify container
//   3. POST /uploads/:id/finalize → verify object landed, flip status to 'ready'
//
// The created user_video can then be used as a source for many render jobs
// via POST /jobs (JSON body) without re-uploading. The user-videos/ S3 prefix
// has a 90-day lifecycle safety net; intended retention is controlled by the
// user_videos row (rows persist indefinitely, deleted only via DELETE /uploads/:id).

const VIDEO_EXT_RE = /\.(mp4|mov|m4v|webm|mkv|avi|qt|3gp)$/i;
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB

function sniffMime(filename: string, declared: string | undefined): string {
  if (declared && /^video\//.test(declared)) return declared;
  const m = filename.toLowerCase().match(VIDEO_EXT_RE);
  if (!m) return 'application/octet-stream';
  const ext = m[1];
  if (ext === 'mp4' || ext === 'm4v') return 'video/mp4';
  if (ext === 'mov' || ext === 'qt') return 'video/quicktime';
  if (ext === 'webm') return 'video/webm';
  if (ext === 'mkv') return 'video/x-matroska';
  if (ext === 'avi') return 'video/x-msvideo';
  if (ext === '3gp') return 'video/3gpp';
  return 'application/octet-stream';
}

function userVideoView(row: Record<string, unknown>): Record<string, unknown> {
  // Drop internal-only fields before returning to the client. The bucket /
  // key are server-side details; the browser only ever sees presigned URLs.
  const { s3Bucket: _b, s3Key: _k, ...rest } = row as { s3Bucket: string; s3Key: string };
  return rest;
}

// Server-side ffprobe fallback for source video dimensions. ffprobe is happy
// to read HTTP URLs — it only fetches the moov atom header bytes, not the
// whole file, so this completes in ~500ms even for 2 GB inputs. Used when
// the browser-side probe failed (HEVC .mov from iPhone is the common
// offender — the <video> element's videoWidth stays 0 even after
// loadedmetadata for some codecs/browsers, leaving widthPx NULL on the row).
//
// Returns null when ffprobe fails so callers can keep going with NULL dims
// (the editor falls back to its 1080×1920 default in that case).
async function probeUserVideoDims(
  bucket: string,
  s3Key: string,
): Promise<{ widthPx: number; heightPx: number; durationSec: number } | null> {
  try {
    const url = await presignOutputUrl(`s3://${bucket}/${s3Key}`, 600);
    const meta = await ffprobe(url);
    if (!(meta.width > 0 && meta.height > 0)) return null;
    return {
      widthPx: Math.round(meta.width),
      heightPx: Math.round(meta.height),
      durationSec: meta.duration > 0 ? meta.duration : 0,
    };
  } catch (err) {
    console.warn(
      `server probe failed for ${s3Key}: ${(err as Error).message}`,
    );
    return null;
  }
}

app.post('/uploads/init', { preHandler: requireAuth }, async (req, reply) => {
  const body = (req.body ?? {}) as {
    filename?: unknown;
    mimeType?: unknown;
    sizeBytes?: unknown;
  };
  const filename = typeof body.filename === 'string' ? body.filename.trim() : '';
  if (!filename) return reply.code(400).send({ error: 'filename is required' });
  if (!VIDEO_EXT_RE.test(filename)) {
    return reply.code(400).send({ error: 'filename must end in a video extension' });
  }
  const sizeBytes =
    typeof body.sizeBytes === 'number' && Number.isFinite(body.sizeBytes)
      ? Math.floor(body.sizeBytes)
      : null;
  if (sizeBytes != null && sizeBytes > MAX_UPLOAD_BYTES) {
    return reply.code(413).send({
      error: `file too large (max ${MAX_UPLOAD_BYTES} bytes)`,
      sizeBytes,
      max: MAX_UPLOAD_BYTES,
    });
  }
  const declaredMime = typeof body.mimeType === 'string' ? body.mimeType : undefined;
  const mimeType = sniffMime(filename, declaredMime);

  let bucket: string;
  try {
    bucket = getUploadBucket();
  } catch (err) {
    req.log.error({ err }, 'upload bucket not configured');
    return reply
      .code(500)
      .send({ error: 'upload not configured', message: (err as Error).message });
  }

  const id = randomUUID();
  const extMatch = filename.toLowerCase().match(VIDEO_EXT_RE);
  const ext = extMatch ? `.${extMatch[1]}` : '.mp4';
  const s3Key = `user-videos/${id}${ext}`;

  let putUrl: string;
  try {
    putUrl = await presignPutUrl(bucket, s3Key, mimeType);
  } catch (err) {
    req.log.error({ err }, 'presign PUT failed');
    return reply
      .code(502)
      .send({ error: 'could not sign upload URL', message: (err as Error).message });
  }

  const row = insertUserVideo.get({
    id,
    userId: req.user!.id,
    displayName: filename,
    originalFilename: filename,
    s3Bucket: bucket,
    s3Key,
    sizeBytes,
    mimeType,
  }) as Record<string, unknown>;

  return {
    uploadId: id,
    putUrl,
    // Echoed back so the browser knows which Content-Type to send on the
    // PUT — presigned URLs lock the header in at sign time, so mismatched
    // requests are rejected by S3 with a SignatureDoesNotMatch error.
    contentType: mimeType,
    expiresInSec: 900,
    upload: userVideoView(row),
  };
});

app.post('/uploads/:id/finalize', { preHandler: requireAuth }, async (req, reply) => {
  const { id } = req.params as { id: string };
  const body = (req.body ?? {}) as {
    durationSec?: unknown;
    widthPx?: unknown;
    heightPx?: unknown;
  };
  const row = selectUserVideoForUser.get(id, req.user!.id) as
    | { id: string; s3Bucket: string; s3Key: string; status: string }
    | undefined;
  if (!row) return reply.code(404).send({ error: 'upload not found' });
  if (row.status === 'ready') {
    // Idempotent — finalize is safe to call twice (browser retry, reload mid-PUT).
    const fresh = selectUserVideoForUser.get(id, req.user!.id) as Record<string, unknown>;
    return userVideoView(fresh);
  }

  let head: { contentLength?: number; contentType?: string } | null;
  try {
    head = await headObject(row.s3Bucket, row.s3Key);
  } catch (err) {
    req.log.error({ err }, `head object failed for ${row.s3Key}`);
    return reply
      .code(502)
      .send({ error: 'could not verify upload', message: (err as Error).message });
  }
  if (!head) {
    return reply.code(409).send({ error: 'upload not received yet' });
  }

  const numOrNull = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
  let durationSec = numOrNull(body.durationSec);
  // Round dims to integers — ffprobe stores them as int, and decimal
  // pixel counts (which some browsers report for cropped sources) would
  // make the calculateMetadata math noisy.
  let widthPx = numOrNull(body.widthPx);
  let heightPx = numOrNull(body.heightPx);

  // Server-side fallback: if the browser-side probe didn't return dims
  // (HEVC iPhone .mov is the canonical case), run ffprobe against the
  // just-uploaded S3 object. Header-only — ~500ms even for 2 GB inputs.
  // We probe duration too if the client missed it, but we ONLY override
  // it when the client value is missing — the client probe is canonical
  // when present (it reads the file the user actually picked).
  if (widthPx == null || heightPx == null) {
    const probed = await probeUserVideoDims(row.s3Bucket, row.s3Key);
    if (probed) {
      widthPx ??= probed.widthPx;
      heightPx ??= probed.heightPx;
      durationSec ??= probed.durationSec || null;
    }
  }

  markUserVideoReady.run({
    id,
    userId: req.user!.id,
    sizeBytes: typeof head.contentLength === 'number' ? head.contentLength : null,
    durationSec,
    widthPx: widthPx != null ? Math.round(widthPx) : null,
    heightPx: heightPx != null ? Math.round(heightPx) : null,
  });
  const fresh = selectUserVideoForUser.get(id, req.user!.id) as Record<string, unknown>;
  return userVideoView(fresh);
});

app.get('/uploads', { preHandler: requireAuth }, async (req) => {
  const rows = listUserVideosForUser.all(req.user!.id) as Array<Record<string, unknown>>;
  return rows;
});

app.get('/uploads/:id', { preHandler: requireAuth }, async (req, reply) => {
  const { id } = req.params as { id: string };
  const row = selectUserVideoForUser.get(id, req.user!.id) as
    | (Record<string, unknown> & { s3Bucket: string; s3Key: string; status: string })
    | undefined;
  if (!row) return reply.code(404).send({ error: 'upload not found' });
  if (row.status !== 'ready') {
    return reply.code(409).send({ error: 'upload not finalized', status: row.status });
  }
  let videoUrl: string;
  try {
    videoUrl = await presignOutputUrl(`s3://${row.s3Bucket}/${row.s3Key}`);
  } catch (err) {
    req.log.error({ err }, `presign GET failed for ${row.s3Key}`);
    return reply
      .code(502)
      .send({ error: 'could not sign upload URL', message: (err as Error).message });
  }
  return { ...userVideoView(row), videoUrl };
});

app.patch('/uploads/:id', { preHandler: requireAuth }, async (req, reply) => {
  const { id } = req.params as { id: string };
  const body = (req.body ?? {}) as { displayName?: unknown };
  const next = typeof body.displayName === 'string' ? body.displayName.trim() : '';
  if (!next) return reply.code(400).send({ error: 'displayName is required' });
  if (next.length > 200) {
    return reply.code(400).send({ error: 'displayName too long (max 200 chars)' });
  }
  const row = selectUserVideoForUser.get(id, req.user!.id);
  if (!row) return reply.code(404).send({ error: 'upload not found' });
  renameUserVideo.run({ id, userId: req.user!.id, displayName: next });
  const fresh = selectUserVideoForUser.get(id, req.user!.id) as Record<string, unknown>;
  return userVideoView(fresh);
});

app.delete('/uploads/:id', { preHandler: requireAuth }, async (req, reply) => {
  const { id } = req.params as { id: string };
  const row = selectUserVideoForUser.get(id, req.user!.id) as
    | { id: string; s3Bucket: string; s3Key: string }
    | undefined;
  if (!row) return reply.code(404).send({ error: 'upload not found' });
  const active = countActiveJobsForUserVideo.get(id) as { n: number };
  if (active.n > 0) {
    return reply.code(409).send({
      error: 'upload has active jobs',
      message: `${active.n} job(s) are still running against this upload — wait for them to finish or fail before deleting.`,
    });
  }
  // S3 delete first, DB row second. If S3 fails we'd rather keep the row
  // (so the user can retry) than orphan the object.
  try {
    await deleteObject(row.s3Bucket, row.s3Key);
  } catch (err) {
    req.log.error({ err }, `s3 delete failed for ${row.s3Key}`);
    return reply
      .code(502)
      .send({ error: 'could not delete upload from storage', message: (err as Error).message });
  }
  deleteUserVideoForUser.run(id, req.user!.id);
  return reply.code(204).send();
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

// Browser PUTs to S3 are cross-origin. Install a CORS rule on the upload
// bucket so the user-uploads flow works without manual AWS console steps.
// Idempotent + non-fatal — if AWS creds are missing or the bucket isn't
// configured yet, the upload endpoints return a clear error on first use.
// `WEB_ORIGIN` (optional) lets the operator pass the production origin
// alongside the dev defaults the helper bakes in.
try {
  const bucket = getUploadBucket();
  const extraOrigins = process.env.WEB_ORIGIN
    ? process.env.WEB_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean)
    : [];
  await ensureUploadCors(bucket, extraOrigins);
} catch (err) {
  app.log.warn(
    { err: (err as Error).message },
    'upload bucket / cors not configured — /uploads/* will 500 until fixed',
  );
}

// MCP server (single chat tool, delegates to Atelier). Auth happens inside
// mountMcp via the requireApiKey middleware — bearer tokens for MCP clients,
// session cookies for browser-side testing.
mountMcp(app);

const port = Number(process.env.PORT ?? 3000);
await app.listen({ port, host: '0.0.0.0' });
