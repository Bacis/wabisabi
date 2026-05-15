import { describe, expect, it } from 'vitest';
import { fallbackChunks, selectChunks } from './index';
import type { CaptionPlan, Word } from '../CaptionLayer';

const w = (word: string, start = 0, end = 0.3): Word => ({
  word,
  start,
  end,
  confidence: 1,
});

describe('fallbackChunks', () => {
  it('groups words into fixed-N chunks with all-false emphasis', () => {
    const words = ['one', 'two', 'three', 'four', 'five'].map((s, i) => w(s, i, i + 0.3));
    const chunks = fallbackChunks(words, 2);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]!.words.map((x) => x.word)).toEqual(['one', 'two']);
    expect(chunks[2]!.words.map((x) => x.word)).toEqual(['five']);
    expect(chunks.every((c) => c.emphasis.every((e) => e === false))).toBe(true);
  });

  it('returns [] for empty input', () => {
    expect(fallbackChunks([], 3)).toEqual([]);
  });

  it('handles maxPerLine larger than the word count', () => {
    const chunks = fallbackChunks([w('only')], 4);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.words).toHaveLength(1);
  });
});

describe('selectChunks', () => {
  it('returns the captionPlan chunks when present', () => {
    const plan: CaptionPlan = {
      chunks: [{ words: [w('hello')], emphasis: [true] }],
    };
    const out = selectChunks(plan, [w('ignored')], { maxPerLine: 4 });
    expect(out).toBe(plan.chunks);
  });

  it('falls back to fixed-N chunks when captionPlan is null', () => {
    const out = selectChunks(null, [w('a'), w('b'), w('c')], { maxPerLine: 2 });
    expect(out).toHaveLength(2);
    expect(out[0]!.words.map((x) => x.word)).toEqual(['a', 'b']);
  });

  it('falls back to fixed-N chunks when captionPlan has an empty chunks array', () => {
    // The /designs/:id/render endpoint stores `{chunks: [], groups: [...]}`
    // for non-caption-designer templates. Without this fallback the
    // renderer would render zero captions.
    const plan: CaptionPlan = { chunks: [] };
    const out = selectChunks(plan, [w('a'), w('b'), w('c')], { maxPerLine: 2 });
    expect(out).toHaveLength(2);
    expect(out[0]!.words.map((x) => x.word)).toEqual(['a', 'b']);
  });
});
