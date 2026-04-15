// Hook selection for the producer pipeline. Each render opens with one of
// the engagement clips in ./hooks/ — ads 101: grab attention in the first
// few seconds. Per-user rotation (keyed on Telegram user id) makes sure a
// submitter doesn't see the same hook twice in a row; once they've seen
// every hook in the folder, we fall back to least-recently-used so the
// rotation still feels fresh.

import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { db } from '../db.js';
import { ffprobe } from './ffprobe.js';

const HOOKS_DIR = resolve(process.env.HOOKS_DIR ?? './hooks');
// Cache of H.264-transcoded hooks. The source clips are typically iPhone
// captures (HEVC/h.265), which Lambda's Linux Chromium can't decode — so we
// transcode each hook once and reuse the cached file for all subsequent
// renders. The cache survives process restarts; a hook is re-transcoded
// only if the source file's mtime is newer than the cached version.
const HOOKS_CACHE_DIR = resolve(
  process.env.HOOKS_CACHE_DIR ?? join(process.env.STORAGE_DIR ?? './storage', 'hooks-cache'),
);

// One-time directory scan. The list is tiny (<20 files) and only changes
// when the operator drops a new clip into the folder — a process restart is
// a fine way to pick those up, and avoids a filesystem syscall on every
// render. Missing directory is non-fatal.
let cachedHooks: string[] | null = null;
function listHooks(): string[] {
  if (cachedHooks) return cachedHooks;
  try {
    cachedHooks = readdirSync(HOOKS_DIR)
      .filter((name) => /\.(mp4|mov|m4v|webm)$/i.test(extname(name)))
      .sort(); // stable order for deterministic anonymous fallback
  } catch (err) {
    console.warn(`[pickHook] hooks dir not readable (${HOOKS_DIR}):`, (err as Error).message);
    cachedHooks = [];
  }
  return cachedHooks;
}

const selectSeenStmt = db.prepare(
  `select hookFile from user_hook_history where userId = ?`,
);
const selectLruStmt = db.prepare(
  `select hookFile from user_hook_history where userId = ? order by usedAt asc limit 1`,
);
const upsertHistoryStmt = db.prepare(
  `insert into user_hook_history (userId, hookFile) values (?, ?)
   on conflict(userId, hookFile) do update set usedAt = datetime('now')`,
);

export type PickedHook = {
  path: string;        // absolute path, suitable for ffmpeg/copyFile
  file: string;        // basename, e.g. 'Spongebob.mp4'
  durationSec: number; // from ffprobe
};

export type PickHookOpts = {
  /** Rotation key. Null for anonymous callers — they get a deterministic pick and no history writes. */
  userId: string | null;
  /** Production id; used as the deterministic seed when userId is null. */
  prodId: string;
};

function hashSeed(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash + seed.charCodeAt(i)) | 0;
  return Math.abs(hash);
}

// Ensure an H.264/yuv420p/AAC copy of `srcPath` exists in HOOKS_CACHE_DIR
// and return its path. If a cached file already exists and is newer than
// the source, we reuse it — so the transcode cost is paid only once per
// hook per source edit.
//
// Why not let Remotion's OffthreadVideo handle HEVC? Locally, macOS Chromium
// has HEVC hardware decoding; Lambda's Linux Chromium does not, and fails
// silently mid-render with "Failed to fetch" on the proxied video URL.
// Standardizing on H.264 here avoids that class of bug across modes.
async function ensureH264(srcPath: string, basename: string): Promise<string> {
  try {
    mkdirSync(HOOKS_CACHE_DIR, { recursive: true });
  } catch {
    /* ignore — writeFile below will surface the real error */
  }
  // Cache filename keeps the original basename so logs stay readable.
  const cachedPath = join(HOOKS_CACHE_DIR, basename);
  try {
    const cacheStat = statSync(cachedPath);
    const srcStat = statSync(srcPath);
    if (cacheStat.mtimeMs >= srcStat.mtimeMs && cacheStat.size > 0) {
      return cachedPath;
    }
    console.log(`[pickHook] cache stale for ${basename}, re-transcoding`);
  } catch {
    // No cache file yet — transcode.
    console.log(`[pickHook] transcoding ${basename} to H.264 (one-time)`);
  }

  // libx264 + yuv420p + faststart = maximally compatible with Lambda
  // Chromium. veryfast/crf 23 keeps quality indistinguishable from source
  // for these short clips while staying fast enough to not matter.
  //
  // Downscale to fit within the 1080x1920 composition. iPhone captures
  // arrive at 1440x2560 (or larger), which Lambda's Chromium rejects with
  // "Failed to fetch" when the proxied decode exceeds its 2GB disk/mem
  // budget. Rendering at source resolution only to scale down in the final
  // frame is wasted work anyway; we cap here.
  const args = [
    '-y',
    '-i', srcPath,
    '-vf', "scale='min(iw,1080)':'-2'",
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '23',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-movflags', '+faststart',
    cachedPath,
  ];
  const result = await new Promise<{ ok: boolean; stderr: string }>((resolveP) => {
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    proc.on('error', () => resolveP({ ok: false, stderr }));
    proc.on('close', (code) => resolveP({ ok: code === 0, stderr }));
  });
  if (!result.ok) {
    throw new Error(`ffmpeg transcode failed for ${basename}: ${result.stderr.slice(-400)}`);
  }
  return cachedPath;
}

