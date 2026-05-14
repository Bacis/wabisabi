import { describe, expect, it } from 'vitest';
import {
  classifyContrast,
  contrastRatio,
  parseHex,
  relativeLuminance,
  relativeLuminanceRgb,
} from './luminance.js';

// Day 11 — WCAG luminance + contrast math. Reference values cross-checked
// against the WCAG 2.1 examples and WebAIM's contrast checker.

describe('parseHex', () => {
  it('expands 3-digit hex into 6-digit RGB', () => {
    expect(parseHex('#fff')).toEqual([255, 255, 255]);
    expect(parseHex('#000')).toEqual([0, 0, 0]);
    expect(parseHex('#f0a')).toEqual([255, 0, 170]);
  });

  it('parses 6-digit hex', () => {
    expect(parseHex('#ffd100')).toEqual([255, 209, 0]);
    expect(parseHex('#808080')).toEqual([128, 128, 128]);
  });

  it('strips alpha from 8-digit hex', () => {
    expect(parseHex('#ffd100cc')).toEqual([255, 209, 0]);
  });

  it('accepts uppercase + leading/trailing whitespace', () => {
    expect(parseHex('  #FFD100  ')).toEqual([255, 209, 0]);
  });

  it('throws on malformed input', () => {
    expect(() => parseHex('ffd100')).toThrow(/parseHex/);
    expect(() => parseHex('#ffd1')).toThrow(/parseHex/);
    expect(() => parseHex('#xyz')).toThrow(/parseHex/);
  });
});

describe('relativeLuminance', () => {
  it('white = 1.0 exactly', () => {
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1.0, 6);
  });

  it('black = 0.0 exactly', () => {
    expect(relativeLuminance('#000000')).toBeCloseTo(0.0, 6);
  });

  it('mid-gray #808080 is ~0.2159 (WCAG reference)', () => {
    // 128/255 = 0.50196 → linearized = ((0.50196 + 0.055)/1.055)^2.4 ≈ 0.2159
    expect(relativeLuminance('#808080')).toBeCloseTo(0.2159, 3);
  });

  it('yellow #ffd100 is bright (>0.65)', () => {
    const l = relativeLuminance('#ffd100');
    expect(l).toBeGreaterThan(0.65);
    expect(l).toBeLessThan(0.80);
  });

  it('relativeLuminanceRgb agrees with relativeLuminance', () => {
    expect(relativeLuminanceRgb([255, 209, 0])).toBeCloseTo(
      relativeLuminance('#ffd100'),
      10,
    );
  });
});

describe('contrastRatio', () => {
  it('white on black = 21.0 exactly (WCAG canonical max)', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21.0, 6);
  });

  it('is symmetric (order-independent)', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21.0, 6);
  });

  it('identical colors = 1.0 exactly', () => {
    expect(contrastRatio('#ffd100', '#ffd100')).toBeCloseTo(1.0, 6);
  });

  it('#808080 on white = ~3.95 (WCAG normal-text bound)', () => {
    expect(contrastRatio('#808080', '#ffffff')).toBeCloseTo(3.95, 1);
  });

  it('yellow #ffd100 on black is high (>14)', () => {
    expect(contrastRatio('#ffd100', '#000000')).toBeGreaterThan(14);
  });

  it('yellow #ffd100 on white is low (<2)', () => {
    expect(contrastRatio('#ffd100', '#ffffff')).toBeLessThan(2);
  });
});

describe('classifyContrast', () => {
  it('21 → comfortable', () => {
    expect(classifyContrast(21)).toBe('comfortable');
  });

  it('threshold edges fall on the right tier', () => {
    expect(classifyContrast(7.0)).toBe('comfortable');
    expect(classifyContrast(6.99)).toBe('acceptable');
    expect(classifyContrast(4.5)).toBe('acceptable');
    expect(classifyContrast(4.49)).toBe('marginal');
    expect(classifyContrast(3.0)).toBe('marginal');
    expect(classifyContrast(2.99)).toBe('fail');
    expect(classifyContrast(1.0)).toBe('fail');
  });
});
