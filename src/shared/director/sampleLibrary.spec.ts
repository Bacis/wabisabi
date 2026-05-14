import { describe, expect, it } from 'vitest';
import { resolveSamplePath, SAMPLE_LIBRARY } from './sampleLibrary.js';
import { SONIC_GESTURES } from './vocabularies.js';

describe('SAMPLE_LIBRARY', () => {
  it('has an entry for every sonic gesture', () => {
    for (const g of SONIC_GESTURES) {
      expect(SAMPLE_LIBRARY[g]).toBeDefined();
      expect(SAMPLE_LIBRARY[g].length).toBeGreaterThan(0);
    }
  });

  it('ships 5 variants per gesture except typewriter (12)', () => {
    for (const g of SONIC_GESTURES) {
      if (g === 'tick') {
        expect(SAMPLE_LIBRARY[g].length).toBe(12);
      } else {
        expect(SAMPLE_LIBRARY[g].length).toBe(5);
      }
    }
  });

  it('paths are relative to remotion/public/ (no leading slash)', () => {
    for (const g of SONIC_GESTURES) {
      for (const p of SAMPLE_LIBRARY[g]) {
        expect(p.startsWith('/')).toBe(false);
        expect(p.startsWith('audio/')).toBe(true);
        expect(p.endsWith('.mp3')).toBe(true);
      }
    }
  });
});

describe('resolveSamplePath', () => {
  it('returns the same path for the same key (deterministic)', () => {
    const a = resolveSamplePath('thud', 'beat-3');
    const b = resolveSamplePath('thud', 'beat-3');
    expect(a).toBe(b);
  });

  it('distributes different keys across the variant set', () => {
    // 200 random-ish keys should land on at least 3 distinct variants
    // out of 5.
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const p = resolveSamplePath('pop', `beat-${i}`);
      if (p) seen.add(p);
    }
    expect(seen.size).toBeGreaterThanOrEqual(3);
  });

  it('returns a path from the gesture\'s variant set', () => {
    const p = resolveSamplePath('shimmer', 'foo');
    expect(p).toBeDefined();
    expect(SAMPLE_LIBRARY.shimmer).toContain(p as string);
  });
});
