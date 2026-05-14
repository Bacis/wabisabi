import { describe, expect, it } from 'vitest';
import { remediateContrast } from './remediate.js';

// Day 13 — remediation cascade tests. Each stage of the cascade is
// triggered by feeding the input that should produce exactly that stage's
// output. The cascade is a deterministic recipe — same input → same report.

describe('remediateContrast — stage 0: no action', () => {
  it('returns none when contrast is ≥ 7.0', () => {
    // white on black = 21:1 — comfortable
    const r = remediateContrast('#ffffff', '#000000');
    expect(r.appliedRemediation).toBe('none');
    expect(r.finalFillHex).toBe('#ffffff');
    expect(r.strokeColor).toBeUndefined();
    expect(r.finalContrast).toBe(r.originalContrast);
  });
});

describe('remediateContrast — stage 1: stroke boost', () => {
  it('applies a 2px stroke when contrast lands in 4.5..7', () => {
    // #707070 (luminance ≈ 0.164) on white → contrast ≈ 4.9 (acceptable tier).
    const r = remediateContrast('#707070', '#ffffff');
    expect(r.originalContrast).toBeGreaterThanOrEqual(4.5);
    expect(r.originalContrast).toBeLessThan(7.0);
    expect(r.appliedRemediation).toBe('stroke');
    // Dark fill on light bg → opposite-luminance stroke is white
    expect(r.strokeColor).toBe('#ffffff');
    expect(r.strokeWidth).toBe(2);
    expect(r.shadow).toBeUndefined();
  });

  it('uses a black stroke when the fill is light', () => {
    // #c8c8c8 (luminance ≈ 0.583, fillLum>=0.5 → black stroke) on #4f4f4f
    // (luminance ≈ 0.078) → contrast ≈ 4.95 (acceptable tier).
    const r = remediateContrast('#c8c8c8', '#4f4f4f');
    expect(r.originalContrast).toBeGreaterThanOrEqual(4.5);
    expect(r.originalContrast).toBeLessThan(7.0);
    expect(r.appliedRemediation).toBe('stroke');
    expect(r.strokeColor).toBe('#000000');
  });
});

describe('remediateContrast — stage 2: stroke + shadow', () => {
  it('applies a 3px stroke + drop shadow in the marginal tier (3..4.5)', () => {
    // #808080 on #ffffff ≈ 3.95:1 — marginal
    const r = remediateContrast('#808080', '#ffffff');
    expect(r.appliedRemediation).toBe('shadow');
    expect(r.strokeColor).toBe('#ffffff');
    expect(r.strokeWidth).toBe(3);
    expect(r.shadow).toBeDefined();
    expect(r.shadow?.blurPx).toBeGreaterThan(0);
  });
});

describe('remediateContrast — stage 3: backplate', () => {
  it('places a backplate when fill fails (< 3.0) but contrasts well with the backplate', () => {
    // yellow #ffd100 on a similar-luminance off-white bg — fill fails on bg
    // but reads cleanly on the dark backplate.
    const r = remediateContrast('#ffd100', '#fff2c0');
    expect(r.originalContrast).toBeLessThan(3.0);
    expect(r.appliedRemediation).toBe('backplate');
    expect(r.backplate).toBeDefined();
    // Light fill (yellow) → dark backplate
    expect(r.backplate?.color).toBe('#000000');
    expect(r.finalContrast).toBeGreaterThanOrEqual(4.5);
  });
});

describe('remediateContrast — stage 4: palette swap', () => {
  it('picks the palette entry with the best contrast when backplate is insufficient', () => {
    // #999999 (luminance ≈ 0.32) on white:
    //   originalContrast = (1+0.05)/(0.32+0.05) ≈ 2.84  (fails, < 3.0)
    //   backplate of #999999 (fillLum<0.5) = white; backplate contrast
    //     = (1+0.05)/(0.32+0.05) ≈ 2.84 — insufficient at 4.5.
    //   palette ['#000000']: black on white = 21.0 → clears 4.5. Wins.
    const r = remediateContrast('#999999', '#ffffff', {
      palette: ['#000000', '#ff0000'],
    });
    expect(r.originalContrast).toBeLessThan(3.0);
    expect(r.appliedRemediation).toBe('palette-swap');
    expect(r.finalFillHex).toBe('#000000');
    expect(r.finalContrast).toBeGreaterThanOrEqual(4.5);
  });

  it('falls through to safe-fallback when no palette entry clears the target', () => {
    // Same fill/bg, but palette only has near-grey entries that don't help.
    const r = remediateContrast('#999999', '#ffffff', {
      palette: ['#888888', '#aaaaaa'],
    });
    expect(r.appliedRemediation).toBe('safe-fallback');
  });
});

describe('remediateContrast — stage 5: safe fallback', () => {
  it('falls back to white-on-dark for a dark bg when nothing else clears', () => {
    // Force the failing tier on a dark bg, with no palette help and a
    // backplate that won't clear (impossible because backplate of light
    // fill against bg uses dark backplate which is high-contrast). Set
    // targetRatio very high to skip all stages.
    const r = remediateContrast('#222222', '#333333', { targetRatio: 21 });
    // With targetRatio=21 nothing clears except white-on-black or black-on-white
    expect(r.appliedRemediation).toBe('safe-fallback');
    // bg is dark → useWhite path
    expect(r.finalFillHex).toBe('#ffffff');
    expect(r.strokeColor).toBe('#000000');
  });

  it('falls back to black-on-light for a light bg', () => {
    const r = remediateContrast('#e0e0e0', '#f0f0f0', { targetRatio: 21 });
    expect(r.appliedRemediation).toBe('safe-fallback');
    expect(r.finalFillHex).toBe('#000000');
    expect(r.strokeColor).toBe('#ffffff');
  });
});

describe('remediateContrast — determinism and metadata', () => {
  it('produces the same report on repeated calls', () => {
    const r1 = remediateContrast('#ffd100', '#ffffff');
    const r2 = remediateContrast('#ffd100', '#ffffff');
    expect(r1).toEqual(r2);
  });

  it('always echoes back fillHex and bgHex on the report', () => {
    const r = remediateContrast('#ffd100', '#000000');
    expect(r.fillHex).toBe('#ffd100');
    expect(r.bgHex).toBe('#000000');
  });

  it('always populates a non-empty notes string', () => {
    const r = remediateContrast('#ffd100', '#000000');
    expect(r.notes.length).toBeGreaterThan(0);
  });
});
