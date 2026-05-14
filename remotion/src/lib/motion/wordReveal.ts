import type { CaptionChunk } from '../CaptionLayer';

export type RevealMode = 'progressive' | 'all';

// Per-word reveal frame selector. In 'progressive' mode each word reveals
// at its own start frame ("karaoke" feel — words pop in one at a time). In
// 'all' mode every word in a chunk reveals at the chunk's first-word start
// frame ("burst" feel — whole line appears together).

export function pickEntryFrame(
  reveal: RevealMode | string | undefined,
  wordStartFrame: number,
  chunk: CaptionChunk,
  fps: number,
): number {
  if (reveal === 'progressive') return wordStartFrame;
  return Math.floor((chunk.words[0]?.start ?? 0) * fps);
}
