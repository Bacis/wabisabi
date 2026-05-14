import { describe, expect, it } from 'vitest';
import { blendRgbHex, hexToRgb } from './colorBlend';

describe('hexToRgb', () => {
  it('parses 6-char hex', () => {
    expect(hexToRgb('#ff5b3c')).toEqual([0xff, 0x5b, 0x3c]);
    expect(hexToRgb('FFD700')).toEqual([0xff, 0xd7, 0x00]);
  });

  it('expands 3-char shorthand', () => {
    expect(hexToRgb('#abc')).toEqual([0xaa, 0xbb, 0xcc]);
  });

  it('discards 8-char alpha channel', () => {
    expect(hexToRgb('#ff5b3c80')).toEqual([0xff, 0x5b, 0x3c]);
  });

  it('returns white on invalid input', () => {
    expect(hexToRgb('garbage')).toEqual([255, 255, 255]);
    expect(hexToRgb('#zzzzzz')).toEqual([255, 255, 255]);
  });
});

describe('blendRgbHex', () => {
  it('returns endpoint a at t=0', () => {
    expect(blendRgbHex([0, 0, 0], [255, 255, 255], 0)).toBe('rgb(0, 0, 0)');
  });

  it('returns endpoint b at t=1', () => {
    expect(blendRgbHex([0, 0, 0], [255, 255, 255], 1)).toBe('rgb(255, 255, 255)');
  });

  it('linearly interpolates components at t=0.5 with rounding', () => {
    expect(blendRgbHex([0, 100, 200], [200, 200, 0], 0.5)).toBe('rgb(100, 150, 100)');
  });
});
