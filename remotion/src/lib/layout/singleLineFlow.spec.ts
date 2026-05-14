import { describe, expect, it } from 'vitest';
import { layoutSingleLineFlow } from './singleLineFlow';
import type { CascadeStackParams } from './cascadeStack';
import type { StrategyInput } from './types';
import type { CaptionChunk } from '../CaptionLayer';

// Day 3 — single-line-flow correctness tests. The strategy must:
//   1. Place all words on one line when they fit
//   2. Word-wrap onto a new line when the cumulative width overflows
//   3. Honor emphasis size multiplier without cascade taper
//   4. Always emit lineFactor=1.0 and isAnchorBlock=false (no cascade math)

const word = (w: string, start: number) => ({
  word: w,
  start,
  end: start + 0.4,
  confidence: 0.99,
});

const params: CascadeStackParams = {
  maxPerLine: 99,             // single-line ignores this
  columnGapRatio: 0.2,
  cascadeTopRatio: 1.0,       // single-line ignores this
  cascadeBottomRatio: 1.0,    // single-line ignores this
  emphasisFillRatio: null,    // single-line ignores this
  emphasisMaxHeightRatio: 1,  // single-line ignores this
  emphasisSizeMultiplier: 1.4,
  fillerSizeMultiplier: 0.8,
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

describe('layoutSingleLineFlow', () => {
  it('keeps all words on one line when they fit', () => {
    const chunk: CaptionChunk = {
      words: [word('a', 0), word('b', 0.4), word('c', 0.8)],
      emphasis: [false, false, false],
    };
    const plan = layoutSingleLineFlow(baseInput(chunk, 5000), params);
    expect(plan.lines.length).toBe(1);
    expect(plan.lines[0]!.entries.map((e) => e.wordIdx)).toEqual([0, 1, 2]);
  });

  it('wraps onto a new line when cumulative width overflows', () => {
    const chunk: CaptionChunk = {
      words: [
        word('cinematic', 0),
        word('cinematic', 0.4),
        word('cinematic', 0.8),
        word('cinematic', 1.2),
      ],
      emphasis: [false, false, false, false],
    };
    // Each word is 9 chars × 0.55 advance × 64 baseSize ≈ 317px wide.
    // usableWidth = 700 lets ~2 words fit per line.
    const plan = layoutSingleLineFlow(baseInput(chunk, 700), params);
    expect(plan.lines.length).toBeGreaterThanOrEqual(2);
    // All word indices accounted for in order
    const flat = plan.lines.flatMap((l) => l.entries.map((e) => e.wordIdx));
    expect(flat).toEqual([0, 1, 2, 3]);
  });

  it('emits lineFactor=1.0 and isAnchorBlock=false uniformly', () => {
    const chunk: CaptionChunk = {
      words: [word('hello', 0), word('world', 0.4)],
      emphasis: [false, true],
    };
    const plan = layoutSingleLineFlow(baseInput(chunk, 5000), params);
    for (const line of plan.lines) {
      expect(line.lineFactor).toBe(1.0);
      for (const e of line.entries) {
        expect(e.isAnchorBlock).toBe(false);
      }
    }
  });

  it('honors emphasis size multiplier without cascade taper', () => {
    const chunk: CaptionChunk = {
      words: [word('plain', 0), word('BIG', 0.4)],
      emphasis: [false, true],
    };
    const plan = layoutSingleLineFlow(baseInput(chunk, 5000), params);
    const [plainEntry, bigEntry] = plan.lines[0]!.entries;
    // Emphasis word: 64 * 1.4 = 89.6; plain word: 64 * 1.0 = 64
    expect(bigEntry!.sizeHint).toBeCloseTo(89.6, 1);
    expect(plainEntry!.sizeHint).toBeCloseTo(64, 1);
  });
});
