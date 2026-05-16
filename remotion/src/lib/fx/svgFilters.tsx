// FX Lab Vol.03 — intensity-driven body motion (resonance / inflation /
// ferro / shockwave). Each takes a single 0..1 intensity that scales
// BOTH amplitude AND rate; primitive attributes are recomputed per frame
// from useCurrentFrame() inside the React tree, so seeds advance
// deterministically and the same frame always produces the same render
// (Player + Lambda parity).
//
// Slice glitch lives separately — it's structural (10 stacked clip-path
// bands) not filter-based — and is rendered inline in the per-word branch.

import React from 'react';
import { blendRgbHex, hexToRgb } from './colorBlend';

export type Vol03Effect = 'resonance' | 'inflation' | 'ferro' | 'shockwave';

export const VOL03_EFFECTS: ReadonlyArray<Vol03Effect> = [
  'resonance', 'inflation', 'ferro', 'shockwave',
];

export function isVol03Effect(e: string | undefined): e is Vol03Effect {
  return e === 'resonance' || e === 'inflation'
    || e === 'ferro' || e === 'shockwave';
}

export const FX_FILTER_REGION = { x: '-30%', y: '-50%', width: '160%', height: '200%' };

export function FxFilter({
  id,
  effect,
  intensity,
  frameSec,
  tierFillHex,
}: {
  id: string;
  effect: Vol03Effect;
  intensity: number;
  frameSec: number;
  tierFillHex: string;
}) {
  const I = Math.max(0, Math.min(1, intensity));
  const t = frameSec;

  if (effect === 'resonance') {
    const seed1 = Math.floor(t * 6) % 200;
    const seed2 = Math.floor(t * 9) % 200;
    const freqLow = 5 + I * 8;
    const freqHigh = 14 + I * 18;
    const scale1 = I * 18 * Math.sin(t * freqLow);
    const scale2 = I * 10 * Math.sin(t * freqHigh + 1.7);
    return (
      <filter id={id} {...FX_FILTER_REGION}>
        <feTurbulence type="turbulence" baseFrequency="0.018" numOctaves={2} seed={seed1} result="t1" />
        <feDisplacementMap in="SourceGraphic" in2="t1" scale={scale1} result="d1" />
        <feTurbulence type="fractalNoise" baseFrequency="0.06" numOctaves={2} seed={seed2} result="t2" />
        <feDisplacementMap in="d1" in2="t2" scale={scale2} />
      </filter>
    );
  }

  if (effect === 'inflation') {
    const breathRate = 1.6 + I * 3.0;
    const breathPhase = Math.sin(t * breathRate);
    const breathBias = I * 0.4;
    const breathOsc = breathPhase * (0.05 + I * 0.4);
    const radius = Math.max(0, breathBias + breathOsc);
    return (
      <filter id={id} x="-15%" y="-25%" width="130%" height="150%">
        <feMorphology operator="dilate" radius={radius} in="SourceGraphic" />
      </filter>
    );
  }

  if (effect === 'ferro') {
    const radius = 0.5 + I * 7.5;
    const dispScale = I * 28;
    const bf = (0.35 + I * 0.4).toFixed(3);
    const seedRate = 8 + I * 30;
    const seed = Math.floor(t * seedRate) % 250;
    const baseRgb = hexToRgb(tierFillHex);
    const hotRgb: [number, number, number] = [0xff, 0x5b, 0x3c];
    const floodColor = blendRgbHex(baseRgb, hotRgb, I);
    return (
      <filter id={id} {...FX_FILTER_REGION}>
        <feMorphology operator="dilate" radius={radius} in="SourceGraphic" result="dilated" />
        <feComposite operator="out" in="dilated" in2="SourceGraphic" result="halo" />
        <feTurbulence type="fractalNoise" baseFrequency={bf} numOctaves={2} seed={seed} result="spikeNoise" />
        <feDisplacementMap in="halo" in2="spikeNoise" scale={dispScale} result="spikes" />
        <feFlood floodColor={floodColor} result="flood" />
        <feComposite operator="in" in="flood" in2="spikes" result="coloredSpikes" />
        <feMerge>
          <feMergeNode in="coloredSpikes" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    );
  }

  // shockwave
  const omega = 9 + I * 50;
  const pulse = Math.abs(Math.sin(t * omega));
  const dispScale = pulse * I * 32;
  const bf = (0.018 + I * 0.04).toFixed(4);
  const seed = Math.floor(t * 2) % 200;
  return (
    <filter id={id} x="-15%" y="-25%" width="130%" height="150%">
      <feTurbulence type="turbulence" baseFrequency={bf} numOctaves={1} seed={seed} result="wave" />
      <feDisplacementMap in="SourceGraphic" in2="wave" scale={dispScale} />
    </filter>
  );
}
