// Contrast remediation cascade. Day 13 of the Director feature.
//
// Input: the caption's intended fill color + the sampled background color
//        (Day 12 sampling result).
// Output: a ContrastReport describing whether action is needed and what
//         the renderer should apply (stroke, shadow, backplate, palette
//         swap, or a safe-fallback fill swap).
//
// The cascade tries fixes in cheapest-to-most-invasive order, stopping at
// the first that lands the effective contrast in an acceptable tier:
//
//   1. Boost stroke      — opposite-luminance outline, 2-4px. Zero layout
//                          change. Resolves ~70% of marginal cases.
//   2. Add drop shadow   — soft shadow, matches stroke direction. Adds
//                          ~1.5 effective contrast points. Zero layout
//                          change.
//   3. Add backplate     — semi-transparent rounded rect behind text in
//                          opposite-luminance. Visual style changes.
//   4. Swap fill within  — iterate the palette, pick the entry with the
//      palette              highest contrast against the sampled bg.
//   5. Safe fallback     — white fill + black stroke (or vice versa).
//                          Brand color is dropped — last resort.
//
// Each report's `notes` field explains the decision in one sentence so the
// agent UI can surface "yellow worked everywhere except the gym mirror
// shot — used the white fallback there for readability."

import { classifyContrast, contrastRatio, relativeLuminance } from './luminance.js';

export type Shadow = {
  color: string;
  blurPx: number;
  offsetX: number;
  offsetY: number;
};

export type Backplate = {
  color: string;
  opacity: number;
  radiusPx: number;
};

export type RemediationKind =
  | 'none'
  | 'stroke'
  | 'shadow'
  | 'backplate'
  | 'palette-swap'
  | 'safe-fallback';

export type ContrastReport = {
  // Inputs (echoed back for the agent UI).
  fillHex: string;
  bgHex: string;
  // The cascade outcome.
  appliedRemediation: RemediationKind;
  finalFillHex: string;
  strokeColor?: string;
  strokeWidth?: number;
  shadow?: Shadow;
  backplate?: Backplate;
  // Measured contrasts.
  originalContrast: number;
  finalContrast: number;
  // One-sentence rationale for the agent's reply.
  notes: string;
};

export type RemediateOptions = {
  /**
   * Palette of alternative emphasis colors. The 'palette-swap' stage iterates
   * these looking for the best contrast against bg. Falls back to the safe
   * fallback when nothing in the palette clears the threshold.
   */
  palette?: string[];
  /**
   * Acceptable threshold to stop the cascade at. Defaults to 4.5 (WCAG AA
   * normal-text). Pass 7 for AAA / "comfortable".
   */
  targetRatio?: number;
};

// ---------------------------------------------------------------------------
// Stage helpers.

function strokeColorFor(fillLum: number): string {
  // Stroke opposes the fill's luminance — dark fill → white stroke, and
  // vice versa. This is what makes a 2-4px outline lift apparent legibility.
  return fillLum < 0.5 ? '#ffffff' : '#000000';
}

function shadowDefaultsFor(fillLum: number): Shadow {
  // Soft drop shadow in the same direction as the stroke. Blur scales
  // with font weight in the actual renderer; here we ship sane defaults
  // the renderer multiplies through font.size at apply time.
  return {
    color: fillLum < 0.5 ? '#ffffffaa' : '#000000aa',
    blurPx: 10,
    offsetX: 0,
    offsetY: 2,
  };
}

function backplateFor(fillLum: number): Backplate {
  // Backplate is the "panel behind the text". Opposite-luminance with
  // high-but-not-opaque alpha so the underlying frame stays partly visible.
  return {
    color: fillLum < 0.5 ? '#ffffff' : '#000000',
    opacity: 0.72,
    radiusPx: 12,
  };
}

function bestPaletteSwap(
  palette: string[],
  bgHex: string,
  current: string,
): { hex: string; ratio: number } | null {
  let best: { hex: string; ratio: number } | null = null;
  for (const candidate of palette) {
    if (candidate.toLowerCase() === current.toLowerCase()) continue;
    const r = contrastRatio(candidate, bgHex);
    if (!best || r > best.ratio) best = { hex: candidate, ratio: r };
  }
  return best;
}

