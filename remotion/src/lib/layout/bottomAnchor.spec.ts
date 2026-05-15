import { describe, expect, it } from 'vitest';
import { layoutBottomAnchor } from './bottomAnchor';
import type { CascadeStackParams } from './cascadeStack';
import type { StrategyInput } from './types';
import type { CaptionChunk } from '../CaptionLayer';

// Day 4 — bottom-anchor correctness tests. The strategy must:
//   1. Start a new line at each emphasis word (except the very first word)
//   2. Keep non-emphasis followers on the same line as the preceding emphasis
//   3. Fall back to width-based wrap when a line would overflow
//   4. Emit lineFactor=1.0 and isAnchorBlock=false (no cascade math)

const word = (w: string, start: number) => ({
  word: w,
  start,
  end: start + 0.4,
  confidence: 0.99,
});

const params: CascadeStackParams = {
  maxPerLine: 99,
  columnGapRatio: 0.2,
  cascadeTopRatio: 1.0,
  cascadeBottomRatio: 1.0,
  emphasisFillRatio: null,
  emphasisMaxHeightRatio: 1,
  emphasisSizeMultiplier: 1.0,
  fillerSizeMultiplier: 1.0,
  sizeRuleIsFit: false,
  emphasisLineBreak: false,
};

const baseInput = (chunk: CaptionChunk, usableWidth: number): StrategyInput => ({
  chunk,
  effectiveEmphasis: chunk.emphasis,
  baseSize: 64,
  frameWidth: 1080,
  frameHeight: 1920,
  usableWidth,
  charAdvance: 0.55,
  maxSizeForWord: () => 9999,
});

describe('layoutBottomAnchor', () => {
  it('starts a new line at each emphasis word', () => {
    const chunk: CaptionChunk = {
      words: [
        word('BUILD', 0),
        word('the', 0.4),
        word('thing', 0.8),
        word('SHIP', 1.2),
        word('it', 1.6),
      ],
      emphasis: [true, false, false, true, false],
    };
    const plan = layoutBottomAnchor(baseInput(chunk, 5000), params);
    expect(plan.lines.length).toBe(2);
    expect(plan.lines[0]!.entries.map((e) => e.wordIdx)).toEqual([0, 1, 2]);
    expect(plan.lines[1]!.entries.map((e) => e.wordIdx)).toEqual([3, 4]);
  });

  it('puts the first word on line 1 even when it is not emphasized', () => {
    const chunk: CaptionChunk = {
      words: [word('hello', 0), word('THERE', 0.4), word('friend', 0.8)],
      emphasis: [false, true, false],
    };
    const plan = layoutBottomAnchor(baseInput(chunk, 5000), params);
    expect(plan.lines.length).toBe(2);
    expect(plan.lines[0]!.entries.map((e) => e.wordIdx)).toEqual([0]);
    expect(plan.lines[1]!.entries.map((e) => e.wordIdx)).toEqual([1, 2]);
  });

  it('renders three emphasized list items as three lines', () => {
    const chunk: CaptionChunk = {
      words: [word('one', 0), word('two', 0.4), word('three', 0.8)],
      emphasis: [true, true, true],
    };
    const plan = layoutBottomAnchor(baseInput(chunk, 5000), params);
    expect(plan.lines.length).toBe(3);
    for (const line of plan.lines) {
      expect(line.entries.length).toBe(1);
    }
  });

  it('falls back to width-based wrap when an item would overflow', () => {
    const chunk: CaptionChunk = {
      words: [
        word('cinematic', 0),
        word('cinematic', 0.4),
        word('cinematic', 0.8),
      ],
      emphasis: [true, false, false],
    };
    // Per word: 64 × 9 × 0.55 × WIDTH_SAFETY(1.4) ≈ 444px, gap ≈ 13px.
    // usableWidth=1000 fits 2 padded words (~901px) but not 3 (~1358px).
    const plan = layoutBottomAnchor(baseInput(chunk, 1000), params);
    expect(plan.lines.length).toBe(2);
    const flat = plan.lines.flatMap((l) => l.entries.map((e) => e.wordIdx));
    expect(flat).toEqual([0, 1, 2]);
  });

  it('emits lineFactor=1.0 and isAnchorBlock=false uniformly', () => {
    const chunk: CaptionChunk = {
      words: [word('a', 0), word('b', 0.4), word('c', 0.8)],
      emphasis: [true, true, false],
    };
    const plan = layoutBottomAnchor(baseInput(chunk, 5000), params);
    for (const line of plan.lines) {
      expect(line.lineFactor).toBe(1.0);
      for (const e of line.entries) {
        expect(e.isAnchorBlock).toBe(false);
      }
    }
  });
});
