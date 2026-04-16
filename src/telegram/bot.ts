// Telegraf bot that exposes POST /productions to Telegram group chats.
//
// UX contract:
//   * Works only in group/supergroup chats. DMs are silently ignored.
//   * Bot only reacts when @mentioned in the message caption (or in the
//     caption of one of the items in an album).
//   * Supported media: photos, videos, and documents whose mime/ext
//     indicates a video or image. Stickers/audio/voice/etc. → friendly
//     error.
//   * Album submissions are debounced by `media_group_id` (Telegram
//     delivers each item as a separate update) and dispatched together
//     as a single /productions request.
//
// The bot does not touch the DB. It's a thin client over the existing
// loopback HTTP surface (POST /productions, GET /productions/:id,
// GET /productions/:id/output), which keeps the producer pipeline's
// contract intact.

import { Telegraf, Input, type Context } from 'telegraf';
import type { Message, MessageEntity, PhotoSize } from 'telegraf/types';
import { parseCaption, HELP_TEXT } from './flags.js';

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  throw new Error('TELEGRAM_BOT_TOKEN is required');
}

const API_BASE = process.env.TELEGRAM_API_BASE ?? `http://127.0.0.1:${process.env.PORT ?? 3000}`;
const POLL_TIMEOUT_MS = Number(process.env.TELEGRAM_POLL_TIMEOUT_MS ?? 20 * 60 * 1000);
const POLL_INTERVAL_MS = 4000;
const ALBUM_DEBOUNCE_MS = 1500;

// handlerTimeout defaults to 90_000ms in Telegraf 4 — updates whose
// handler doesn't resolve by then trigger an UnhandledPromiseRejection
// and (because we've configured no custom error handler) crash the
// process. We run polling that lasts up to 20 minutes after each
// submission, so we disable the timeout and rely on our own deadline.
export const bot = new Telegraf(token, { handlerTimeout: Infinity });

// Standalone /help: lets users discover flags without having to attach
// media. Works in DMs and groups (Telegraf routes `/help` and
// `/help@botname` to the same handler).
bot.command('help', async (ctx) => {
  await ctx.reply(HELP_TEXT, { parse_mode: 'Markdown' }).catch((err) => {
    console.error('[telegram] /help reply failed:', err);
  });
});

// ---------- Album debouncer --------------------------------------------------
//
// Telegram delivers each item in an album as a separate Update carrying the
// same `media_group_id`. There's no "album complete" event, so we buffer
// items by (chatId, media_group_id) and fire after a short debounce.

type MediaMessage = Message.PhotoMessage | Message.VideoMessage | Message.DocumentMessage;

type Buffered = {
  chatId: number;
  items: MediaMessage[];
  ctx: Context;
  timer: NodeJS.Timeout;
};

const buffers = new Map<string, Buffered>();

bot.on('message', async (ctx, next) => {
  const chatType = ctx.chat?.type;
  const msg = ctx.message as Partial<MediaMessage> & Message;
  const hasMedia = 'photo' in msg || 'video' in msg || 'document' in msg;
  const hasCaption = 'caption' in msg && typeof msg.caption === 'string';
  const mediaGroupId = (msg as { media_group_id?: string }).media_group_id;
  console.log(
    `[telegram] update chat=${chatType} from=${ctx.from?.username ?? ctx.from?.id} ` +
      `media=${hasMedia} caption=${hasCaption} media_group_id=${mediaGroupId ?? '-'}`,
  );

  if (chatType !== 'group' && chatType !== 'supergroup' && chatType !== 'private') {
    console.log(`[telegram] ignoring: unsupported chat type ${chatType}`);
    return;
  }

  if (!hasMedia) {
    console.log('[telegram] ignoring: no media attached');
    return next();
  }

  const mediaMsg = msg as MediaMessage;
  const groupId = (mediaMsg as { media_group_id?: string }).media_group_id;

  if (!groupId) {
    // Single-media message: dispatch immediately (album of size 1).
    // Fire-and-forget — dispatch polls for up to 20 minutes and we must
    // not block the update handler that long.
    dispatch(ctx, [mediaMsg]).catch((err) => {
      console.error('[telegram] dispatch failed:', err);
    });
    return;
  }

  const key = `${ctx.chat.id}:${groupId}`;
  const existing = buffers.get(key);
  if (existing) {
    existing.items.push(mediaMsg);
    clearTimeout(existing.timer);
    existing.timer = setTimeout(() => flushBuffer(key), ALBUM_DEBOUNCE_MS);
    return;
  }

  const buffered: Buffered = {
    chatId: ctx.chat.id,
    items: [mediaMsg],
    ctx,
    timer: setTimeout(() => flushBuffer(key), ALBUM_DEBOUNCE_MS),
  };
  buffers.set(key, buffered);
});

