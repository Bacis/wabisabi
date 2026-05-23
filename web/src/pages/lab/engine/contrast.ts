// WCAG 2.x relative-luminance + contrast-ratio helpers + an HSL-based
// "brighten until passing" routine. Pure functions; no DOM.
//
// We use 4.5:1 (WCAG AA Normal text) as the minimum so borderline accents
// don't get through — at 3:1 the ANCIENT c3 #356E4D against bg #070303 reads
// 3.41:1 (passing) but visually almost invisible. 4.5:1 also leaves headroom
// for the stage gradient/vignette that slightly lightens the rendered bg.
//
// Ported from ae-packs-player.html (lines 2085–2160).

export const MIN_CONTRAST = 4.5;

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

export function relLum(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function wcagContrast(h1: string, h2: string): number {
  const l1 = relLum(h1);
  const l2 = relLum(h2);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

export function hexToHsl(hex: string): [number, number, number] {
  const [r0, g0, b0] = hexToRgb(hex).map((c) => c / 255);
  const max = Math.max(r0, g0, b0);
  const min = Math.min(r0, g0, b0);
  let h: number;
  let s: number;
  const l = (max + min) / 2;
  if (max === min) {
    h = 0;
    s = 0;
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r0) h = ((g0 - b0) / d + (g0 < b0 ? 6 : 0)) * 60;
    else if (max === g0) h = ((b0 - r0) / d + 2) * 60;
    else h = ((r0 - g0) / d + 4) * 60;
  }
  return [h, s * 100, l * 100];
}

export function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r: number;
  let g: number;
  let b: number;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const toHex = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, '0');
  return '#' + toHex(r) + toHex(g) + toHex(b);
}

// Walk the L axis of HSL in 3-point steps (lift on dark bg, drop on light bg)
// until the color meets minRatio against bg. Returns the adjusted hex, or
// null if no amount of lightness adjustment is enough (rare).
export function ensurePassing(
  hex: string,
  bg: string,
  minRatio = MIN_CONTRAST,
): string | null {
  if (wcagContrast(hex, bg) >= minRatio) return hex;
  let [h, s, l] = hexToHsl(hex);
  const bgDark = relLum(bg) < 0.5;
  while (wcagContrast(hslToHex(h, s, l), bg) < minRatio) {
    if (bgDark) {
      l += 3;
      if (l >= 95) break;
    } else {
      l -= 3;
      if (l <= 5) break;
    }
  }
  // Dial down saturation a touch if we ended up at the extremes — otherwise
  // a brightened accent reads as neon.
  if (bgDark && l > 78 && s > 60) s = Math.max(40, s - 18);
  if (!bgDark && l < 25 && s > 60) s = Math.max(40, s - 18);
  const adjusted = hslToHex(h, s, l);
  return wcagContrast(adjusted, bg) >= minRatio ? adjusted : null;
}
