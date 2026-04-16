import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

// Curated library of short AI "brain-rot" clips the user uploads manually
// into /storage/brain-rot/. Unlike per-job inputs, this folder is NOT swept
// by the retention cron — it's treated as a permanent asset library.
const BRAIN_ROT_DIR = join(
  resolve(process.env.STORAGE_DIR ?? './storage'),
  'brain-rot',
);

const VIDEO_EXTS = new Set(['.mp4', '.mov', '.webm']);

// Cheap deterministic string hash (djb2). We want same-seed → same-pick so
// re-runs of a production (reprocess, debug replay) reach for the same clip.
function hashSeed(seed: string): number {
  let h = 5381;
  for (let i = 0; i < seed.length; i++) {
    h = ((h << 5) + h + seed.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

// Returns an absolute path to a randomly-chosen brain-rot clip, or null if
// the folder is missing/empty. Callers treat null as "effect skipped" —
// the render proceeds full-frame with a warning log.
export async function pickRandomBrainRotClip(seed: string): Promise<string | null> {
  let entries: string[];
  try {
    entries = await readdir(BRAIN_ROT_DIR);
  } catch {
    return null;
  }
  const clips = entries
    .filter((name) => {
      const dot = name.lastIndexOf('.');
      if (dot < 0) return false;
      return VIDEO_EXTS.has(name.slice(dot).toLowerCase());
    })
    .sort(); // stable order so the seed maps consistently across invocations
  if (clips.length === 0) return null;
  const idx = hashSeed(seed) % clips.length;
  return join(BRAIN_ROT_DIR, clips[idx]!);
}
