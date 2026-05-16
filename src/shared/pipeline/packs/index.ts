// Slotted preset tree — the agent's `applyPreset({ slot, presetId })` tool
// indexes into this. Each slot holds named DeepPartial<StyleSpec> packs that
// compose cleanly with each other. Adding a new pack is one entry.
//
// Phase 7 ships a starter set covering the existing reel-clone-default
// look (cinematic cascade + Inter Black + yellow/red palette + progressive
// reveal + subtle italic accent). Phase 9 rewrites reel-clone-default
// itself as compose(packs.theme.cinematicCascade, packs.font.interBlack, ...)
// to prove the pattern works.

import type { StylepackPartial } from '../compose.js';

// ---------------------------------------------------------------------------
// theme/* — vibe + color palette + emphasis style. Pick at most one.

export const themeCinematicCascade: StylepackPartial = {
  layout: {
    position: 'bottom',
    safeMargin: 0.18,
    align: 'left',
    maxWordsPerLine: 3,
  },
  reel: {
    emphasisStyle: 'block',
    emphasisFillRatio: 0.75,
    emphasisMaxHeightRatio: 0.16,
    cascadeTopRatio: 1,
    cascadeBottomRatio: 0.47,
    columnGapRatio: 0.18,
    rowGapRatio: 0.04,
    maxWidthPercent: 80,
    paddingPercent: 6,
    inferEmphasis: true,
  },
};

export const themePopMinimal: StylepackPartial = {
  layout: {
    position: 'bottom',
    safeMargin: 0.15,
    align: 'center',
    maxWordsPerLine: 4,
  },
  animation: {
    preset: 'spring-scale-in',
  },
};

// ---------------------------------------------------------------------------
// font/* — typeface + weight choice. Pick at most one.

export const fontInterBlack: StylepackPartial = {
  font: {
    family: 'Inter',
    weight: 900,
    size: 234,
    letterSpacing: -2,
    textTransform: 'lowercase',
  },
  charAdvance: 0.558,
  reel: {
    emphasisWeight: 900,
    emphasisTextTransform: 'uppercase',
    fillerTextTransform: 'lowercase',
    mediumTextTransform: 'lowercase',
  },
};

export const fontImpactBold: StylepackPartial = {
  font: {
    family: 'Impact',
    weight: 700,
    textTransform: 'uppercase',
  },
};

// ---------------------------------------------------------------------------
// palette/* — color triple (fill + emphasis + stroke). Pick at most one.

export const paletteYellowRed: StylepackPartial = {
  color: {
    fill: '#ffffff',
    strokeWidth: 0,
    emphasisFill: ['#ffd700', '#ff2a2a'],
  },
  reel: {
    multiColorEmphasis: true,
  },
};

export const paletteWhiteOnly: StylepackPartial = {
  color: {
    fill: '#ffffff',
    strokeWidth: 0,
    emphasisFill: '#ffffff',
  },
};

// ---------------------------------------------------------------------------
// motion/* — entry timing + reveal mode. Pick at most one.

export const motionProgressiveReveal: StylepackPartial = {
  animation: {
    preset: 'per-word-crossfade',
    tailMs: 200,
  },
  reel: {
    wordReveal: 'progressive',
  },
};

export const motionSnappyPop: StylepackPartial = {
  animation: {
    preset: 'spring-scale-in',
  },
};

// ---------------------------------------------------------------------------
// accent/* — minor decorative passes. Composable.

export const accentSubtleItalic: StylepackPartial = {
  reel: {
    italicAccentRate: 0.057,
  },
};

export const accentNeonGlow: StylepackPartial = {
  color: {
    shadow: { color: '#ffd700', blurPx: 32, offsetX: 0, offsetY: 0 },
  },
};

// ---------------------------------------------------------------------------
// fx/* — single-effect-per-tier assignments. Composable; later wins on tier
// key thanks to the composer's discriminator-aware replace.

export const fxShockwaveEmphasis: StylepackPartial = {
  reel: {
    tiers: {
      byPaletteIndex: {
        '0': { effect: 'shockwave', intensity: 0.7 },
      },
    },
  },
};

export const fxSambaLetters: StylepackPartial = {
  reel: {
    tiers: {
      byPaletteIndex: {
        '0': { effect: 'samba', intensity: 0.5 },
      },
    },
  },
};

// ---------------------------------------------------------------------------
// The full slotted tree the agent walks via applyPreset({ slot, presetId }).

export const PRESET_PACKS = {
  theme: {
    cinematicCascade: themeCinematicCascade,
    popMinimal: themePopMinimal,
  },
  font: {
    interBlack: fontInterBlack,
    impactBold: fontImpactBold,
  },
  palette: {
    yellowRed: paletteYellowRed,
    whiteOnly: paletteWhiteOnly,
  },
  motion: {
    progressiveReveal: motionProgressiveReveal,
    snappyPop: motionSnappyPop,
  },
  accent: {
    subtleItalic: accentSubtleItalic,
    neonGlow: accentNeonGlow,
  },
  fx: {
    shockwaveEmphasis: fxShockwaveEmphasis,
    sambaLetters: fxSambaLetters,
  },
} as const;

export type PresetSlot = keyof typeof PRESET_PACKS;
export type PresetIdFor<S extends PresetSlot> = keyof typeof PRESET_PACKS[S];

export function getPresetPack(slot: string, presetId: string): StylepackPartial | null {
  const slotMap = (PRESET_PACKS as Record<string, Record<string, StylepackPartial>>)[slot];
  if (!slotMap) return null;
  return slotMap[presetId] ?? null;
}