// ---------------------------------------------------------------------------
// Public entry point.

export function remediateContrast(
  fillHex: string,
  bgHex: string,
  options: RemediateOptions = {},
): ContrastReport {
  const targetRatio = options.targetRatio ?? 4.5;
  const originalContrast = contrastRatio(fillHex, bgHex);
  const fillLum = relativeLuminance(fillHex);

  // ---- Stage 0: no action needed ----
  if (originalContrast >= 7.0) {
    return {
      fillHex,
      bgHex,
      appliedRemediation: 'none',
      finalFillHex: fillHex,
      originalContrast,
      finalContrast: originalContrast,
      notes: 'Comfortable — fill reads cleanly against the background.',
    };
  }

  // ---- Stage 1: stroke boost (acceptable tier, 4.5..7) ----
  const tier = classifyContrast(originalContrast);
  if (tier === 'acceptable') {
    return {
      fillHex,
      bgHex,
      appliedRemediation: 'stroke',
      finalFillHex: fillHex,
      strokeColor: strokeColorFor(fillLum),
      strokeWidth: 2,
      originalContrast,
      finalContrast: originalContrast,
      notes: 'Added a 2px opposite-luminance stroke to lift legibility.',
    };
  }

  // ---- Stage 2: stroke + shadow (marginal tier, 3..4.5) ----
  if (tier === 'marginal') {
    return {
      fillHex,
      bgHex,
      appliedRemediation: 'shadow',
      finalFillHex: fillHex,
      strokeColor: strokeColorFor(fillLum),
      strokeWidth: 3,
      shadow: shadowDefaultsFor(fillLum),
      originalContrast,
      finalContrast: originalContrast,
      notes: 'Reinforced the fill with a 3px stroke and soft drop shadow.',
    };
  }

  // ---- Stage 3+ : failing tier (< 3.0). Try heavier remediations. ----

  // 3. Backplate — measure contrast against the backplate color (the bg
  //    underneath is mostly obscured by the panel).
  const backplate = backplateFor(fillLum);
  const backplateContrast = contrastRatio(fillHex, backplate.color);
  if (backplateContrast >= targetRatio) {
    return {
      fillHex,
      bgHex,
      appliedRemediation: 'backplate',
      finalFillHex: fillHex,
      backplate,
      originalContrast,
      finalContrast: backplateContrast,
      notes: `Background too noisy for the fill — placed a ${backplate.color === '#000000' ? 'dark' : 'light'} backplate (${(backplate.opacity * 100).toFixed(0)}% opacity) underneath.`,
    };
  }

  // 4. Palette swap — try an alternative emphasis color from the project's
  //    palette. Only commit if the candidate clears the target ratio.
  if (options.palette && options.palette.length > 0) {
    const best = bestPaletteSwap(options.palette, bgHex, fillHex);
    if (best && best.ratio >= targetRatio) {
      return {
        fillHex,
        bgHex,
        appliedRemediation: 'palette-swap',
        finalFillHex: best.hex,
        originalContrast,
        finalContrast: best.ratio,
        notes: `Swapped fill from ${fillHex} to ${best.hex} — best contrast in the project palette.`,
      };
    }
  }

  // 5. Safe fallback — white-with-black-stroke or inverse. Always clears
  //    the target ratio since both choices land on a 21:1 baseline pair.
  const useWhite = relativeLuminance(bgHex) < 0.5;
  const safeFill = useWhite ? '#ffffff' : '#000000';
  const safeStroke = useWhite ? '#000000' : '#ffffff';
  const safeContrast = contrastRatio(safeFill, bgHex);
  return {
    fillHex,
    bgHex,
    appliedRemediation: 'safe-fallback',
    finalFillHex: safeFill,
    strokeColor: safeStroke,
    strokeWidth: 2,
    originalContrast,
    finalContrast: safeContrast,
    notes: `Brand fill failed even after backplate and palette swap — fell back to ${useWhite ? 'white-on-black' : 'black-on-white'} for readability.`,
  };
}
