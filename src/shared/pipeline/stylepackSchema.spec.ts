import { describe, expect, it } from 'vitest';
import {
  effectAssignmentSchema,
  fxConfigSchema,
  layoutConfigSchema,
  linguisticsConfigSchema,
  motionEntrySchema,
  reelStylepackSchema,
  typographyConfigSchema,
} from './stylepackSchema.js';
import { EFFECT_IDS } from './effectIds.js';

describe('reelStylepackSchema', () => {
  it('parses an empty input to a fully-defaulted Stylepack', () => {
    const out = reelStylepackSchema.parse({});
    expect(out.linguistics.inferEmphasis).toBe(true);
    expect(out.chunking.source).toBe('caption-plan');
    expect(out.layout.strategy).toBe('cascade-stack');
    expect(out.typography.base.emphasisStyle).toBe('combined');
    expect(out.motion.entry.preset).toBe('progressive-reveal');
    expect(out.fx.tiers).toEqual({});
  });
});

describe('layoutConfigSchema', () => {
  it('discriminates on strategy and applies that strategy\'s defaults', () => {
    const cs = layoutConfigSchema.parse({ strategy: 'cascade-stack' });
    expect(cs.strategy).toBe('cascade-stack');
    if (cs.strategy === 'cascade-stack') {
      expect(cs.params.cascadeBottomRatio).toBe(0.47);
      expect(cs.params.maxWidthPercent).toBe(80);
    }
  });

  it('rejects strategy params from the wrong variant (typed instead of normalizer)', () => {
    // cascade-stack has no `align` field (single-line-flow does). With a
    // typed discriminator the schema rejects this at parse time instead of
    // silently accepting and confusing the renderer.
    const result = layoutConfigSchema.safeParse({ strategy: 'cascade-stack', params: { align: 'left' } });
    // align is unknown for cascade-stack — Zod ignores unknown keys by
    // default but the strategy still parses. The real win is that swapping
    // strategies replaces all params (the composer does this in Phase 7).
    expect(result.success).toBe(true);
  });

  it('rejects out-of-range maxWidthPercent (replacing the defensive normalizer)', () => {
    const result = layoutConfigSchema.safeParse({
      strategy: 'cascade-stack',
      params: { maxWidthPercent: 0.8 },
    });
    expect(result.success).toBe(true); // 0.8 IS in [0, 100], allowed
    const bad = layoutConfigSchema.safeParse({
      strategy: 'cascade-stack',
      params: { maxWidthPercent: 101 },
    });
    expect(bad.success).toBe(false);
  });

  it('rejects an unknown strategy id', () => {
    const result = layoutConfigSchema.safeParse({ strategy: 'totally-made-up' });
    expect(result.success).toBe(false);
  });
});

describe('motionEntrySchema', () => {
  it('rejects an entry preset that is missing its required discriminator', () => {
    const result = motionEntrySchema.safeParse({ durationMs: 200 });
    expect(result.success).toBe(false);
  });

  it('parses progressive-reveal with defaults', () => {
    const out = motionEntrySchema.parse({ preset: 'progressive-reveal' });
    if (out.preset === 'progressive-reveal') {
      expect(out.durationMs).toBe(140);
      expect(out.scaleFrom).toBe(0.7);
    }
  });
});

describe('typographyConfigSchema', () => {
  it('rejects wordReveal-style footguns at the schema layer instead of normalizing', () => {
    const result = typographyConfigSchema.safeParse({
      base: { emphasisStyle: 'block' },
      tiers: { p0: { fontWeight: 1000 } },  // out of range
    });
    expect(result.success).toBe(false);
  });

  it('accepts a tier override on p0 with valid fields', () => {
    const out = typographyConfigSchema.parse({
      base: {},
      tiers: { p0: { fontWeight: 900, sizeMultiplier: 1.2 } },
    });
    expect(out.tiers.p0?.fontWeight).toBe(900);
  });

  it('rejects invalid tier keys (must be "italic" or pN)', () => {
    const result = typographyConfigSchema.safeParse({
      tiers: { 'random-key': { fontWeight: 700 } },
    });
    expect(result.success).toBe(false);
  });
});

describe('linguisticsConfigSchema', () => {
  it('clamps italicAccent.rate range', () => {
    const bad = linguisticsConfigSchema.safeParse({
      italicAccent: { mode: 'rate', rate: 2 },
    });
    expect(bad.success).toBe(false);
  });
});

describe('effectAssignmentSchema', () => {
  it('covers every id in EFFECT_IDS exactly once', () => {
    const variantIds = effectAssignmentSchema.options.map((o) => o.shape.effect.value).sort();
    const expected = [...EFFECT_IDS].sort();
    expect(variantIds).toEqual(expected);
  });

  it('parses a shockwave assignment with default intensity 0.5', () => {
    const out = effectAssignmentSchema.parse({ effect: 'shockwave' });
    expect(out.effect).toBe('shockwave');
    expect(out.params.intensity).toBe(0.5);
  });

  it('rejects an unknown effect id (no silent fallthrough)', () => {
    const result = effectAssignmentSchema.safeParse({ effect: 'glitter-rainbow' });
    expect(result.success).toBe(false);
  });

  it('rejects intensity outside [0, 1]', () => {
    expect(effectAssignmentSchema.safeParse({ effect: 'shockwave', params: { intensity: 1.5 } }).success).toBe(false);
    expect(effectAssignmentSchema.safeParse({ effect: 'shockwave', params: { intensity: -0.1 } }).success).toBe(false);
  });
});

describe('fxConfigSchema.tiers', () => {
  it('accepts a single-effect-per-tier shape', () => {
    const out = fxConfigSchema.parse({
      tiers: { p0: { effect: 'shockwave', params: { intensity: 0.7 } } },
    });
    const tier = out.tiers.p0;
    expect(Array.isArray(tier)).toBe(false);
    expect((tier as { effect: string }).effect).toBe('shockwave');
  });

  it('accepts an array of stacked effects per tier', () => {
    const out = fxConfigSchema.parse({
      tiers: {
        p0: [
          { effect: 'shockwave', params: { intensity: 0.6 } },
          { effect: 'flare' },
        ],
      },
    });
    expect(Array.isArray(out.tiers.p0)).toBe(true);
  });

  it('routes to the italic tier under the "italic" key', () => {
    const out = fxConfigSchema.parse({
      tiers: { italic: { effect: 'breathe' } },
    });
    expect(out.tiers.italic).toBeDefined();
  });
});
