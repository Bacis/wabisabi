import { describe, expect, it } from 'vitest';
import { pickEntryFrame } from './wordReveal';
import type { CaptionChunk } from '../CaptionLayer';

const chunk = (firstWordStart: number): CaptionChunk => ({
  words: [
    { word: 'hello', start: firstWordStart, end: firstWordStart + 0.4, confidence: 1 },
    { word: 'world', start: firstWordStart + 0.5, end: firstWordStart + 0.9, confidence: 1 },
  ],
  emphasis: [false, false],
});

describe('pickEntryFrame', () => {
  const fps = 30;
  const c = chunk(2);

  it('progressive mode returns the per-word start frame', () => {
    const wordStartFrame = Math.floor(c.words[1]!.start * fps); // 2.5s → 75
    expect(pickEntryFrame('progressive', wordStartFrame, c, fps)).toBe(75);
  });

  it('all mode returns the chunk first-word start frame', () => {
    const wordStartFrame = Math.floor(c.words[1]!.start * fps);
    expect(pickEntryFrame('all', wordStartFrame, c, fps)).toBe(60);
  });

  it('treats undefined / unknown reveal modes as "all" (the historical default)', () => {
    expect(pickEntryFrame(undefined, 99, c, fps)).toBe(60);
    expect(pickEntryFrame('made-up', 99, c, fps)).toBe(60);
  });

  it('returns 0 for an empty chunk in "all" mode', () => {
    const empty: CaptionChunk = { words: [], emphasis: [] };
    expect(pickEntryFrame('all', 99, empty, fps)).toBe(0);
  });
});
