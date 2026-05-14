import type { CaptionChunk, CaptionPlan, Word } from '../CaptionLayer';
import { fallbackChunks } from './fallback';

// One-line decision shared by every cinematic template: prefer the
// LLM-enriched chunks when present, else fall back to fixed-N. Lifted out
// so future templates and the agent's stage-scoped tools can ask "which
// chunks should I render?" in one place instead of repeating the ternary.
export function selectChunks(
  captionPlan: CaptionPlan | null,
  words: Word[],
  opts: { maxPerLine: number },
): CaptionChunk[] {
  return captionPlan ? captionPlan.chunks : fallbackChunks(words, opts.maxPerLine);
}
