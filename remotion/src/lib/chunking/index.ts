import type { CaptionChunk, Word } from '../CaptionLayer';

// Stage-shaped chunking surface. Phase 5+ may register named chunkers (e.g.
// 'group-based' for the caption-designer template, 'per-syllable' for
// karaoke). For now the surface only exposes the two utilities the current
// pipeline needs.
export type Chunker = (words: Word[], opts: { maxPerLine: number }) => CaptionChunk[];

export { fallbackChunks } from './fallback';
export { selectChunks } from './select';
