import { describe, expect, it } from 'vitest';
import { breatheBlurPx, flareTextShadow } from './wordMath';

describe('breatheBlurPx', () => {
  it('returns max entry blur 14px at elapsed = 0 plus a tiny breath component', () => {
    // entryT=0 → entryE=0 → entryBlur = 14
    // hold = max(0, 0-600) = 0 → breathPhase = 0 → breathBlur = (sin(0)+1)*0.5*1.4 = 0.7
    expect(breatheBlurPx(0)).toBeCloseTo(14.7, 5);
  });

  it('returns near-zero entry blur at elapsed = 600ms', () => {
    // entryT=1 → entryE=1 → entryBlur = 0
    // hold = 0 → breathBlur = 0.7
    expect(breatheBlurPx(600)).toBeCloseTo(0.7, 5);
  });

  it('breath component oscillates between ~0 and ~1.4 in steady state', () => {
    // After entry, the value should stay within [0, 1.4] for any elapsed.
    for (const ms of [800, 1200, 1700, 2400, 5000]) {
      const v = breatheBlurPx(ms);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1.5);
    }
  });
});

describe('flareTextShadow', () => {
  it('produces a symmetric two-shadow CSS string', () => {
    const out = flareTextShadow(150, '#ffe14b');
    // Format: "{spread}px 0 {blur}px {color}, -{spread}px 0 {blur}px {color}"
    expect(out).toMatch(/^\d+\.\dpx 0 \d+\.\dpx #ffe14b, -\d+\.\dpx 0 \d+\.\dpx #ffe14b$/);
  });

  it('peaks near the bell curve center (t=0.25 → elapsed ≈ 175ms)', () => {
    // The bell is exp(-((t-0.25)*5)^2) which peaks at t=0.25 → 175ms of 700ms.
    const peak = flareTextShadow(175, '#fff');
    const off = flareTextShadow(700, '#fff');
    const peakSpread = parseFloat(peak.split('px')[0]!);
    const offSpread = parseFloat(off.split('px')[0]!);
    expect(peakSpread).toBeGreaterThan(offSpread);
  });

  it('is deterministic for identical inputs', () => {
    expect(flareTextShadow(300, '#ffd700')).toBe(flareTextShadow(300, '#ffd700'));
  });
});
