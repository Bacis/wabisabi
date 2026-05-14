import type { CaptionChunk } from '../CaptionLayer';

// Pick the caption chunk that should be visible at time `t` (seconds). The
// "tail" extends a chunk's lifetime past its last word so the current line
// doesn't disappear the instant the audio cuts. Walks chunks backward so
// later chunks shadow earlier ones at boundaries (a chunk that has already
// started wins over an earlier still-tailing chunk).
//
// Returns -1 when no chunk is active (pre-roll, gap, or post-roll).
//
// Extracted byte-faithful from ReelClone.tsx (Phase 6 of the pipeline
// refactor). The "skip if next has also started" rule on line 5 was the
// non-obvious bit — without it, a fast-cut sequence keeps showing the first
// chunk because every chunk satisfies "t >= chunk.start" forever.

export function pickActiveChunk(
  chunks: ReadonlyArray<CaptionChunk>,
  t: number,
  tailSec: number,
): number {
  for (let i = chunks.length - 1; i >= 0; i--) {
    const c = chunks[i];
    if (c && c.words.length > 0 && t >= c.words[0]!.start) {
      const next = chunks[i + 1];
      if (next && next.words.length > 0 && t >= next.words[0]!.start) continue;
      const lastWord = c.words[c.words.length - 1]!;
      if (t <= lastWord.end + tailSec || !next) {
        return i;
      }
    }
  }
  return -1;
}
