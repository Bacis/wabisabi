import React from 'react';

// Slice glitch — 10 horizontal-band stacked copies, per-band offsets driven
// by deterministic frame-tick pseudo-random. Bypasses the per-letter render
// entirely (it owns the whole word). Byte-faithful copy from ReelClone.tsx;
// the band-rand seeds (9173 / 31337) and tick math are visually tuned and
// must not drift.

export function SliceWord({
  text,
  intensity,
  frameSec,
  fontStyles,
  fillStyles,
  baseColor,
  transform,
  filter,
  opacity,
}: {
  text: string;
  intensity: number;
  frameSec: number;
  fontStyles: React.CSSProperties;
  fillStyles: React.CSSProperties;
  baseColor: string;
  // Outer transform applied to the whole slice stack — e.g. the entry
  // animation's translate/scale produced by evalEnter. Empty string or
  // undefined means no outer transform.
  transform?: string;
  filter?: string;
  opacity: number;
}) {
  const I = Math.max(0, Math.min(1, intensity));
  const BANDS = 10;
  const tickMs = Math.max(20, 200 - I * 170);
  const tick = Math.floor((frameSec * 1000) / tickMs);
  const maxOffset = I * 22;

  const bandRand = (i: number, k: number): number => {
    const s = ((i * 9173) ^ (k * 31337)) >>> 0;
    return ((s * 1664525 + 1013904223) >>> 0) / 4294967295;
  };

  const bands: React.ReactNode[] = [];
  for (let i = 0; i < BANDS; i++) {
    const r = bandRand(i, tick);
    let off = (r - 0.5) * 2 * maxOffset;
    const r2 = bandRand(i, tick + 1000);
    if (r2 > 0.4 + I * 0.55) off = 0;

    let bandColor = baseColor;
    if (I > 0.6 && Math.abs(off) > 4) {
      if (i % 3 === 0) bandColor = '#4dd4ff';
      else if (i % 3 === 1) bandColor = '#ff5b3c';
    }

    const topPct = (i / BANDS) * 100;
    const botPct = ((BANDS - i - 1) / BANDS) * 100;

    bands.push(
      <span
        key={i}
        style={{
          ...fontStyles,
          ...fillStyles,
          color: bandColor,
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          clipPath: `inset(${topPct.toFixed(3)}% 0 ${botPct.toFixed(3)}% 0)`,
          WebkitClipPath: `inset(${topPct.toFixed(3)}% 0 ${botPct.toFixed(3)}% 0)`,
          transform: `translateX(${off.toFixed(2)}px)`,
        }}
      >
        {text}
      </span>,
    );
  }

  return (
    <span
      style={{
        position: 'relative',
        display: 'inline-block',
        transform: transform && transform.length > 0 ? transform : undefined,
        transformOrigin: 'left baseline',
        opacity,
        filter,
      }}
    >
      {/* Layout placeholder so the word reserves correct width — invisible but laid out */}
      <span style={{ ...fontStyles, ...fillStyles, color: 'transparent', visibility: 'hidden' }}>
        {text}
      </span>
      {bands}
    </span>
  );
}
