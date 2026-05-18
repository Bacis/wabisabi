-- camelCase column names so the app layer can use rows directly without a
-- snake-to-camel transform. JSON payloads are stored as TEXT — SQLite treats
-- JSON as plain text and we (de)serialize at the app boundary.

-- Users + sessions for the dashboard. Invite-only — no public signup; an
-- admin creates users via scripts/admin.ts. passwordHash is scrypt
-- (`scrypt$N$r$p$saltB64$hashB64`). Email is case-insensitive.
create table if not exists users (
  id           text primary key,
  email        text not null collate nocase,
  passwordHash text not null,
  role         text not null default 'user',                 -- 'user' | 'admin'
  createdAt    text not null default (datetime('now')),
  updatedAt    text not null default (datetime('now'))
);

create unique index if not exists users_email_idx on users(email);

-- Server-side sessions. The cookie value is a 32-byte random token; the
-- column stores its sha256 so a DB read can't replay an active session.
-- expiresAt slides forward on activity (see src/auth/sessions.ts).
create table if not exists sessions (
  id          text primary key,                             -- sha256(token)
  userId      text not null references users(id) on delete cascade,
  createdAt   text not null default (datetime('now')),
  expiresAt   text not null,
  lastSeenAt  text not null default (datetime('now'))
);

create index if not exists sessions_userId_idx on sessions(userId);
create index if not exists sessions_expiresAt_idx on sessions(expiresAt);

create table if not exists jobs (
  id            text primary key,
  status        text not null default 'queued',
  stage         text,
  inputPath     text not null,
  outputPath    text,
  templateId    text not null,
  styleSpec     text not null,           -- JSON
  transcript    text,                    -- JSON
  captionPlan   text,                    -- JSON: LLM-derived chunks + emphasis
  faces         text,                    -- JSON: per-sample face boxes
  progress      text,                    -- JSON: render progress snapshot
  -- Whole-video scene plan from the agent's apply_director_script tool.
  -- The renderer threads this into <CueLayer> for audio cue playback; the
  -- live preview already passes it, so storing + plumbing it here keeps
  -- preview ↔ render prop bags identical.
  directorScript text,                   -- JSON: DirectorScript | null
  error         text,
  attempts      integer not null default 0,
  createdAt     text not null default (datetime('now')),
  updatedAt     text not null default (datetime('now')),
  startedAt     text,
  finishedAt    text,
  lockedAt      text
);

create index if not exists jobs_queued_idx
  on jobs (createdAt)
  where status = 'queued';

-- Phase D: user-saved custom style presets. The built-in presets live in
-- src/shared/presets.ts as a constant; anything the user saves via
-- POST /presets lands here and is unioned into GET /presets at read time.
create table if not exists custom_presets (
  id              text primary key,
  name            text not null,
  description     text not null default '',
  templateId      text not null,
  styleSpec       text not null,        -- JSON
  createdAt       text not null default (datetime('now')),
  -- Themes feature: a custom_preset is a "theme" once it has an owner. Drafts
  -- have isPublished=0 and only the owner sees them; isPublished=1 surfaces
  -- the row in the community feed. showcaseClipId pins a stock clip
  -- (remotion/public/stock/<id>/) so the public viewer can render the theme
  -- live in the browser without storing an MP4 anywhere.
  isPublished     integer not null default 0,
  publishedAt     text,
  showcaseClipId  text
);
-- The partial index on (publishedAt) where isPublished = 1 is created in
-- src/db.ts AFTER the ensureColumn migrations, because pre-existing DBs
-- need the columns added by ALTER TABLE before the index can be built.

