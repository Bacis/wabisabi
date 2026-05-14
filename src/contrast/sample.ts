// Background sampling pass. Day 12 of the Director feature.
//
// Takes a raw RGBA pixel buffer of the caption's bounding region (cropped
// + downsampled to a fixed grid like 16×16 by the caller) and returns the
// dominant background color along with its WCAG relative luminance. The
// downstream contrast cascade (Day 13) uses these to decide whether the
// caption's fill needs a stroke boost, shadow, backplate, or fill swap.
//
// Algorithm — deterministic k-means with k=2:
//   1. Init centroids as the pixels with min and max relative luminance
//      in the sample. This pairs the two halves the eye actually cares
//      about (caption area vs surrounding bg) and is reproducible across
//      identical inputs without seeding an RNG.
//   2. Assign each pixel to its nearer centroid (sRGB Euclidean).
//   3. Update centroids as the mean of assigned pixels.
//   4. Repeat until no assignments change OR MAX_ITERS is hit (typical
//      convergence in 3-6 iterations on real frames; clamp at 12).
//
// Return the LARGER cluster's centroid — that's "the background", since
// the caption hasn't been composited yet at the time of sampling.
//
// Runs in both Node (server-side, fed by ffmpeg+sharp on Day 15) and the
// browser (Day 12 preview path with canvas ImageData). No DOM or Node
// builtins used here; the caller marshals pixels in.

import { relativeLuminanceRgb, type RGB } from './luminance.js';

export type SampleInput = {
  /** Tightly-packed RGBA, 4 bytes per pixel, row-major. */
  pixels: Uint8ClampedArray | Uint8Array;
  /** Pixel dimensions of the buffer. width * height * 4 must equal pixels.length. */
  width: number;
  height: number;
};

export type SampleResult = {
  /** Dominant cluster centroid in #rrggbb. */
  dominantHex: string;
  /** RGB tuple of the same centroid. */
  dominantRgb: RGB;
  /** WCAG relative luminance of the dominant centroid, in [0, 1]. */
  luminance: number;
  /** Fraction of pixels assigned to the dominant cluster, in [0.5, 1]. */
  coverage: number;
  /** Iterations until convergence (≤ MAX_ITERS). */
  iterations: number;
};

const MAX_ITERS = 12;

function toHex2(n: number): string {
  const v = Math.max(0, Math.min(255, Math.round(n)));
  return v.toString(16).padStart(2, '0');
}

function rgbToHex([r, g, b]: RGB): string {
  return `#${toHex2(r)}${toHex2(g)}${toHex2(b)}`;
}

function sqDistSrgb(a: RGB, b: RGB): number {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return dr * dr + dg * dg + db * db;
}

export function sampleDominantColor(input: SampleInput): SampleResult {
  const { pixels, width, height } = input;
  const n = width * height;
  if (n === 0 || pixels.length < n * 4) {
    throw new Error(
      `sampleDominantColor: pixels too small for ${width}x${height} (need ${n * 4}, got ${pixels.length})`,
    );
  }

  // ---- Extract RGB tuples + per-pixel luminance ----
  const rgbs: RGB[] = new Array(n);
  let minL = Infinity;
  let maxL = -Infinity;
  let minIdx = 0;
  let maxIdx = 0;
  for (let i = 0; i < n; i++) {
    const off = i * 4;
    const r = pixels[off]!;
    const g = pixels[off + 1]!;
    const b = pixels[off + 2]!;
    // Alpha (off+3) is ignored — caller's responsibility to provide an
    // opaque sample of the background.
    const rgb: RGB = [r, g, b];
    rgbs[i] = rgb;
    const l = relativeLuminanceRgb(rgb);
    if (l < minL) { minL = l; minIdx = i; }
    if (l > maxL) { maxL = l; maxIdx = i; }
  }

  // ---- Init centroids ----
  let cA: RGB = [...rgbs[minIdx]!];
  let cB: RGB = [...rgbs[maxIdx]!];

  // Degenerate case: every pixel has identical luminance (flat color frame).
  // K-means won't split; return the single color with full coverage.
  if (minL === maxL) {
    const c: RGB = cA;
    return {
      dominantHex: rgbToHex(c),
      dominantRgb: c,
      luminance: minL,
      coverage: 1.0,
      iterations: 0,
    };
  }

  // ---- K-means loop ----
  const assignment = new Uint8Array(n); // 0 → cluster A, 1 → cluster B
  let iters = 0;
  for (; iters < MAX_ITERS; iters++) {
    let changed = false;
    let sumAR = 0, sumAG = 0, sumAB = 0, countA = 0;
    let sumBR = 0, sumBG = 0, sumBB = 0, countB = 0;
    for (let i = 0; i < n; i++) {
      const p = rgbs[i]!;
      const dA = sqDistSrgb(p, cA);
      const dB = sqDistSrgb(p, cB);
      const newAssign: 0 | 1 = dA <= dB ? 0 : 1;
      if (assignment[i] !== newAssign) {
        assignment[i] = newAssign;
        changed = true;
      }
      if (newAssign === 0) {
        sumAR += p[0]; sumAG += p[1]; sumAB += p[2]; countA++;
      } else {
        sumBR += p[0]; sumBG += p[1]; sumBB += p[2]; countB++;
      }
    }
    if (countA > 0) cA = [sumAR / countA, sumAG / countA, sumAB / countA];
    if (countB > 0) cB = [sumBR / countB, sumBG / countB, sumBB / countB];
    if (!changed) break;
  }

  // ---- Pick the larger cluster as the dominant ----
  let countA = 0;
  for (let i = 0; i < n; i++) if (assignment[i] === 0) countA++;
  const countB = n - countA;
  const dominantIsA = countA >= countB;
  const dominantRgb: RGB = dominantIsA
    ? ([Math.round(cA[0]), Math.round(cA[1]), Math.round(cA[2])] as RGB)
    : ([Math.round(cB[0]), Math.round(cB[1]), Math.round(cB[2])] as RGB);
  const coverage = Math.max(countA, countB) / n;
  const luminance = relativeLuminanceRgb(dominantRgb);

  return {
    dominantHex: rgbToHex(dominantRgb),
    dominantRgb,
    luminance,
    coverage,
    iterations: iters,
  };
}
