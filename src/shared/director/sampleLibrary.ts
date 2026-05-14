// Sample library lookup. Day 18 of the Director feature.
//
// Maps a sonic gesture to the audio sample paths the Remotion CueLayer
// loads via staticFile(). Each gesture has multiple variants so a
// run of the same gesture doesn't feel robotic; the Day 19 emitter
// picks via `samples[hash(beatId) % samples.length]` for a deterministic
// but distributed pick.
//
// THE PATHS LISTED HERE WILL NOT EXIST UNTIL THE LIBRARY IS CURATED.
// Day 18 ships the lookup; the actual mp3 acquisition + licensing
// review is a manual content step. See remotion/public/audio/licenses.json
// for the per-asset license/source table that must be populated before
// production deploy.
//
// While samples are missing, `resolveSamplePath` returns null and the
// CueLayer skips that <Audio> emission — the renderer must never crash
// over a missing asset, since the schema permits audio cues today.

import type { SonicGesture } from './vocabularies.js';
import { SONIC_GESTURES } from './vocabularies.js';

// Convention: 5 variants per gesture, plus 12 for typewriter (the
// per-character pattern, which fires far more frequently). Paths are
// repo-relative to `remotion/public/`, so Remotion's staticFile()
// resolves them at render and the dev server serves them via the same
// /stock-style static mount.
function variants(gesture: SonicGesture, count: number): string[] {
  return Array.from({ length: count }, (_, i) => {
    const n = String(i + 1).padStart(2, '0');
    return `audio/${gesture}/${n}.mp3`;
  });
}

export const SAMPLE_LIBRARY = {
  thud:    variants('thud',    5),
  slam:    variants('slam',    5),
  pop:     variants('pop',     5),
  click:   variants('click',   5),
  whoosh:  variants('whoosh',  5),
  swipe:   variants('swipe',   5),
  rise:    variants('rise',    5),
  drop:    variants('drop',    5),
  shimmer: variants('shimmer', 5),
  rumble:  variants('rumble',  5),
  sizzle:  variants('sizzle',  5),
  flutter: variants('flutter', 5),
  snap:    variants('snap',    5),
  sigh:    variants('sigh',    5),
  whisper: variants('whisper', 5),
  tick:    variants('tick',    12),
} as const satisfies Record<SonicGesture, readonly string[]>;

// Cheap deterministic 32-bit hash. Day 19 emits one cue per beat; the
// hash maps stable beat ids to a stable sample variant so re-renders
// produce byte-identical audio output for the same script.
function hashString(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  }
  return h >>> 0;
}

/**
 * Resolve a (gesture, key) pair to a single sample path. `key` is any
 * stable identifier — typically a beat id or "{groupId}:{charIdx}" for
 * typewriter patterns. Returns null when the gesture has no registered
 * samples (defensive — shouldn't happen at runtime since SAMPLE_LIBRARY
 * has an entry for every SONIC_GESTURES member).
 */
export function resolveSamplePath(gesture: SonicGesture, key: string): string | null {
  const list = SAMPLE_LIBRARY[gesture];
  if (!list || list.length === 0) return null;
  const idx = hashString(key) % list.length;
  return list[idx] ?? null;
}

// Build-time sanity. Mirrors the pattern used by roleDefaults.ts /
// sonicMap.ts — fails loudly if SAMPLE_LIBRARY drifts from SONIC_GESTURES.
for (const g of SONIC_GESTURES) {
  if (!(g in SAMPLE_LIBRARY)) {
    throw new Error(`SAMPLE_LIBRARY missing entry for gesture "${g}"`);
  }
}
