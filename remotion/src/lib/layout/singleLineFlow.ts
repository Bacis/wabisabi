// Single-line-flow layout strategy. Day 3 of the Director engine refactor.
//
// Behavior: every word flows on a single line at a uniform size (modulo
// emphasis/filler multipliers). When the line's cumulative width would
// exceed `usableWidth`, words wrap onto a new line. No cascade taper, no
// anchor-block fit-to-line treatment — emphasis is purely a size bump.
//
// This is the right shape for karaoke-style flows, lyrical reveals, and
// most "intro hook" group roles where the words should read as one
// connected phrase rather than a stacked anchor.
//
// Renderer-side params reuse the cascade-stack params shape. We only read
// the subset that's meaningful here (gap + emphasis/filler multipliers);
// cascade-specific fields (cascadeTopRatio, anchor* fields, sizeRuleIsFit)
// are ignored. This keeps the renderer's call site uniform across strategies.

import type { CaptionChunk } from '../CaptionLayer';
import { isFiller } from '../linguistics';
import type { CascadeStackParams } from './cascadeStack';
import type { LayoutEntry, LayoutLine, LayoutPlan, LayoutStrategy, StrategyInput } from './types';

export function layoutSingleLineFlow(
  input: StrategyInput,
  params: CascadeStackParams,
): LayoutPlan {
  const {
    chunk,
    effectiveEmphasis,
    baseSize,
    frameHeight,
    usableWidth,
    charAdvance,
    maxSizeForWord,
  } = input;
  const {
    columnGapRatio,
    emphasisSizeMultiplier,
    fillerSizeMultiplier,
  } = params;

  // ---- Pre-compute per-word size ----
  // Each word's pre-shrink size hint. Cap at maxSizeForWord and at 40% of
  // the frame height to match cascade-stack's non-anchor height cap.
  type WordSizing = { wordIdx: number; sz: number; widthAtSize: number };
  const heightCap = frameHeight * 0.4;

  const wordSizings: WordSizing[] = chunk.words.map((w, i) => {
    const isEmph = effectiveEmphasis[i] ?? false;
    const fillerLocal = !isEmph && isFiller(w.word);
    const mul = isEmph
      ? emphasisSizeMultiplier
      : fillerLocal
        ? fillerSizeMultiplier
        : 1.0;
    const rawSz = baseSize * mul;
    const sz = Math.min(rawSz, maxSizeForWord(w.word.length), heightCap);
    const widthAtSize = sz * Math.max(1, w.word.length) * charAdvance;
    return { wordIdx: i, sz, widthAtSize };
  });

  // ---- Word-wrap on width overflow ----
  // The gap between adjacent words is sized from the larger of the two
  // adjacent word sizes — but we keep it simple here and use baseSize
  // (matches cascade-stack's pattern of `baseSize * factor * columnGapRatio`
  // where factor = 1.0 for single-line-flow).
  const gap = baseSize * columnGapRatio;

  const lineBuckets: WordSizing[][] = [];
  let bucket: WordSizing[] = [];
  let bucketWidth = 0;
  for (const ws of wordSizings) {
    const needsBreak =
      bucket.length > 0 && bucketWidth + gap + ws.widthAtSize > usableWidth;
    if (needsBreak) {
      lineBuckets.push(bucket);
      bucket = [];
      bucketWidth = 0;
    }
    bucket.push(ws);
    bucketWidth += ws.widthAtSize + (bucket.length > 1 ? gap : 0);
  }
  if (bucket.length > 0) lineBuckets.push(bucket);

  // ---- Build LayoutPlan ----
  // No cascade — lineFactor is uniform 1.0, cascadeBaseLine = baseSize.
  // Per-line lineScale shrinks the line uniformly if it still overflows
  // (defensive — the wrap above should have prevented overflow except
  // when a single word's width exceeds usableWidth).
  const planLines: LayoutLine[] = lineBuckets.map((line) => {
    const entries: LayoutEntry[] = line.map((ws) => ({
      wordIdx: ws.wordIdx,
      sizeHint: ws.sz,
      isAnchorBlock: false,
    }));
    const estLineWidth = line.reduce(
      (sum, ws, idx) => sum + ws.widthAtSize + (idx > 0 ? gap : 0),
      0,
    );
    const lineScale = estLineWidth > usableWidth ? usableWidth / estLineWidth : 1;
    return {
      entries,
      lineFactor: 1.0,
      lineScale,
      cascadeBaseLine: baseSize,
    };
  });

  return { lines: planLines };
}

// Strategy adapter conforming to LayoutStrategy.
export const singleLineFlowStrategy: LayoutStrategy = {
  id: 'single-line-flow',
  computeLayout(input: StrategyInput, params: unknown): LayoutPlan {
    return layoutSingleLineFlow(input, params as CascadeStackParams);
  },
};

// Re-export the chunk type so consumers of this module don't need to
// reach into CaptionLayer for a typed import.
export type { CaptionChunk };
