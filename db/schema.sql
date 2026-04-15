-- camelCase column names so the app layer can use rows directly without a
-- snake-to-camel transform. JSON payloads are stored as TEXT — SQLite treats
-- JSON as plain text and we (de)serialize at the app boundary.
create table if not exists jobs (
  id           text primary key,
  status       text not null default 'queued',
  stage        text,
  inputPath    text not null,
  outputPath   text,
  templateId   text not null,
  styleSpec    text not null,           -- JSON
  transcript   text,                    -- JSON
  captionPlan  text,                    -- JSON: LLM-derived chunks + emphasis
  faces        text,                    -- JSON: per-sample face boxes
  progress     text,                    -- JSON: render progress snapshot
  error        text,
  attempts     integer not null default 0,
  createdAt    text not null default (datetime('now')),
  updatedAt    text not null default (datetime('now')),
  startedAt    text,
  finishedAt   text,
  lockedAt     text
);

create index if not exists jobs_queued_idx
  on jobs (createdAt)
  where status = 'queued';

-- Phase D: user-saved custom style presets. The built-in presets live in
-- src/shared/presets.ts as a constant; anything the user saves via
-- POST /presets lands here and is unioned into GET /presets at read time.
create table if not exists custom_presets (
  id          text primary key,
  name        text not null,
  description text not null default '',
  templateId  text not null,
  styleSpec   text not null,        -- JSON
  createdAt   text not null default (datetime('now'))
);

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