function flushBuffer(key: string): void {
  const buffered = buffers.get(key);
  if (!buffered) return;
  buffers.delete(key);
  // Sort by message_id so album ordering matches the sender's ordering —
  // the producer pipeline uses upload order as a stable asset ordinal.
  buffered.items.sort((a, b) => a.message_id - b.message_id);
  dispatch(buffered.ctx, buffered.items).catch((err) => {
    console.error('[telegram] dispatch failed:', err);
  });
}

// ---------- Dispatch: one album → one /productions job -----------------------

// Captured submitter info so we can tag them back in the final reply even
// though the render runs async and may take many minutes.
type Submitter = {
  id: number;
  username: string | undefined;
  firstName: string | undefined;
};

// Build a Markdown snippet that tags the user. Uses `tg://user?id=...`
// inline-link form (works whether or not the user has a public @handle
// and triggers a proper notification ping). Returns empty string if
// we couldn't identify the sender.
function mentionMd(u: Submitter | null): string {
  if (!u) return '';
  // Name shown in the link. Fall back to "@handle" text, then to "there".
  const raw = (u.firstName && u.firstName.trim()) || (u.username ? `@${u.username}` : 'there');
  // Escape Markdown-special chars in the display name so parse_mode
  // doesn't mangle the link. Inside `[...]` the risky chars are `]`,
  // `[`, and the emphasis markers `*`, `_`, `` ` ``.
  const safe = raw.replace(/[\\[\]*_`]/g, ' ').replace(/\s+/g, ' ').trim() || 'there';
  return `[${safe}](tg://user?id=${u.id})`;
}

async function dispatch(ctx: Context, items: MediaMessage[]): Promise<void> {
  const botUsername = ctx.botInfo?.username;
  if (!botUsername) return; // not launched yet; impossible in practice

  const submitter: Submitter | null = ctx.from
    ? {
        id: ctx.from.id,
        username: ctx.from.username,
        firstName: ctx.from.first_name,
      }
    : null;

  // Find a caption that @mentions the bot. The mention can live on any
  // item in an album (usually the first, but Telegram doesn't guarantee
  // that and some clients put it elsewhere).
  const mention = findBotMention(items, botUsername);
  if (!mention) {
    console.log(
      `[telegram] no @${botUsername} mention in ${items.length} item(s) — staying silent`,
    );
    return;
  }
  const raw = stripMentions(mention.caption, mention.entities).trim();
  const parsed = parseCaption(raw);

  // --help wins over everything else. Reply to the message that triggered
  // the help request so the user sees the context they asked from.
  if (parsed.help) {
    const firstId = items[0]?.message_id;
    await ctx.reply(HELP_TEXT, {
      parse_mode: 'Markdown',
      ...(firstId !== undefined ? { reply_parameters: { message_id: firstId } } : {}),
    });
    return;
  }

  // Bad flag → reply inline, do not queue. Cheap to retry.
  if (parsed.errors.length > 0) {
    const firstId = items[0]?.message_id;
    await ctx.reply(
      `⚠️ ${parsed.errors.join('\n')}\n\nTry \`/help\` to see available flags.`,
      {
        parse_mode: 'Markdown',
        ...(firstId !== undefined ? { reply_parameters: { message_id: firstId } } : {}),
      },
    );
    return;
  }

  const prompt = parsed.prompt;
  const extraFields = parsed.fields;
  console.log(
    `[telegram] dispatching: ${items.length} item(s), prompt="${prompt.slice(0, 80)}" ` +
      `flags=${Object.keys(extraFields).join(',') || '-'}`,
  );

  // Reject unsupported kinds before downloading anything.
  for (const item of items) {
    if (!isSupportedMedia(item)) {
      await ctx.reply(
        '⚠️ Only photos and videos are supported. Please resend without stickers/audio/voice notes.',
        { reply_parameters: { message_id: item.message_id } },
      );
      return;
    }
  }

  let statusMsgId: number | undefined;
  try {
    // Download each file via the Bot API. 20MB cap lives server-side;
    // on oversize, Telegram returns 400 with "file is too big".
    const files: DownloadedFile[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item) continue;
      const download = await downloadItem(ctx, item, i);
      if (download.kind === 'too-large') {
        await ctx.reply(
          '⚠️ File too large — Telegram Bot API caps uploads at 20MB. Try shorter clips or smaller images.',
          { reply_parameters: { message_id: item.message_id } },
        );
        return;
      }
      files.push(download.file);
    }

    // Post to /productions. Submitter info travels with the request so the
    // producer pipeline can do per-user hook rotation.
    const submit = await submitProduction(files, prompt, submitter, extraFields);
    if (!submit.ok) {
      await ctx.reply(`⚠️ Failed to queue render: ${submit.error}`);
      return;
    }

    // capSeconds here is the user's upper bound, not the actual output
    // length — phrase it as such so the ack doesn't lie.
    const assetWord = submit.assetCount === 1 ? 'file' : 'files';
    const flagsNote = describeFlags(extraFields);
    const statusMsg = await ctx.reply(
      `🎬 Got it — rendering your video from ${submit.assetCount} ${assetWord} (up to ${submit.capSeconds}s)${flagsNote}. Job \`${submit.id}\`.`,
      { parse_mode: 'Markdown' },
    );
    statusMsgId = statusMsg.message_id;

    // Poll until done / failed / timeout.
    const final = await pollProduction(submit.id);
    if (final.kind === 'done') {
      await sendResult(ctx, submit.id, submit.capSeconds, submitter);
    } else if (final.kind === 'failed') {
      const tag = mentionMd(submitter);
      await ctx.reply(`${tag ? tag + ' ' : ''}❌ Render failed: ${final.error ?? 'unknown error'}`, {
        parse_mode: 'Markdown',
      });
    } else {
      await ctx.reply(
        `⌛ Job \`${submit.id}\` is still running after ${Math.round(POLL_TIMEOUT_MS / 60000)} min — it'll post when finished if you keep the bot in the chat.`,
        { parse_mode: 'Markdown' },
      );
      // Keep polling without a hard cap in the background so the user
      // still gets their video. If the process dies first, so be it —
      // durable tracking is a follow-up.
      void pollForever(ctx, submit.id, submit.capSeconds, submitter);
    }
  } catch (err) {
    console.error('[telegram] dispatch error:', err);
    const msg = err instanceof Error ? err.message : String(err);
    try {
      await ctx.reply(`❌ Something went wrong: ${msg}`);
    } catch {
      // best-effort
    }
  }
  void statusMsgId; // reserved for future edit-message progress updates
}

// ---------- Mention / prompt parsing -----------------------------------------

function findBotMention(
  items: MediaMessage[],
  botUsername: string,
): { caption: string; entities: MessageEntity[] } | null {
  const target = `@${botUsername}`.toLowerCase();
  for (const item of items) {
    const caption = item.caption;
    const entities = item.caption_entities;
    if (!caption || !entities) continue;
    for (const ent of entities) {
      if (ent.type !== 'mention') continue;
      const text = caption.slice(ent.offset, ent.offset + ent.length).toLowerCase();
      if (text === target) {
        return { caption, entities };
      }
    }
  }
  return null;
}

function stripMentions(caption: string, entities: MessageEntity[]): string {
  // Remove mention ranges back-to-front so offsets stay valid.
  const mentions = entities
    .filter((e) => e.type === 'mention')
    .sort((a, b) => b.offset - a.offset);
  let out = caption;
  for (const m of mentions) {
    out = out.slice(0, m.offset) + out.slice(m.offset + m.length);
  }
  return out.replace(/\s+/g, ' ').trim();
}

// ---------- Media download ---------------------------------------------------

type DownloadedFile = {
  ordinal: number;
  buffer: Buffer;
  filename: string;
  mime: string;
};

type DownloadResult = { kind: 'ok'; file: DownloadedFile } | { kind: 'too-large' };

function isSupportedMedia(msg: MediaMessage): boolean {
  if ('photo' in msg && msg.photo) return true;
  if ('video' in msg && msg.video) return true;
  if ('document' in msg && msg.document) {
    const mime = msg.document.mime_type ?? '';
    return mime.startsWith('video/') || mime.startsWith('image/');
  }
  return false;
}

async function downloadItem(
  ctx: Context,
  msg: MediaMessage,
  ordinal: number,
): Promise<DownloadResult> {
  const file = resolveFile(msg);
  if (!file) throw new Error('no file_id on media message');

  let link: URL;
  try {
    link = await ctx.telegram.getFileLink(file.fileId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/too big/i.test(message) || /file is too big/i.test(message)) {
      return { kind: 'too-large' };
    }
    throw err;
  }

  const res = await fetch(link);
  if (!res.ok) {
    if (res.status === 400) {
      const body = await res.text();
      if (/too big/i.test(body)) return { kind: 'too-large' };
    }
    throw new Error(`getFile download failed: ${res.status} ${res.statusText}`);
  }
  const ab = await res.arrayBuffer();
  const buffer = Buffer.from(ab);

  // Derive filename + mime. The file link's pathname contains Telegram's
  // stored path (e.g. /videos/file_0.mp4); extract its extension.
  const pathExt = extname(link.pathname);
  const filename =
    file.filename ??
    `${String(ordinal).padStart(3, '0')}${pathExt || defaultExtFor(file.kind)}`;
  const mime = file.mime ?? defaultMimeFor(file.kind);

  return {
    kind: 'ok',
    file: { ordinal, buffer, filename, mime },
  };
}

type ResolvedFile = {
  fileId: string;
  filename?: string;
  mime?: string;
  kind: 'photo' | 'video' | 'document';
};

function resolveFile(msg: MediaMessage): ResolvedFile | null {
  if ('video' in msg && msg.video) {
    return {
      fileId: msg.video.file_id,
      filename: msg.video.file_name,
      mime: msg.video.mime_type,
      kind: 'video',
    };
  }
  if ('document' in msg && msg.document) {
    return {
      fileId: msg.document.file_id,
      filename: msg.document.file_name,
      mime: msg.document.mime_type,
      kind: 'document',
    };
  }
  if ('photo' in msg && msg.photo) {
    // Pick the largest size — Telegram returns an ascending array of
    // thumbnails, so the last entry is the original.
    const largest: PhotoSize | undefined = msg.photo[msg.photo.length - 1];
    if (!largest) return null;
    return { fileId: largest.file_id, kind: 'photo' };
  }
  return null;
}

function extname(path: string): string {
  const idx = path.lastIndexOf('.');
  if (idx < 0) return '';
  const ext = path.slice(idx);
  // Sanity-cap: extensions longer than 6 chars are probably noise.
  return ext.length <= 6 ? ext.toLowerCase() : '';
}

function defaultExtFor(kind: ResolvedFile['kind']): string {
  if (kind === 'video') return '.mp4';
  if (kind === 'photo') return '.jpg';
  return '.bin';
}

function defaultMimeFor(kind: ResolvedFile['kind']): string {
  if (kind === 'video') return 'video/mp4';
  if (kind === 'photo') return 'image/jpeg';
  return 'application/octet-stream';
}

// ---------- POST /productions ------------------------------------------------

type SubmitResult =
  | { ok: true; id: string; capSeconds: number; assetCount: number }
  | { ok: false; error: string };

async function submitProduction(
  files: DownloadedFile[],
  prompt: string,
  submitter: Submitter | null,
  extraFields: Record<string, string>,
): Promise<SubmitResult> {
  const form = new FormData();
  for (const f of files) {
    // Node's Blob/File constructors accept BlobPart[]; Buffer implements
    // the required Blob interface at runtime but TS types need a cast.
    const blob = new Blob([f.buffer as unknown as ArrayBuffer], { type: f.mime });
    form.append('files', blob, f.filename);
  }
  if (prompt.length > 0) form.append('prompt', prompt);
  // Per-user hook rotation keys off the Telegram user id (stable even when
  // the user changes their @handle). The username is purely for debugging.
  if (submitter) {
    form.append('userId', String(submitter.id));
    if (submitter.username) form.append('username', submitter.username);
  }
  // Parsed flags (voiceId / presetId / capSeconds / styleSpec). The API
  // validates each — we trust it to reject invalid combinations instead
  // of re-checking client-side.
  for (const [k, v] of Object.entries(extraFields)) {
    form.append(k, v);
  }

  const res = await fetch(`${API_BASE}/productions`, { method: 'POST', body: form });
  if (!res.ok) {
    let body = '';
    try {
      body = await res.text();
    } catch {
      /* ignore */
    }
    return { ok: false, error: `${res.status} ${res.statusText}${body ? ` — ${body}` : ''}` };
  }
  const json = (await res.json()) as {
    id: string;
    capSeconds: number;
    assetCount: number;
  };
  return { ok: true, id: json.id, capSeconds: json.capSeconds, assetCount: json.assetCount };
}

// ---------- Polling ----------------------------------------------------------

type PollResult =
  | { kind: 'done' }
  | { kind: 'failed'; error: string | null }
  | { kind: 'timeout' };

async function pollProduction(id: string): Promise<PollResult> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  console.log(
    `[telegram] poll start id=${id} deadline=${Math.round(POLL_TIMEOUT_MS / 1000)}s`,
  );
  let lastStage: string | null | undefined;
  let lastStatus: string | undefined;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    const status = await fetchStatus(id);
    if (status === null) continue; // transient error, retry
    // Only log on transitions to keep the output scannable.
    if (status.status !== lastStatus || status.stage !== lastStage) {
      console.log(`[telegram] poll id=${id} status=${status.status} stage=${status.stage ?? '-'}`);
      lastStatus = status.status;
      lastStage = status.stage;
    }
    if (status.status === 'done') return { kind: 'done' };
    if (status.status === 'failed') return { kind: 'failed', error: status.error };
  }
  console.warn(`[telegram] poll timeout id=${id}`);
  return { kind: 'timeout' };
}