-- Video producer: a "production" is a multi-file batch (images + videos) that
-- the orchestrator agent analyzes, cuts, and compiles into a short video.
-- Kept in a separate table from `jobs` so the single-video flow stays
-- untouched; the two pipelines share nothing at the DB level.
create table if not exists productions (
  id              text primary key,
  status          text not null default 'queued',       -- queued|running|done|failed
  stage           text,                                 -- analyze_assets|detect_mode|orchestrate|cut_segments|narrate|pick_hook|compose_render
  capSeconds      integer not null default 45,          -- 20..60 user cap
  prompt          text,                                 -- optional creative brief from the uploader
  presetId        text,                                 -- preset id the user picked at upload time (null = apply mode default)
  voiceId         text,                                 -- overrides ELEVENLABS_VOICE_ID
  userId          text,                                 -- submitter id (e.g. Telegram ctx.from.id); null for anonymous API callers
  username        text,                                 -- display handle if available; not used for rotation, just for debugging
  hookFile        text,                                 -- basename of the hook clip prepended to this render (null = no hook, e.g. folder empty)
  mode            text,                                 -- speaker_montage|narrated_story (null until detected)
  productionPlan  text,                                 -- JSON: orchestrator LLM output
  timeline        text,                                 -- JSON: ClipEntry[] (final, with cut paths)
  narrationPath   text,                                 -- absolute path to narration.mp3 (narrated_story only)
  narrationScript text,                                 -- JSON: Array<{text,startSec,endSec}>
  outputPath      text,
  templateId      text not null default 'story-composition',
  styleSpec       text not null,                        -- JSON
  progress        text,                                 -- JSON: render progress snapshot
  error           text,
  attempts        integer not null default 0,
  createdAt       text not null default (datetime('now')),
  updatedAt       text not null default (datetime('now')),
  startedAt       text,
  finishedAt      text,
  lockedAt        text
);

create index if not exists productions_queued_idx
  on productions (createdAt)
  where status = 'queued';

-- One row per uploaded media file. The orchestrator reads these rows as its
-- input "asset library"; the cutter reads them to know which source file to
-- ffmpeg.
create table if not exists production_assets (
  id              text primary key,
  productionId    text not null references productions(id) on delete cascade,
  ordinal         integer not null,          -- upload order (stable id within a production)
  kind            text not null,             -- 'video' | 'image'
  path            text not null,             -- absolute local path
  mime            text,
  durationSec     real,                      -- null for images
  width           integer,
  height          integer,
  transcript      text,                      -- JSON Transcript | null (video only)
  diarization     text,                      -- JSON: {segments:[{start,end,speaker}], speakerCount}
  faces           text,                      -- JSON FaceData | null (video only)
  analysis        text,                      -- JSON: Claude multimodal classification
  hasSpeech       integer not null default 0, -- derived from transcript
  speakerCoverage real,                      -- fraction of duration with speech
  role            text,                      -- 'speaker'|'broll'|'image' (post-classification)
  error           text,
  createdAt       text not null default (datetime('now'))
);

create index if not exists production_assets_prod_idx
  on production_assets (productionId, ordinal);

-- Per-user hook rotation history. Each (user, hook) pair is stored once; the
-- usedAt timestamp is bumped on re-use so least-recently-used ordering is
-- trivial after the user has seen every hook in the folder.
create table if not exists user_hook_history (
  userId    text not null,
  hookFile  text not null,                            -- basename, e.g. 'Spongebob.mp4'
  usedAt    text not null default (datetime('now')),
  primary key (userId, hookFile)
);

create index if not exists user_hook_history_user_idx
  on user_hook_history (userId, usedAt);

-- Caption Designer: a "design" is the persisted state of the canvas+timeline
-- editor on /themes/new. Independent from custom_presets/themes — themes are
-- a styleSpec for an existing template; a design carries its own tracks,
-- caption groups, group styles, and overlays. Rendering a design creates a
-- (hidden) job using templateId='caption-designer'.
create table if not exists designs (
  id            text primary key,
  userId        text not null references users(id) on delete cascade,
  name          text not null,
  sourceKind    text not null,                   -- 'stock' | 'job'
  sourceId      text not null,                   -- stockClipId or jobId
  templateId    text not null default 'caption-designer',
  state         text not null,                   -- JSON: EditorState minus volatile fields
  thumbnailPath text,
  createdAt     text not null default (datetime('now')),
  updatedAt     text not null default (datetime('now'))
);

create index if not exists designs_user_idx on designs (userId, updatedAt);

