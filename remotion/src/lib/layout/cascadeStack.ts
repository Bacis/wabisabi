// Cascade-stack layout strategy — the single layout the cinematic ReelClone
// renderer ships today. Extracted byte-faithful from ReelClone.tsx (Phase 5b
// of the pipeline refactor). Phases 1-4 of the original inline render-time
// layout walk live here:
//
//   1. Anchor-break grouping — last-word emphasis goes on its own line.
//   2. Width-budget split — re-walk each line, break on overflow.
//   3. Per-line cascade factor — top→bottom size taper.
//   4. Pre-pass size estimation + per-line uniform shrink.
//
// The renderer consumes the LayoutPlan, multiplies sizeHint × lineScale, and
// emits spans. No further layout math at render time.

import type { CaptionChunk } from '../CaptionLayer';
import { isFiller } from '../linguistics';
import { isAnchorBlock, isAnchorEmphasis } from './anchorRules';
import { WIDTH_SAFETY } from './widthSafety';

export type LayoutEntry = {
  wordIdx: number;
  sizeHint: number;        // pre-shrink per-word size (post fit + multiplier + caps)
  isAnchorBlock: boolean;  // pre-computed so the renderer doesn't recompute
};

export type LayoutLine = {
  entries: LayoutEntry[];
  lineFactor: number;     // top→bottom cascade factor for this line
  lineScale: number;      // uniform shrink applied to all entries' sizeHints
  cascadeBaseLine: number; // baseSize × lineFactor — used for column gap
};

export type LayoutPlan = {
  lines: LayoutLine[];
};

export type CascadeStackInput = {
  chunk: CaptionChunk;
  effectiveEmphasis: boolean[];
  baseSize: number;
  frameHeight: number;
  usableWidth: number;
  charAdvance: number;
  maxSizeForWord: (len: number) => number;
};

export type CascadeStackParams = {
  maxPerLine: number;
  columnGapRatio: number;
  cascadeTopRatio: number;
  cascadeBottomRatio: number;
  emphasisFillRatio: number | null;
  emphasisMaxHeightRatio: number;
  emphasisSizeMultiplier: number;
  fillerSizeMultiplier: number;
  // styleDefaults.sizeRule from the renderer — when 'fit', anchor blocks
  // auto-fit to emphasisFillRatio of usable width; when 'fixed', they keep
  // their cascade-base size.
  sizeRuleIsFit: boolean;
  emphasisLineBreak: boolean;
};

