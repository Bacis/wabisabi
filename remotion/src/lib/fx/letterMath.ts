// Vol.02 per-letter effects — return { transform, opacity } applied to one
// letter span at a time. The renderer splits the word into character spans
// when the tier effect is one of these. Byte-faithful copy from
// ReelClone.tsx; constants and seed values are visually tuned and should
// not be "cleaned up."

import { easeOutCubic, easeOutQuint, seedRand } from './easing';

// FX-07 Calçadão — partido alto clave. Sustains during hold (loops).
export function sambaLetterTransform(
  letterIdx: number,
  elapsedMs: number,
  nowMs: number,
): { transform: string; opacity: number } {
  const entryT = Math.min(1, elapsedMs / 400);
  const entryE = easeOutCubic(entryT);
  const cycleMs = 1200;
  const cycle = ((nowMs % cycleMs) + cycleMs) % cycleMs / cycleMs;
  const hits = [0, 0.25, 0.375, 0.625, 0.75];
  const letterPhase = (cycle + letterIdx * 0.06) % 1;
  let pulse = 0;
  for (const h of hits) {
    const d = Math.abs(letterPhase - h);
    const dm = Math.min(d, 1 - d);
    const k = Math.exp(-dm * 32);
    if (k > pulse) pulse = k;
  }
  const yOff = -pulse * 14 * entryE;
  const sX = (1 + pulse * 0.06) * entryE + (1 - entryE) * 0.7;
  const sY = (1 + pulse * 0.18) * entryE + (1 - entryE) * 0.7;
  const xSway = Math.sin(cycle * Math.PI * 2 + letterIdx * 0.5) * 1.5 * entryE;
  return {
    transform: `translate(${xSway.toFixed(2)}px, ${yOff.toFixed(2)}px) scale(${sX.toFixed(3)}, ${sY.toFixed(3)})`,
    opacity: entryE,
  };
}

// FX-10 Crystalline Shatter — entry-only fracture, snaps with easeOutQuint.
export function crystalLetterTransform(
  letterIdx: number,
  elapsedMs: number,
): { transform: string; opacity: number } {
  const t = Math.min(1, elapsedMs / 900);
  const e = easeOutQuint(t);
  const rng = seedRand(letterIdx * 73 + 19);
  const angle = rng() * Math.PI * 2;
  const dist = 60 + rng() * 90;
  const dx = Math.cos(angle) * dist * (1 - e);
  const dy = Math.sin(angle) * dist * (1 - e);
  const rot = (rng() - 0.5) * 60 * (1 - e);
  const sc = 0.4 + e * 0.6;
  return {
    transform: `translate(${dx.toFixed(2)}px, ${dy.toFixed(2)}px) rotate(${rot.toFixed(1)}deg) scale(${sc.toFixed(3)})`,
    opacity: e,
  };
}

// FX-12 Magnetic Pull — damped oscillator e^(-kt) * cos(ωt) snap-back.
export function magneticLetterTransform(
  letterIdx: number,
  elapsedMs: number,
): { transform: string; opacity: number } {
  const t = Math.min(1, elapsedMs / 1100);
  const rng = seedRand(letterIdx * 41 + 7);
  const angle = rng() * Math.PI * 2;
  const dist = 80 + rng() * 60;
  const k = 4.5;
  const omega = 9;
  const decay = Math.exp(-k * t);
  const osc = Math.cos(omega * t);
  const factor = decay * osc;
  const dx = Math.cos(angle) * dist * factor;
  const dy = Math.sin(angle) * dist * factor;
  const rotMax = (rng() - 0.5) * 80;
  const rot = rotMax * factor;
  return {
    transform: `translate(${dx.toFixed(2)}px, ${dy.toFixed(2)}px) rotate(${rot.toFixed(1)}deg)`,
    opacity: Math.min(1, t * 2.5),
  };
}