async function pollForever(
  ctx: Context,
  id: string,
  capSeconds: number,
  submitter: Submitter | null,
): Promise<void> {
  // Used after the soft timeout so the user still gets their video if the
  // render finishes eventually. No upper bound; relies on the process
  // staying alive.
  while (true) {
    await sleep(POLL_INTERVAL_MS * 2);
    const status = await fetchStatus(id);
    if (status === null) continue;
    if (status.status === 'done') {
      await sendResult(ctx, id, capSeconds, submitter).catch((err) =>
        console.error('[telegram] late sendResult failed:', err),
      );
      return;
    }
    if (status.status === 'failed') {
      const tag = mentionMd(submitter);
      await ctx
        .reply(`${tag ? tag + ' ' : ''}❌ Render failed: ${status.error ?? 'unknown error'}`, {
          parse_mode: 'Markdown',
        })
        .catch(() => undefined);
      return;
    }
  }
}

async function fetchStatus(
  id: string,
): Promise<{ status: string; stage: string | null; error: string | null } | null> {
  try {
    const res = await fetch(`${API_BASE}/productions/${id}`);
    if (!res.ok) return null;
    const json = (await res.json()) as {
      status: string;
      stage?: string | null;
      error?: string | null;
    };
    return {
      status: json.status,
      stage: json.stage ?? null,
      error: json.error ?? null,
    };
  } catch {
    return null;
  }
}

