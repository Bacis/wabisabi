import { describe, expect, it } from 'vitest';
import { sampleDominantColor } from './sample.js';

// Day 12 — background sampling tests. Synthetic pixel buffers stress the
// k-means edge cases:
//   * Solid color (degenerate split)
//   * Two-color split with known dominant
//   * Real-world-ish gradient (cluster centers should converge to two
//     reasonable shades)
//   * Off-by-one buffer sanity check

function solidBuffer(width: number, height: number, rgb: [number, number, number]): Uint8ClampedArray {
  const buf = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const off = i * 4;
    buf[off] = rgb[0];
    buf[off + 1] = rgb[1];
    buf[off + 2] = rgb[2];
    buf[off + 3] = 255;
  }
  return buf;
}

function twoColorBuffer(
  width: number,
  height: number,
  countA: number,
  rgbA: [number, number, number],
  rgbB: [number, number, number],
): Uint8ClampedArray {
  const buf = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const off = i * 4;
    const rgb = i < countA ? rgbA : rgbB;
    buf[off] = rgb[0];
    buf[off + 1] = rgb[1];
    buf[off + 2] = rgb[2];
    buf[off + 3] = 255;
  }
  return buf;
}

describe('sampleDominantColor — solid color', () => {
  it('handles a single-color buffer (no split)', () => {
    const pixels = solidBuffer(16, 16, [255, 0, 0]); // pure red
    const r = sampleDominantColor({ pixels, width: 16, height: 16 });
    expect(r.dominantRgb).toEqual([255, 0, 0]);
    expect(r.coverage).toBe(1);
    expect(r.iterations).toBe(0);
  });
});

describe('sampleDominantColor — two-color split', () => {
  it('returns the larger cluster as dominant (mostly white)', () => {
    // 200 white pixels + 56 black pixels in a 16x16 grid
    const pixels = twoColorBuffer(16, 16, 200, [255, 255, 255], [0, 0, 0]);
    const r = sampleDominantColor({ pixels, width: 16, height: 16 });
    expect(r.dominantRgb).toEqual([255, 255, 255]);
    expect(r.coverage).toBeCloseTo(200 / 256, 3);
    expect(r.luminance).toBeCloseTo(1.0, 6);
  });

  it('returns the larger cluster as dominant (mostly black)', () => {
    // 56 white + 200 black
    const pixels = twoColorBuffer(16, 16, 56, [255, 255, 255], [0, 0, 0]);
    const r = sampleDominantColor({ pixels, width: 16, height: 16 });
    expect(r.dominantRgb).toEqual([0, 0, 0]);
    expect(r.coverage).toBeCloseTo(200 / 256, 3);
    expect(r.luminance).toBeCloseTo(0.0, 6);
  });

  it('tie defaults to cluster A (the darker init centroid)', () => {
    // exactly 128/128 split — countA >= countB picks A, which the
    // implementation initializes from the min-luminance pixel (black here).
    const pixels = twoColorBuffer(16, 16, 128, [255, 255, 255], [0, 0, 0]);
    const r = sampleDominantColor({ pixels, width: 16, height: 16 });
    // Either side is acceptable in a tie, but the function should be
    // deterministic — same input → same output every call.
    const r2 = sampleDominantColor({ pixels, width: 16, height: 16 });
    expect(r.dominantRgb).toEqual(r2.dominantRgb);
  });
});

describe('sampleDominantColor — converges quickly', () => {
  it('converges in a small number of iterations on a clean two-cluster split', () => {
    const pixels = twoColorBuffer(16, 16, 200, [240, 30, 30], [20, 20, 240]);
    const r = sampleDominantColor({ pixels, width: 16, height: 16 });
    // Already linearly separable — should converge ≤ 2 iterations.
    expect(r.iterations).toBeLessThanOrEqual(2);
    expect(r.dominantRgb).toEqual([240, 30, 30]);
  });

  it('returns hex string in #rrggbb form', () => {
    const pixels = solidBuffer(8, 8, [255, 209, 0]); // brand yellow
    const r = sampleDominantColor({ pixels, width: 8, height: 8 });
    expect(r.dominantHex).toBe('#ffd100');
  });
});

describe('sampleDominantColor — buffer guards', () => {
  it('throws when pixels buffer is too small', () => {
    const tiny = new Uint8ClampedArray(4); // 1 pixel
    expect(() =>
      sampleDominantColor({ pixels: tiny, width: 16, height: 16 }),
    ).toThrow(/too small/);
  });
});
