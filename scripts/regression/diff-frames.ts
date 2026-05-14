import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

// Pure pixel-diff utility used by both the regression vitest test and any
// ad-hoc CLI use. Returns a structured result so callers (test or script)
// decide their own pass/fail thresholds.
//
// `threshold` is pixelmatch's per-pixel YIQ ΔE bound (0-1, smaller is
// stricter). Default 0.05 ≈ ΔE ~1 on a 0-255 channel — tight enough to
// catch real regressions, loose enough to absorb font-rendering jitter.

export type DiffResult = {
  width: number;
  height: number;
  totalPixels: number;
  differingPixels: number;
  ratio: number;        // differingPixels / totalPixels, 0..1
};

export function diffPng(
  goldenPath: string,
  candidatePath: string,
  threshold = 0.05,
): DiffResult {
  const golden = PNG.sync.read(readFileSync(goldenPath));
  const candidate = PNG.sync.read(readFileSync(candidatePath));

  if (golden.width !== candidate.width || golden.height !== candidate.height) {
    throw new Error(
      `dimension mismatch: golden ${golden.width}x${golden.height} vs candidate ${candidate.width}x${candidate.height}`,
    );
  }

  const totalPixels = golden.width * golden.height;
  const differingPixels = pixelmatch(
    golden.data,
    candidate.data,
    null,
    golden.width,
    golden.height,
    { threshold },
  );

  return {
    width: golden.width,
    height: golden.height,
    totalPixels,
    differingPixels,
    ratio: differingPixels / totalPixels,
  };
}
