import { describe, expect, it } from 'vitest';
import { diffFromDefaults, summarizeSpec } from './agentSpecDigest.js';
import { PRESETS } from '../shared/presets.js';
import { PRESET_PACKS } from '../shared/pipeline/packs/index.js';
import { composePartial } from '../shared/pipeline/compose.js';

describe('summarizeSpec', () => {
  it('returns the clean-spec line for an empty spec', () => {
    expect(summarizeSpec({})).toBe('Currently: clean spec.');
  });

  it('detects hormozi-cascade when the four slot recipe matches', () => {
    const spec = composePartial(
      composePartial(
        composePartial(PRESET_PACKS.theme.cinematicCascade, PRESET_PACKS.font.interBlack),
        PRESET_PACKS.palette.yellowRed,
      ),
      PRESET_PACKS.motion.progressiveReveal,
    );
    const out = summarizeSpec(spec as Record<string, unknown>);
    expect(out).toContain('hormozi-cascade');
    // Archetype should consume the slots it names — slots shouldn't reappear
    // verbatim alongside the archetype tag.
    expect(out).not.toContain('theme:cinematicCascade');
    expect(out).not.toContain('palette:yellowRed');
  });

  it('falls back to slot listing when no archetype matches', () => {
    const spec = composePartial(
      PRESET_PACKS.fx.plasmaEmphasis,
      PRESET_PACKS.accent.neonGlow,
    );
    const out = summarizeSpec(spec as Record<string, unknown>);
    expect(out).toContain('fx:plasmaEmphasis');
    expect(out).toContain('accent:neonGlow');
  });

  it('mentions active fx effects with intensity', () => {
    const spec = composePartial({}, PRESET_PACKS.fx.shockwaveEmphasis) as Record<string, unknown>;
    const out = summarizeSpec(spec);
    expect(out).toContain('shockwave');
    expect(out).toContain('intensity 0.7');
  });
});

describe('diffFromDefaults', () => {
  it('returns empty for the reel-clone canonical default', () => {
    const out = diffFromDefaults(
      PRESETS['reel-clone-default']!.styleSpec as Record<string, unknown>,
      'reel-clone',
    );
    expect(Object.keys(out)).toHaveLength(0);
  });

  it('flags only the fields that differ from the reel-clone baseline', () => {
    const baseline = PRESETS['reel-clone-default']!.styleSpec as Record<string, unknown>;
    const spec = JSON.parse(JSON.stringify(baseline)) as Record<string, unknown>;
    (spec.font as Record<string, unknown>).weight = 700;
    (spec.color as Record<string, unknown>).fill = '#ff0000';
    const out = diffFromDefaults(spec, 'reel-clone');
    expect(out['font.weight']).toBe(700);
    expect(out['color.fill']).toBe('#ff0000');
    expect(Object.keys(out)).toHaveLength(2);
  });

  it('treats an empty spec as fully default (no diff)', () => {
    const out = diffFromDefaults({}, 'reel-clone');
    expect(Object.keys(out)).toHaveLength(0);
  });

  it('caps output at MAX_DIFF_PATHS with a truncation marker', () => {
    const spec: Record<string, unknown> = {};
    for (let i = 0; i < 50; i++) {
      // Use a flat path that the baseline definitely doesn't have so every
      // entry counts as a diff.
      (spec as Record<string, unknown>)[`zCustomField${i}`] = i;
    }
    const out = diffFromDefaults(spec, 'caption-designer');
    expect(out.__truncated).toBe(20);
    // 30 real paths + 1 truncation marker
    expect(Object.keys(out)).toHaveLength(31);
  });

  it('uses an empty baseline for the caption-designer template', () => {
    const out = diffFromDefaults({ font: { weight: 800 } }, 'caption-designer');
    expect(out['font.weight']).toBe(800);
  });
});