// ---------- Final-status stats ----------------------------------------------

// Summary pulled from GET /productions/:id once the render is done — feeds
// the video caption so it reports ACTUAL output duration + wall-clock render
// time instead of the user's cap (which is only an upper bound).
type ProductionStats = {
  /** Sum of timeline clip durations — the true output length. Null if timeline missing. */
  outputDurationSec: number | null;
  /** Wall-clock render time from startedAt → finishedAt. Null if timestamps missing. */
  renderDurationSec: number | null;
  /** Basename of the prepended hook clip, if any. */
  hookFile: string | null;
  assetCount: number | null;
  mode: string | null;
};

function emptyStats(): ProductionStats {
  return {
    outputDurationSec: null,
    renderDurationSec: null,
    hookFile: null,
    assetCount: null,
    mode: null,
  };
}

async function fetchProductionStats(id: string): Promise<ProductionStats> {
  try {
    const res = await fetch(`${API_BASE}/productions/${id}`);
    if (!res.ok) return emptyStats();
    const j = (await res.json()) as {
      mode?: string | null;
      hookFile?: string | null;
      startedAt?: string | null;
      finishedAt?: string | null;
      assets?: unknown[];
      timeline?: Array<{ cutDurationSec?: number | null }> | null;
    };
    const sum = Array.isArray(j.timeline)
      ? j.timeline.reduce(
          (s, e) => s + (typeof e?.cutDurationSec === 'number' ? e.cutDurationSec : 0),
          0,
        )
      : 0;
    // SQLite datetime('now') strings are UTC but lack a 'Z' suffix; add one
    // so Date parsing doesn't interpret them as local time.
    const toMs = (t: string | null | undefined): number | null => {
      if (!t) return null;
      const iso = /[zZ]|[+-]\d\d:?\d\d$/.test(t) ? t : `${t.replace(' ', 'T')}Z`;
      const ms = Date.parse(iso);
      return Number.isFinite(ms) ? ms : null;
    };
    const startedMs = toMs(j.startedAt);
    const finishedMs = toMs(j.finishedAt);
    const renderDurationSec =
      startedMs != null && finishedMs != null && finishedMs >= startedMs
        ? (finishedMs - startedMs) / 1000
        : null;
    return {
      outputDurationSec: sum > 0 ? sum : null,
      renderDurationSec,
      hookFile: j.hookFile ?? null,
      assetCount: Array.isArray(j.assets) ? j.assets.length : null,
      mode: j.mode ?? null,
    };
  } catch (err) {
    console.warn(`[telegram] fetchProductionStats id=${id} failed:`, (err as Error).message);
    return emptyStats();
  }
}

