import { describe, expect, it } from 'vitest';
import { pickActiveChunk } from './activeChunk';
import type { CaptionChunk } from '../CaptionLayer';

const chunk = (start: number, end: number, words = ['hi']): CaptionChunk => ({
  words: words.map((w, i) => ({
    word: w,
    start: start + i * 0.001,
    end: i === words.length - 1 ? end : start + i * 0.001 + 0.5,
    confidence: 1,
  })),
  emphasis: words.map(() => false),
});

describe('pickActiveChunk', () => {
  const chunks = [chunk(0, 1), chunk(2, 3), chunk(4, 5)];

  it('returns -1 before the first chunk starts', () => {
    expect(pickActiveChunk(chunks, -0.5, 0.2)).toBe(-1);
  });

  it('returns 0 mid-chunk-0', () => {
    expect(pickActiveChunk(chunks, 0.5, 0.2)).toBe(0);
  });

  it('keeps chunk 0 active during its tail window', () => {
    expect(pickActiveChunk(chunks, 1.15, 0.2)).toBe(0);
  });

  it('switches to chunk 1 once it starts (even if chunk 0 is still tailing)', () => {
    expect(pickActiveChunk(chunks, 2.1, 0.2)).toBe(1);
  });

  it('keeps the LAST chunk active forever (no `next` to interrupt the tail)', () => {
    expect(pickActiveChunk(chunks, 1000, 0.2)).toBe(2);
  });

  it('returns -1 in a gap between chunks if outside both tail windows', () => {
    // Chunk 0 ends at 1.0 with tail 0.05 → ends at 1.05. Chunk 1 starts at 2.0.
    // t=1.5 falls in the gap.
    expect(pickActiveChunk(chunks, 1.5, 0.05)).toBe(-1);
  });

  it('returns -1 for an empty chunks array', () => {
    expect(pickActiveChunk([], 5, 0.2)).toBe(-1);
  });
});
