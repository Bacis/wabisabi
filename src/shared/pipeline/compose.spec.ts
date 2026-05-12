import { describe, expect, it } from 'vitest';
import { compose, composePartial } from './compose.js';
import {
  fontInterBlack,
  fxPlasmaEmphasis,
  fxShockwaveEmphasis,
  paletteYellowRed,
  themeCinematicCascade,
  motionProgressiveReveal,
  accentSubtleItalic,
  getPresetPack,
} from './packs/index.js';

describe('compose', () => {
  it('returns a fully-defaulted StyleSpec from no inputs', () => {
    const out = compose();
    expect(out.font.family).toBe('Inter');
    expect(out.color.fill).toBe('#ffffff');
  });

  it('later partial wins on overlapping scalar fields', () => {
    const out = compose({ font: { weight: 400 } }, { font: { weight: 900 } });
    expect(out.font.weight).toBe(900);
  });

  it('recursively merges plain object branches', () => {
    const out = compose(
      { font: { family: 'Inter', weight: 400 } },
      { font: { weight: 900 } },
    );
    expect(out.font.family).toBe('Inter');  // preserved from first
    expect(out.font.weight).toBe(900);      // overridden by second
  });

  it('REPLACES arrays — does not concat (palette safety)', () => {
    const out = compose(
      { color: { emphasisFill: ['#aaa', '#bbb'] } },
      { color: { emphasisFill: ['#fff'] } },
    );
    expect(out.color.emphasisFill).toEqual(['#fff']);
  });

  it('composes the canonical reel-clone-default-equivalent stack', () => {
    const out = compose(
      themeCinematicCascade,
      fontInterBlack,
      paletteYellowRed,
      motionProgressiveReveal,
      accentSubtleItalic,
    );
    expect(out.font.family).toBe('Inter');
    expect(out.font.weight).toBe(900);
    expect(out.color.emphasisFill).toEqual(['#ffd700', '#ff2a2a']);
    expect(out.layout.position).toBe('bottom');
    expect(out.layout.align).toBe('left');
    // reel is loose — the typed knobs land where the renderer reads them.
    const reel = out.reel as Record<string, unknown>;
    expect(reel.cascadeBottomRatio).toBe(0.47);
    expect(reel.italicAccentRate).toBe(0.057);
    expect(reel.wordReveal).toBe('progressive');
  });

  it('respects the discriminator-replace rule for fx tier assignments', () => {
    // Two fx packs both target byPaletteIndex.0 with different effects.
    // The later one's params should replace the earlier one's wholly —
    // not merge ({ effect: 'plasma' } ∪ { effect: 'shockwave' } would be
    // ambiguous nonsense).
    const out = compose(fxPlasmaEmphasis, fxShockwaveEmphasis);
    const tier = ((out.reel as Record<string, unknown>).tiers as Record<string, unknown>)
      .byPaletteIndex as Record<string, { effect: string; intensity: number }>;
    expect(tier['0']!.effect).toBe('shockwave');
    expect(tier['0']!.intensity).toBe(0.7);
  });

  it('does not invent fields — undefined-only override leaves base intact', () => {
    const out = compose({ font: { family: 'Inter' } }, { font: undefined });
    expect(out.font.family).toBe('Inter');
  });
});

describe('composePartial', () => {
  it('merges without applying schema defaults — useful for agent draftPatch', () => {
    const out = composePartial(
      { font: { weight: 400 } },
      { color: { fill: '#000' } },
    );
    expect(out.font?.weight).toBe(400);
    expect(out.color?.fill).toBe('#000');
    // No charAdvance default applied — would have appeared if compose() ran.
    expect(out.charAdvance).toBeUndefined();
  });
});

describe('getPresetPack', () => {
  it('returns the requested pack from the slotted tree', () => {
    const pack = getPresetPack('theme', 'cinematicCascade');
    expect(pack).toBe(themeCinematicCascade);
  });

  it('returns null for unknown slot or preset id', () => {
    expect(getPresetPack('theme', 'totallyMadeUp')).toBeNull();
    expect(getPresetPack('madeup', 'plasmaEmphasis')).toBeNull();
  });
});
