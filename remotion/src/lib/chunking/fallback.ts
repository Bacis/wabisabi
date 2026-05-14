import type { CaptionChunk, Word } from '../CaptionLayer';

// Naive fixed-N chunker used when no LLM-enriched caption plan is supplied.
// Splits the transcript word stream into back-to-back groups of `maxPerLine`,
// emits all-false emphasis arrays. The renderer's `inferEmphasis` heuristic
// in lib/linguistics fills in flags downstream when this chunker is the
// source.
export function fallbackChunks(words: Word[], maxPerLine: number): CaptionChunk[] {
  const out: CaptionChunk[] = [];
  for (let i = 0; i < words.length; i += maxPerLine) {
    const slice = words.slice(i, i + maxPerLine);
    out.push({ words: slice, emphasis: slice.map(() => false) });
  }
  return out;
}