-- Designer sessions: one row per agent conversation at /designer/:id. Owns the
-- chat transcript (UIMessage[]) + the editor source ref + the latest styleSpec
-- snapshot so reopening the URL restores the user exactly where they left off.
-- A row is minted on the user's first chat turn; abandoned drafts never land
-- here. Drops when the user is deleted (no orphan sessions).
create table if not exists designer_sessions (
  id             text primary key,
  userId         text not null references users(id) on delete cascade,
  title          text not null,                     -- auto-derived from first user message
  templateId     text not null default 'reel-clone',
  sourceKind     text not null,                     -- 'stock' | 'job'
  sourceId       text not null,
  styleSpec      text not null,                     -- JSON: latest editor styleSpec
  directorScript text,                              -- JSON: DirectorScript | null (whole-video scene plan)
  messages       text not null,                     -- JSON: UIMessage[] transcript
  createdAt      text not null default (datetime('now')),
  updatedAt      text not null default (datetime('now'))
);

create index if not exists designer_sessions_user_idx
  on designer_sessions (userId, updatedAt);

-- User-uploaded source videos. A user_video is a persistent asset on S3,
-- independent of any render job; one upload can back many jobs over time.
-- The browser uploads bytes straight to S3 via a presigned PUT and the
-- server only stores the metadata + key. status='pending' until the client
-- calls /uploads/:id/finalize after the PUT succeeds; failed/abandoned rows
-- get garbage-collected by the worker (s3 lifecycle has a 90d safety net).
create table if not exists user_videos (
  id               text primary key,
  userId           text not null references users(id) on delete cascade,
  displayName      text not null,
  originalFilename text not null,
  s3Bucket         text not null,
  s3Key            text not null,                          -- e.g. user-videos/<id>.mp4
  sizeBytes        integer,
  durationSec      real,
  widthPx          integer,                                -- intrinsic source width  (nullable until probed)
  heightPx         integer,                                -- intrinsic source height (nullable until probed)
  mimeType         text,
  status           text not null default 'pending',        -- pending|ready|failed
  createdAt        text not null default (datetime('now')),
  updatedAt        text not null default (datetime('now'))
);

create index if not exists user_videos_user_idx
  on user_videos (userId, createdAt desc);

-- Per-user MCP API keys. A user mints one or more from Settings → API Keys
-- and pastes the plaintext into their MCP client (Claude Desktop, Cursor,
-- etc.). The plaintext token is shown exactly once at creation; we store
-- only the scrypt hash. `keyPrefix` (first 12 chars, e.g. "wsk_live_ab")
-- is displayed in the listing so users can identify which key is which
-- without revealing it. `revokedAt` is soft-delete: revoked rows stay for
-- audit + so that requests bearing a revoked key get a clear 401 rather
-- than the misleading "key not found".
create table if not exists api_keys (
  id          text primary key,
  userId      text not null references users(id) on delete cascade,
  name        text not null,
  keyHash     text not null,                                -- scrypt hash of the plaintext token
  keyPrefix   text not null,                                -- "wsk_live_xxxx" (display only)
  createdAt   text not null default (datetime('now')),
  lastUsedAt  text,
  revokedAt   text
);

create index if not exists api_keys_user_idx on api_keys (userId, createdAt desc);
-- Unique on the prefix because it doubles as the lookup id: a key has the
-- form `wsk_live_<prefix12>_<secret40>`, the prefix12 part identifies the
-- row, and the secret40 part is scrypt-verified against keyHash. Without
-- this index, auth would O(N) scan every key in the table.
create unique index if not exists api_keys_prefix_idx on api_keys (keyPrefix);

-- Per-user, per-thread index for the Atelier LangGraph conversations. The
-- actual conversation history is owned by the SqliteSaver checkpointer
-- (separate tables it manages itself); this index table is what we use to
-- enforce per-user ownership of a threadId and (later) to surface a "your
-- recent conversations" UI without scanning checkpoint blobs.
create table if not exists agent_threads (
  id           text primary key,                            -- the threadId itself (caller-supplied UUID)
  userId       text not null references users(id) on delete cascade,
  createdAt    text not null default (datetime('now')),
  lastUsedAt   text not null default (datetime('now')),
  lastSummary  text,                                        -- last user message (truncated), best-effort label
  -- Running styleSpec accumulator for MCP threads. In the web app the
  -- browser store holds this between turns; for MCP we have no client
  -- store, so the chat handler reads this before each call and writes
  -- the patched result back after. Format: JSON, same shape as a
  -- styleSpec passed to /jobs.
  styleSpec    text,                                        -- JSON | null
  templateId   text                                         -- override, e.g. 'pop-words'
);

create index if not exists agent_threads_user_idx
  on agent_threads (userId, lastUsedAt desc);
