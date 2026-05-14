// Shared easing + deterministic-seed primitives used by every Vol.02 letter
// effect and the slice glitch. Extracted byte-faithful from ReelClone.tsx.
//
// `seedRand` returns an LCG closure (1664525 / 1013904223 — Numerical
// Recipes constants) so each letter index produces the same scatter every
// frame. Do NOT change the multiplier/increment — the FX visuals are tuned
// against this exact stream.

export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);
export const easeOutQuint = (t: number): number => 1 - Math.pow(1 - t, 5);

export function seedRand(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s * 1664525 + 1013904223) | 0;
    return ((s >>> 0) % 100000) / 100000;
  };
}