export function layoutCascadeStack(
  input: CascadeStackInput,
  params: CascadeStackParams,
): LayoutPlan {
  const { chunk, effectiveEmphasis, baseSize, frameHeight, usableWidth, charAdvance, maxSizeForWord } = input;
  const {
    maxPerLine,
    columnGapRatio,
    cascadeTopRatio,
    cascadeBottomRatio,
    emphasisFillRatio,
    emphasisMaxHeightRatio,
    emphasisSizeMultiplier,
    fillerSizeMultiplier,
    sizeRuleIsFit,
    emphasisLineBreak,
  } = params;

  type LineEntry = { wordIdx: number };

  // ---- Phase 1: anchor-break grouping -------------------------------------
  // Only LAST-WORD emphasis breaks to its own line; mid-stack emphasis stays
  // inline so it can carry inline-color treatment.
  const lines: LineEntry[][] = [];
  let cur: LineEntry[] = [];
  const flush = () => {
    if (cur.length > 0) {
      lines.push(cur);
      cur = [];
    }
  };
  const lastWordIdx = chunk.words.length - 1;
  for (let i = 0; i < chunk.words.length; i++) {
    const isEmph = effectiveEmphasis[i] ?? false;
    const word = chunk.words[i]!.word;
    if (isAnchorEmphasis({
      emphasisLineBreakEnabled: emphasisLineBreak,
      isEmphasis: isEmph,
      isLastWordInChunk: i === lastWordIdx,
      word,
    })) {
      flush();
      lines.push([{ wordIdx: i }]);
    } else {
      cur.push({ wordIdx: i });
      if (cur.length >= maxPerLine) flush();
    }
  }
  flush();

  // ---- Phase 2: width-budget split ----------------------------------------
  // Re-walk each line, break where cumulative word-width exceeds usableWidth.
  // Uses the same charAdvance / maxSizeForWord source-of-truth so split
  // decisions and rendered sizes agree.
  const splitLines: LineEntry[][] = [];
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li]!;
    if (line.length <= 1) {
      splitLines.push(line);
      continue;
    }
    const factor = lines.length <= 1
      ? cascadeBottomRatio
      : cascadeTopRatio +
        (cascadeBottomRatio - cascadeTopRatio) *
          (li / (lines.length - 1));
    const wordSize = baseSize * factor;
    const gap = baseSize * factor * columnGapRatio;
    let bucket: LineEntry[] = [];
    let bucketWidth = 0;
    for (const entry of line) {
      const w = chunk.words[entry.wordIdx]!;
      const wordWidth = wordSize * Math.max(1, w.word.length) * charAdvance;
      const needsBreak = bucket.length > 0 &&
        bucketWidth + gap + wordWidth > usableWidth;
      if (needsBreak) {
        splitLines.push(bucket);
        bucket = [];
        bucketWidth = 0;
      }
      bucket.push(entry);
      bucketWidth += wordWidth + (bucket.length > 1 ? gap : 0);
    }
    if (bucket.length > 0) splitLines.push(bucket);
  }

  // ---- Phases 3 + 4: per-line cascade + pre-pass size estimation ---------
  // Per-line uniform shrink (lineScale) catches lines whose estimated
  // rendered width exceeds usableWidth. The estimate uses
  // `len × charAdvance × WIDTH_SAFETY` to over-count by a fixed margin —
  // see widthSafety.ts for why 1.4 is the right baseline.

  const planLines: LayoutLine[] = splitLines.map((line, lineIdx) => {
    const lineFactor =
      splitLines.length <= 1
        ? cascadeBottomRatio
        : cascadeTopRatio +
          (cascadeBottomRatio - cascadeTopRatio) *
            (lineIdx / (splitLines.length - 1));

    const isLastLine = lineIdx === splitLines.length - 1;
    const cascadeBaseLine = baseSize * lineFactor;
    const entries: LayoutEntry[] = [];
    let estLineWidth = 0;

    for (let lci = 0; lci < line.length; lci++) {
      const wi = line[lci]!.wordIdx;
      const ww = chunk.words[wi]!;
      const isEmph = effectiveEmphasis[wi] ?? false;
      const onOwn = line.length === 1;
      const anchorBlock = isAnchorBlock({
        isEmphasis: isEmph,
        isLastLine,
        isOnOwnLine: onOwn,
        sizeRuleIsFit,
        hasEmphasisFillRatio: emphasisFillRatio != null,
        word: ww.word,
      });
      const fitSz = anchorBlock
        ? (usableWidth * emphasisFillRatio!) /
          Math.max(1, ww.word.length * charAdvance)
        : null;
      const fillerLocal = !isEmph && isFiller(ww.word);
      const tMul = isEmph && !anchorBlock
        ? 1.0
        : isEmph
          ? emphasisSizeMultiplier
          : fillerLocal ? fillerSizeMultiplier : 1.0;
      const rawSz = fitSz != null ? fitSz : cascadeBaseLine * tMul;
      const hCap = anchorBlock
        ? frameHeight * emphasisMaxHeightRatio
        : frameHeight * 0.4;
      const sz = Math.min(rawSz, maxSizeForWord(ww.word.length), hCap);
      entries.push({ wordIdx: wi, sizeHint: sz, isAnchorBlock: anchorBlock });
      estLineWidth += sz * Math.max(1, ww.word.length) * charAdvance * WIDTH_SAFETY;
    }
    const lineGap = cascadeBaseLine * columnGapRatio;
    estLineWidth += lineGap * Math.max(0, line.length - 1);
    const lineScale = estLineWidth > usableWidth
      ? usableWidth / estLineWidth
      : 1;

    return { entries, lineFactor, lineScale, cascadeBaseLine };
  });

  // ---- Phase 5: uniform-stack shrink ---------------------------------
  // Chapter-card mode (flat cascade + emphasis-line-break) treats the
  // whole stack as ONE visual unit — Jodie's "QUIT / HER / JOB" idiom.
  // The widest word's lineScale must apply to ALL lines so the stack
  // reads as a unified block at one size, not a ragged mix where long
  // words shrink and short words stay big.
  //
  // Detection: cascadeTopRatio === cascadeBottomRatio === 1.0 AND
  // emphasisLineBreak === true. Both are set by the Director's
  // chunkOverride for chapter-card roles (hero-title-card, stat-callout,
  // pull-quote, cta-overlay).
  const isUniformStack =
    cascadeTopRatio === 1 &&
    cascadeBottomRatio === 1 &&
    emphasisLineBreak === true &&
    planLines.length > 1;

  if (isUniformStack) {
    const minScale = planLines.reduce((m, l) => Math.min(m, l.lineScale), 1);
    if (minScale < 1) {
      for (const l of planLines) {
        l.lineScale = minScale;
      }
    }
  }

  return { lines: planLines };
}
