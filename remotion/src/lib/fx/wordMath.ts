// Vol.02 full-word effects — return CSS values applied to a single word
// span (filter / text-shadow), no per-letter splitting. Byte-faithful copy
// from ReelClone.tsx; the empirically-tuned constants are load-bearing.

import { easeOutQuint } from './easing';

// FX-08 Lens Breathe — entry blur 14→0 over 600ms, then sine breath 0..1.4px.
export function breatheBlurPx(elapsedMs: number): number {
  const entryT = Math.min(1, elapsedMs / 600);
  const entryE = easeOutQuint(entryT);
  const entryBlur = (1 - entryE) * 14;
  const hold = Math.max(0, elapsedMs - 600);
  const breathPhase = (hold / 1800) * Math.PI * 2;
  const breathBlur = (Math.sin(breathPhase) + 1) * 0.5 * 1.4;
  return entryBlur + breathBlur;
}

// FX-09 Anamorphic Flare — bell curve at t=0.25, decays to a low sustain.
// Approximates the SVG asymmetric blur via CSS text-shadow with horizontal
// spread (the asymmetry — wide on X, sharp on Y — is what reads anamorphic).
export function flareTextShadow(elapsedMs: number, color: string): string {
  const t = Math.min(1, elapsedMs / 700);
  const bell = Math.exp(-Math.pow((t - 0.25) * 5, 2));
  const sustain = (1 - t) * 0.15 + 0.05;
  const intensity = Math.max(bell, sustain);
  const spread = (intensity * 80).toFixed(1);
  const blur = (intensity * 24 + 4).toFixed(1);
  return `${spread}px 0 ${blur}px ${color}, -${spread}px 0 ${blur}px ${color}`;
}
