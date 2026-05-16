import { describe, expect, it } from 'vitest';
import {
  validateApplyPreset,
  validateSetEffect,
  validateSetLayoutStrategy,
  validateTuneField,
} from './agentTools.js';

describe('validateApplyPreset', () => {
  it('returns the matching pack for a known slot+presetId', () => {
    const result = validateApplyPreset({ slot: 'theme', presetId: 'cinematicCascade' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.applied).toBe('preset.theme.cinematicCascade');
      // Sanity: theme.cinematicCascade sets layout.position.
      expect((result.patch.layout as { position: string } | undefined)?.position).toBe('bottom');
    }
  });

  it('rejects an unknown slot with the list of known slots', () => {
    const result = validateApplyPreset({ slot: 'totallyMadeUp', presetId: 'whatever' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('known slots');
  });

  it('rejects an unknown presetId within a known slot', () => {
    const result = validateApplyPreset({ slot: 'theme', presetId: 'totallyMadeUp' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('cinematicCascade');
  });
});

describe('validateSetEffect', () => {
  it('accepts a palette-tier assignment with valid params', () => {
    const result = validateSetEffect({ tier: 'p0', effect: 'shockwave', params: { intensity: 0.6 } });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.applied).toBe('reel.tiers.p0');
      const reelPatch = (result.patch.reel as Record<string, unknown>);
      const tier = (reelPatch.tiers as { byPaletteIndex: Record<string, { effect: string; intensity: number }> })
        .byPaletteIndex['0']!;
      expect(tier.effect).toBe('shockwave');
      expect(tier.intensity).toBe(0.6);
    }
  });

  it('routes the italic tier to reel.tiers.italic', () => {
    const result = validateSetEffect({ tier: 'italic', effect: 'breathe' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const reelPatch = result.patch.reel as Record<string, unknown>;
      const italicTier = (reelPatch.tiers as { italic: { effect: string } }).italic;
      expect(italicTier.effect).toBe('breathe');
    }
  });

  it('rejects an unknown tier key', () => {
    const result = validateSetEffect({ tier: 'p0x', effect: 'shockwave' });
    expect(result.ok).toBe(false);
  });

  it('rejects an unknown effect id with the list of known effects', () => {
    const result = validateSetEffect({ tier: 'p0', effect: 'glitter-rainbow' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('shockwave');
  });

  it('rejects out-of-range intensity (the wordReveal-style footgun goes away)', () => {
    const result = validateSetEffect({ tier: 'p0', effect: 'shockwave', params: { intensity: 2 } });
    expect(result.ok).toBe(false);
  });
});

describe('validateSetLayoutStrategy', () => {
  it('accepts cascade-stack with valid params and writes the loose paths the renderer reads', () => {
    const result = validateSetLayoutStrategy({
      strategy: 'cascade-stack',
      params: { cascadeBottomRatio: 0.55, maxWidthPercent: 75 },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const reel = result.patch.reel as Record<string, unknown>;
      expect(reel.cascadeBottomRatio).toBe(0.55);
      expect(reel.maxWidthPercent).toBe(75);
      // Forward-compat hint.
      expect((reel.layout as { strategy: string }).strategy).toBe('cascade-stack');
    }
  });

  it('rejects an unknown strategy with the list of known strategies', () => {
    const result = validateSetLayoutStrategy({ strategy: 'made-up' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('cascade-stack');
  });

  it('rejects out-of-range maxWidthPercent (no more 0.8-vs-80 normalizer)', () => {
    const result = validateSetLayoutStrategy({
      strategy: 'cascade-stack',
      params: { maxWidthPercent: 150 },
    });
    expect(result.ok).toBe(false);
  });

  it('accepts free-positioned with a box', () => {
    const result = validateSetLayoutStrategy({
      strategy: 'free-positioned',
      params: { box: { x: 0.1, y: 0.5, w: 0.8, h: 0.2 } },
    });
    expect(result.ok).toBe(true);
  });
});

describe('validateTuneField', () => {
  it('writes a single-segment path under an allowed root', () => {
    const result = validateTuneField({ path: 'charAdvance', value: 0.6 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect((result.patch as Record<string, unknown>).charAdvance).toBe(0.6);
    }
  });

  it('writes a deep dot-path correctly', () => {
    const result = validateTuneField({ path: 'reel.cascadeBottomRatio', value: 0.55 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const reel = result.patch.reel as Record<string, unknown>;
      expect(reel.cascadeBottomRatio).toBe(0.55);
    }
  });

  it('rejects an empty path', () => {
    expect(validateTuneField({ path: '', value: 1 }).ok).toBe(false);
  });

  it('rejects a path under a disallowed root', () => {
    const result = validateTuneField({ path: 'arbitraryRoot.x', value: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('not allowed');
  });
});