// Humanize a second count: "38.4s" or "2m13s".
function fmtDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '?';
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec - m * 60);
  return s === 0 ? `${m}m` : `${m}m${s}s`;
}

// Turn 'Kid-Blast-Hook.mp4' into 'Kid Blast Hook' for a friendlier caption.
function prettyHookName(basename: string): string {
  return basename.replace(/\.(mp4|mov|m4v|webm)$/i, '').replace(/[-_]+/g, ' ');
}

// Short human summary of the non-default knobs the user chose, appended
// to the "got it" ack so the parse is visible. Empty string when no
// flags were set so the ack reads the same as before.
function describeFlags(fields: Record<string, string>): string {
  const parts: string[] = [];
  if (fields.presetId) parts.push(`preset=${fields.presetId}`);
  if (fields.voiceId) parts.push('voice=custom');
  if (fields.styleSpec) parts.push('style=custom');
  return parts.length > 0 ? ` · ${parts.join(', ')}` : '';
}

// ---------- Sending the finished video ---------------------------------------

// How long we'll wait for Telegram to accept the video upload before
// giving up and falling back to a URL reply. Empirically, a 35MB video
// takes under a minute to upload from our host; 5 min is generous but
// finite, which is the whole point — the previous implementation used
// a stream with no upper bound and could stall silently.
const VIDEO_UPLOAD_TIMEOUT_MS = 5 * 60 * 1000;