/**
 * Choose a hook for this render.
 *
 * Returns null if the hooks folder is empty or missing — callers should skip
 * prepending rather than fail the render. Duration probing errors also
 * downgrade to null for the same reason: a bad hook file must never take
 * down a production.
 */
export async function pickHook(opts: PickHookOpts): Promise<PickedHook | null> {
  const hooks = listHooks();
  if (hooks.length === 0) {
    console.log('[pickHook] no hooks available, skipping');
    return null;
  }

  let chosen: string;
  const userId = opts.userId;
  if (!userId) {
    // Anonymous API callers: deterministic pick by prodId so re-running the
    // same id reproduces the same hook. Don't write history — we'd just be
    // polluting a shared "anonymous" bucket.
    chosen = hooks[hashSeed(opts.prodId) % hooks.length]!;
    console.log(`[pickHook] anonymous → ${chosen} (deterministic from prodId)`);
  } else {
    const seen = new Set(
      (selectSeenStmt.all(userId) as Array<{ hookFile: string }>).map((r) => r.hookFile),
    );
    const unseen = hooks.filter((h) => !seen.has(h));
    if (unseen.length > 0) {
      chosen = unseen[Math.floor(Math.random() * unseen.length)]!;
      console.log(
        `[pickHook] user=${userId} → ${chosen} (${unseen.length}/${hooks.length} unseen)`,
      );
    } else {
      // All hooks seen — reuse the least-recently-used. If the LRU lookup
      // somehow misses (shouldn't happen, but the table could have been
      // wiped between the two reads), fall back to a random pick.
      const lru = selectLruStmt.get(userId) as { hookFile: string } | undefined;
      chosen = lru?.hookFile ?? hooks[Math.floor(Math.random() * hooks.length)]!;
      console.log(`[pickHook] user=${userId} → ${chosen} (LRU, all ${hooks.length} seen)`);
    }
    // Record/bump the choice regardless of unseen-vs-LRU branch.
    try {
      upsertHistoryStmt.run(userId, chosen);
    } catch (err) {
      // History write failures shouldn't fail the render — log and move on.
      console.warn(`[pickHook] history write failed for user=${userId}:`, (err as Error).message);
    }
  }

  const srcPath = join(HOOKS_DIR, chosen);
  let path: string;
  try {
    path = await ensureH264(srcPath, chosen);
  } catch (err) {
    console.warn(`[pickHook] transcode failed for ${chosen}, skipping hook:`, (err as Error).message);
    return null;
  }

  let durationSec: number;
  try {
    const probed = await ffprobe(path);
    durationSec = probed.duration;
    if (!Number.isFinite(durationSec) || durationSec <= 0) {
      throw new Error(`ffprobe returned invalid duration: ${probed.duration}`);
    }
  } catch (err) {
    console.warn(`[pickHook] ffprobe failed for ${chosen}, skipping hook:`, (err as Error).message);
    return null;
  }

  return { path, file: chosen, durationSec };
}
