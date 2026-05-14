import { describe, expect, it } from 'vitest';
import { makeSizing } from './sizing';

describe('makeSizing', () => {
  it('computes usableWidth from frameWidth × (maxWidthPercent / 100)', () => {
    const s = makeSizing({ frameWidth: 1080, maxWidthPercent: 80 });
    expect(s.usableWidth).toBeCloseTo(864);
  });

  it('uses the supplied charAdvance when present', () => {
    const s = makeSizing({ frameWidth: 1080, maxWidthPercent: 80, charAdvance: 0.5 });
    expect(s.charAdvance).toBe(0.5);
  });

  it('falls back to 0.58 when charAdvance is missing or null', () => {
    expect(makeSizing({ frameWidth: 1080, maxWidthPercent: 80 }).charAdvance).toBe(0.58);
    expect(makeSizing({ frameWidth: 1080, maxWidthPercent: 80, charAdvance: null }).charAdvance).toBe(0.58);
  });

  it('maxSizeForWord returns usableWidth / (len × charAdvance) for positive lengths', () => {
    const s = makeSizing({ frameWidth: 1080, maxWidthPercent: 80, charAdvance: 0.5 });
    // usableWidth=864, len=6, charAdvance=0.5 → 864 / (6*0.5) = 288
    expect(s.maxSizeForWord(6)).toBeCloseTo(288);
  });

  it('maxSizeForWord returns Infinity for non-positive length so Math.min short-circuits', () => {
    const s = makeSizing({ frameWidth: 1080, maxWidthPercent: 80 });
    expect(s.maxSizeForWord(0)).toBe(Infinity);
    expect(s.maxSizeForWord(-3)).toBe(Infinity);
  });
});
