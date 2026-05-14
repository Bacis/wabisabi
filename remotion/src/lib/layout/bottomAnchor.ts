// Bottom-anchor layout strategy. Day 4 of the Director engine refactor.
//
// Intent: list-friendly layout for the `enumerated-list` group role.
// Each emphasized word starts a new line; non-emphasized words flow on
// the same line as their preceding emphasized word until the next emphasis
// (or until width overflow forces a wrap). The mental model is "emphasis
// marks a list bullet."
//
// Examples on the same five-word input ["BUILD", "the", "thing", "SHIP", "it"]
// with emphasis [true, false, false, true, false]:
//
//   single-line-flow: "BUILD the thing SHIP it" on one line (or wrapped on
//                     width — purely width-driven)
//   bottom-anchor:    "BUILD the thing"
//                     "SHIP it"
//                     (emphasis starts a new line; followers stay attached)
//
// Placement (anchoring this stack to the bottom of the safe area) is the
// renderer's responsibility and lands on Day 5 alongside the generalized
// `placement` model. Today this strategy produces the same LayoutLine
// shape as cascade-stack so the renderer can consume it without branching.

import { isFiller } from '../linguistics';
import type { CascadeStackParams } from './cascadeStack';
import type { LayoutEntry, LayoutLine, LayoutPlan, LayoutStrategy, StrategyInput } from './types';

export function layoutBottomAnchor(
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

  // Per-word size hint (same formula as single-line-flow).
  type WordSizing = { wordIdx: number; sz: number; widthAtSize: number; isEmph: boolean };
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
    return { wordIdx: i, sz, widthAtSize, isEmph };
  });

  // ---- Group by emphasis ----
  // New line whenever we hit an emphasis word, OR when adding the next
  // word would overflow the current line's width budget. Treats the very
  // first word (regardless of emphasis) as the start of line 1.
  const gap = baseSize * columnGapRatio;
  const lineBuckets: WordSizing[][] = [];
  let bucket: WordSizing[] = [];
  let bucketWidth = 0;
  for (let i = 0; i < wordSizings.length; i++) {
    const ws = wordSizings[i]!;
    const isFirst = i === 0;
    const startsNewItem = !isFirst && ws.isEmph;
    const wouldOverflow =
      bucket.length > 0 && bucketWidth + gap + ws.widthAtSize > usableWidth;
    if (startsNewItem || wouldOverflow) {
      if (bucket.length > 0) lineBuckets.push(bucket);
      bucket = [];
      bucketWidth = 0;
    }
    bucket.push(ws);
    bucketWidth += ws.widthAtSize + (bucket.length > 1 ? gap : 0);
  }
  if (bucket.length > 0) lineBuckets.push(bucket);

  // Build LayoutPlan — uniform lineFactor, no anchor-block treatment.
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

export const bottomAnchorStrategy: LayoutStrategy = {
  id: 'lower-third',
  computeLayout(input: StrategyInput, params: unknown): LayoutPlan {
    return layoutBottomAnchor(input, params as CascadeStackParams);
  },
};
