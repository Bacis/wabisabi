import { describe, expect, it } from 'vitest';
import { layoutCascadeStack, type CascadeStackParams } from './cascadeStack';
import { getLayoutStrategy, listRegisteredStrategies } from './registry';
import type { StrategyInput } from './types';
import type { CaptionChunk } from '../CaptionLayer';

// Day 1 shadow-mode equivalence test. Calling `layoutCascadeStack` directly
// vs going through `getLayoutStrategy('cascade-stack').computeLayout(...)`
// must produce identical LayoutPlan output for the same input. Day 2
// switches ReelClone.tsx to the registry path; this test gates that change.

const makeWord = (word: string, start: number) => ({
  word,
  start,
  end: start + 0.4,
  confidence: 0.99,
});

const fixtureChunk: CaptionChunk = {
  words: [
    makeWord('this', 0),
    makeWord('is', 0.4),
    makeWord('a', 0.8),
    makeWord('cinematic', 1.2),
    makeWord('test', 1.6),
  ],
  emphasis: [false, false, false, false, true],
};

const fixtureInput: StrategyInput = {
  chunk: fixtureChunk,
  effectiveEmphasis: fixtureChunk.emphasis,
  baseSize: 64,
  frameWidth: 1080,
  frameHeight: 1920,
  usableWidth: 1080 * 0.8,
  charAdvance: 0.55,
  maxSizeForWord: (len) => 200 * Math.max(1, len / 4),
};

const fixtureParams: CascadeStackParams = {
  maxPerLine: 3,
  columnGapRatio: 0.2,
  cascadeTopRatio: 1.0,
  cascadeBottomRatio: 0.47,
  emphasisFillRatio: 0.75,
  emphasisMaxHeightRatio: 0.2,
  emphasisSizeMultiplier: 1.0,
  fillerSizeMultiplier: 1.0,
  sizeRuleIsFit: true,
  emphasisLineBreak: true,
};

describe('layout registry — shadow-mode equivalence', () => {
  it('cascade-stack via registry produces the same LayoutPlan as the direct call', () => {
    const direct = layoutCascadeStack(
      {
        chunk: fixtureInput.chunk,
        effectiveEmphasis: fixtureInput.effectiveEmphasis,
        baseSize: fixtureInput.baseSize,
        frameHeight: fixtureInput.frameHeight,
        usableWidth: fixtureInput.usableWidth,
        charAdvance: fixtureInput.charAdvance,
        maxSizeForWord: fixtureInput.maxSizeForWord,
      },
      fixtureParams,
    );
    const viaRegistry = getLayoutStrategy('cascade-stack').computeLayout(
      fixtureInput,
      fixtureParams,
    );
    expect(viaRegistry).toEqual(direct);
  });

  it('lists cascade-stack, single-line-flow, and lower-third as registered today', () => {
    expect(listRegisteredStrategies()).toEqual([
      'cascade-stack',
      'single-line-flow',
      'lower-third',
    ]);
  });

  it('falls back to cascade-stack for unimplemented ids without crashing', () => {
    const got = getLayoutStrategy('karaoke-row');
    // Forward-compat fallback returns the cascade-stack strategy object.
    expect(got.id).toBe('cascade-stack');
  });
});
