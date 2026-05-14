// WCAG 2.x relative luminance + contrast ratio. Pure functions.
//
// Day 11 of the Director feature. The contrast subsystem uses these to
// decide whether a caption's fill color will read against a sampled
// background region (Day 12 sampling, Day 13 remediation cascade).
//
// References:
//   * Relative luminance — https://www.w3.org/TR/WCAG21/#dfn-relative-luminance
//   * Contrast ratio    — https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio
//
// Reference value sanity checks (verified against the WCAG examples and
// WebAIM's contrast checker):
//   white #FFFFFF on black #000000 — exactly 21.00 : 1
//   black #000000 on white #FFFFFF — exactly 21.00 : 1
//   #808080 on white #FFFFFF       — ~3.95 : 1 (WCAG normal-text threshold)
//   yellow #FFD100 on black        — ~17.32 : 1 (high-luminance brand color)
//
// Inputs are hex strings in #rgb, #rrggbb, or #rrggbbaa form. Alpha is
// stripped — we sample the *background* underneath, not a blend. Callers
// that need alpha-aware contrast (semi-transparent backplates) should
// composite first and then call this with the resolved color.

// ---------------------------------------------------------------------------
// Hex parsing — returns [r, g, b] in [0, 255]. Throws on malformed input
// so the caller gets a clear error at the boundary rather than silently
// computing luminance for #000000.

export type RGB = [number, number, number];

export function parseHex(hex: string): RGB {
  const trimmed = hex.trim().toLowerCase();
  const m = trimmed.match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/);
  if (!m) {
    throw new Error(`parseHex: expected #rgb / #rrggbb / #rrggbbaa, got "${hex}"`);
  }
  const body = m[1]!;
  let r: number;
  let g: number;
  let b: number;
  if (body.length === 3) {
    r = parseInt(body[0]! + body[0]!, 16);
    g = parseInt(body[1]! + body[1]!, 16);
    b = parseInt(body[2]! + body[2]!, 16);
  } else {
    // 6 or 8 — alpha (last 2) is intentionally ignored. See header comment.
    r = parseInt(body.slice(0, 2), 16);
    g = parseInt(body.slice(2, 4), 16);
    b = parseInt(body.slice(4, 6), 16);
  }
  return [r, g, b];
}

// ---------------------------------------------------------------------------
// Channel linearization. Per WCAG: each sRGB component is first normalized
// to [0, 1], then either divided by 12.92 (low values, linear region) or
// raised through the 2.4-power gamma curve.

function srgbToLinear(c8: number): number {
  const c = c8 / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

// ---------------------------------------------------------------------------
// Relative luminance — weighted sum of linearized RGB. Output in [0, 1].

export function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex);
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

// Same math but for callers that already have an RGB tuple (e.g. the
// browser-side sampling pass — Day 12 — that produces 0-255 channels from
// canvas data without round-tripping to hex).
export function relativeLuminanceRgb([r, g, b]: RGB): number {
  return (
    0.2126 * srgbToLinear(r) +
    0.7152 * srgbToLinear(g) +
    0.0722 * srgbToLinear(b)
  );
}

// ---------------------------------------------------------------------------
// Contrast ratio. Always returns the WCAG-canonical ordering — lighter
// luminance on top. Output in [1.0, 21.0].

export function contrastRatio(hexA: string, hexB: string): number {
  const la = relativeLuminance(hexA);
  const lb = relativeLuminance(hexB);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

// ---------------------------------------------------------------------------
// Threshold bucket — feeds the Day 13 remediation cascade. The plan's
// two-stage thresholds:
//   ≥ 7.0  comfortable — no action
//   4.5..7 acceptable  — suggest stroke boost
//   3.0..4.5 marginal  — force stroke + shadow
//   < 3.0  fail        — must adjust fill or add backplate

export type ContrastTier = 'comfortable' | 'acceptable' | 'marginal' | 'fail';

export function classifyContrast(ratio: number): ContrastTier {
  if (ratio >= 7.0) return 'comfortable';
  if (ratio >= 4.5) return 'acceptable';
  if (ratio >= 3.0) return 'marginal';
  return 'fail';
}
