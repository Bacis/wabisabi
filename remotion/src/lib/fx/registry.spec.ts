import { describe, expect, it } from 'vitest';
import {
  EFFECT_DESCRIPTORS,
  EFFECT_IDS,
  PER_LETTER_EFFECT_IDS,
  SVG_FILTER_EFFECT_IDS,
  getEffectKind,
  isKnownEffect,
} from './registry';

describe('EFFECT_DESCRIPTORS', () => {
  it('covers every id exactly once', () => {
    for (const id of EFFECT_IDS) {
      expect(EFFECT_DESCRIPTORS[id]).toBeDefined();
      expect(EFFECT_DESCRIPTORS[id].id).toBe(id);
    }
  });

  it('classifies the Vol.02 letter effects as per-letter', () => {
    expect(EFFECT_DESCRIPTORS.samba.kind).toBe('per-letter');
    expect(EFFECT_DESCRIPTORS.crystal.kind).toBe('per-letter');
    expect(EFFECT_DESCRIPTORS.magnetic.kind).toBe('per-letter');
  });

  it('classifies the Vol.02 word effects as per-word', () => {
    expect(EFFECT_DESCRIPTORS.breathe.kind).toBe('per-word');
    expect(EFFECT_DESCRIPTORS.flare.kind).toBe('per-word');
  });

  it('classifies all Vol.03 SVG-filter effects as svg-filter', () => {
    for (const id of ['resonance', 'inflation', 'ferro', 'shockwave'] as const) {
      expect(EFFECT_DESCRIPTORS[id].kind).toBe('svg-filter');
    }
  });

  it('classifies slice as structural', () => {
    expect(EFFECT_DESCRIPTORS.slice.kind).toBe('structural');
  });
});

describe('PER_LETTER_EFFECT_IDS / SVG_FILTER_EFFECT_IDS', () => {
  it('PER_LETTER_EFFECT_IDS contains exactly samba/crystal/magnetic', () => {
    expect([...PER_LETTER_EFFECT_IDS].sort()).toEqual(['crystal', 'magnetic', 'samba']);
  });

  it('SVG_FILTER_EFFECT_IDS lists the four Vol.03 filters', () => {
    expect([...SVG_FILTER_EFFECT_IDS].sort()).toEqual(
      ['ferro', 'inflation', 'resonance', 'shockwave'],
    );
  });
});

describe('getEffectKind / isKnownEffect', () => {
  it('returns "none" for missing or unknown ids', () => {
    expect(getEffectKind(undefined)).toBe('none');
    expect(getEffectKind(null)).toBe('none');
    expect(getEffectKind('totally-made-up')).toBe('none');
    expect(isKnownEffect('totally-made-up')).toBe(false);
  });

  it('returns the descriptor kind for known ids', () => {
    expect(getEffectKind('shockwave')).toBe('svg-filter');
    expect(getEffectKind('samba')).toBe('per-letter');
    expect(isKnownEffect('shockwave')).toBe(true);
  });
});
