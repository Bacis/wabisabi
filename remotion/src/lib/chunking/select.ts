import type { CaptionChunk, CaptionPlan, Word } from '../CaptionLayer';
import { fallbackChunks } from './fallback';

// One-line decision shared by every cinematic template: prefer the
// LLM-enriched chunks when present, else fall back to fixed-N. Lifted out
// so future templates and the agent's stage-scoped tools can ask "which
// chunks should I render?" in one place instead of repeating the ternary.
//
// Defensive empty-chunks fallback: the render endpoint stores
// `captionPlan: { chunks: [], groups, wordGroupAssignments }` for non
// caption-designer templates (the groups/assignments belong to the
// caption-designer track model and are meaningless to reel-clone, but
// they're stored for shape consistency). Without this fallback, the
// renderer would see an empty `chunks` array, fail to pick an active
// chunk, and render a black frame — exactly the "no captions in the
// rendered MP4" symptom that bit /designer/:id renders.
export function selectChunks(
  captionPlan: CaptionPlan | null,
  words: Word[],
  opts: { maxPerLine: number },
): CaptionChunk[] {
  if (captionPlan && captionPlan.chunks.length > 0) return captionPlan.chunks;
  return fallbackChunks(words, opts.maxPerLine);
}