async function sendResult(
  ctx: Context,
  id: string,
  capSeconds: number,
  submitter: Submitter | null,
): Promise<void> {
  const url = `${API_BASE}/productions/${id}/output`;
  const tag = mentionMd(submitter);
  const tagPrefix = tag ? `${tag} ` : '';

  // Pull the final stats in parallel with the output fetch — they're two
  // independent GETs against the same API, no need to serialize them. Falls
  // back to capSeconds in the caption if the stats lookup fails.
  const statsPromise = fetchProductionStats(id);

  console.log(`[telegram] sendResult id=${id} fetching output...`);
  let buffer: Buffer;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      await ctx.reply(
        `${tagPrefix}⚠️ Finished but couldn't fetch output (${res.status}). Try \`${url}\`.`,
        { parse_mode: 'Markdown' },
      );
      return;
    }
    const ab = await res.arrayBuffer();
    buffer = Buffer.from(ab);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[telegram] sendResult id=${id} fetch failed: ${msg}`);
    await ctx.reply(
      `${tagPrefix}⚠️ Finished but couldn't fetch output (${msg}). Try \`${url}\`.`,
      { parse_mode: 'Markdown' },
    );
    return;
  }
  const sizeMB = (buffer.length / 1024 / 1024).toFixed(1);
  console.log(`[telegram] sendResult id=${id} fetched ${sizeMB}MB, uploading to Telegram...`);

  const stats = await statsPromise;
  // Output duration: prefer the real sum from the timeline; fall back to
  // capSeconds only if stats lookup failed.
  const durText =
    stats.outputDurationSec != null
      ? fmtDuration(stats.outputDurationSec)
      : `~${capSeconds}s`;
  const renderText =
    stats.renderDurationSec != null
      ? ` · rendered in ${fmtDuration(stats.renderDurationSec)}`
      : '';
  const hookText = stats.hookFile ? ` · hook: ${prettyHookName(stats.hookFile)}` : '';
  const sizeText = ` · ${sizeMB}MB`;
  const caption = `${tagPrefix}✅ ${durText} video${renderText}${hookText}${sizeText}\nJob \`${id}\``;

  // Telegram bots can send videos up to 50MB via the standard Bot API.
  // If we're over that cap, skip the upload and point the user at the
  // API endpoint — they'll get something instead of a silent stall.
  if (buffer.length > 50 * 1024 * 1024) {
    await ctx.reply(
      `${tagPrefix}✅ Done — ${durText} video${renderText}, but ${sizeMB}MB exceeds Telegram's 50MB send limit. Download: ${url}`,
      { parse_mode: 'Markdown' },
    );
    return;
  }

  try {
    await withTimeout(
      ctx.replyWithVideo(Input.fromBuffer(buffer, `video-${id}.mp4`), {
        caption,
        parse_mode: 'Markdown',
      }),
      VIDEO_UPLOAD_TIMEOUT_MS,
      'video upload',
    );
    console.log(`[telegram] sendResult id=${id} uploaded OK`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[telegram] sendResult id=${id} upload failed: ${message}`);
    // Telegram sometimes reports file-too-big even under 50MB for awkward
    // encodings; fall back to a URL so the user still gets the video.
    await ctx
      .reply(`${tagPrefix}⚠️ Upload to Telegram failed (${message}). Download: ${url}`, {
        parse_mode: 'Markdown',
      })
      .catch(() => undefined);
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
