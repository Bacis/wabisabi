// Slotted preset tree — the agent's `applyPreset({ slot, presetId })` tool
// indexes into this. Each slot holds named DeepPartial<StyleSpec> packs that
// compose cleanly with each other. Adding a new pack is one entry.
//
// Convention: each pack writes ONLY the fields owned by its slot, so a
// theme + font + palette compose produces a clean merged spec.
//   theme   — layout + reel.emphasisStyle + cascade ratios + tier strategy
//             (per-tier fontFamily/effect/strokeColor; NOT base font/color).
//   font    — base font.* + charAdvance + reel.*TextTransform/emphasisWeight.
//   palette — color.* + tier fill colors + reel.multiColorEmphasis.
//   motion  — animation.* + reel.wordReveal.
//   accent  — small decorative passes (italic accent rate, glow shadow).
//   fx      — single-effect-per-tier assignments. Discriminator-aware merge.
//
// Variety is the point: every freeform "make this look like X" request from
// the user should land somewhere visibly different from the cinematicCascade
// default. The 2026-trending font picks (Fraunces, Bricolage Grotesque,
// Space Grotesk, Unbounded, Hanken Grotesk, Recursive, Instrument Sans,
// Montserrat, Poppins) are the most impactful additions — they are why a
// freeform clip no longer always looks like Inter Black + yellow/red.

import type { StylepackPartial } from '../compose.js';

// ---------------------------------------------------------------------------
// theme/* — vibe + emphasis style + tier strategy. Pick at most one.

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

// Curated 10 themes mirroring REEL_CLONE_THEMES (web/src/lib/themes/
// reel-clone-themes.ts). Layout + reel.* + per-tier strategy only — base
// font/color is left to the font/* and palette/* packs so the agent can
// compose them freely.

export const themeEditorialMix: StylepackPartial = {
  layout: { position: 'bottom', safeMargin: 0.18, align: 'left', maxWordsPerLine: 3 },
  reel: {
    emphasisStyle: 'block',
    inferEmphasis: true,
    italicAccentRate: 0.06,
    tiers: {
      byPaletteIndex: {
        '0': { fontFamily: 'Playfair Display', fontWeight: 900, effect: 'breathe' },
        '1': { fontFamily: 'JetBrains Mono', fontWeight: 700 },
      },
      italic: { fontFamily: 'Cormorant Garamond', fontWeight: 400 },
    },
  },
};

export const themeConcertPoster: StylepackPartial = {
  layout: { position: 'middle', safeMargin: 0.1, align: 'center', maxWordsPerLine: 3 },
  reel: {
    emphasisStyle: 'block',
    inferEmphasis: true,
    tiers: {
      byPaletteIndex: {
        '0': { fontFamily: 'Anton', fontWeight: 400, strokeColor: '#0d0d0d', strokeWidth: 2, effect: 'magnetic' },
        '1': { fontFamily: 'Bebas Neue', fontWeight: 400 },
      },
      italic: { fontFamily: 'Permanent Marker', fontWeight: 400, effect: 'crystal' },
    },
  },
  animation: { scaleFrom: 0.6, durationMs: 90 },
};

export const themeDesignerStudio: StylepackPartial = {
  layout: { position: 'bottom', safeMargin: 0.18, align: 'left', maxWordsPerLine: 3 },
  reel: {
    emphasisStyle: 'block',
    inferEmphasis: true,
    tiers: {
      byPaletteIndex: {
        '0': { fontFamily: 'DM Sans', fontWeight: 900 },
        '1': { fontFamily: 'JetBrains Mono', fontWeight: 700 },
      },
      italic: { fontFamily: 'Outfit', fontWeight: 400 },
    },
  },
};

export const themeBoutiqueCouture: StylepackPartial = {
  layout: { position: 'middle', safeMargin: 0.18, align: 'center', maxWordsPerLine: 3 },
  reel: {
    emphasisStyle: 'block',
    inferEmphasis: true,
    italicAccentRate: 0.08,
    tiers: {
      byPaletteIndex: {
        '0': { fontFamily: 'Cormorant Garamond', fontWeight: 700 },
        '1': { fontFamily: 'Pacifico', fontWeight: 400 },
      },
      italic: { fontFamily: 'Cinzel', fontWeight: 400 },
    },
  },
  animation: { scaleFrom: 0.92, durationMs: 200, tailMs: 280 },
};

export const themeManifesto: StylepackPartial = {
  layout: { position: 'middle', safeMargin: 0.08, align: 'center', maxWordsPerLine: 3 },
  reel: {
    emphasisStyle: 'block',
    inferEmphasis: true,
    tiers: {
      byPaletteIndex: {
        '0': { fontFamily: 'Archivo Black', fontWeight: 400, strokeColor: '#0d0d0d', strokeWidth: 3 },
        '1': { fontFamily: 'Anton', fontWeight: 400, strokeColor: '#ffffff', strokeWidth: 2 },
      },
      italic: { fontFamily: 'VT323', fontWeight: 400 },
    },
  },
  animation: { scaleFrom: 0.7, durationMs: 80 },
};

export const themePersonalDiary: StylepackPartial = {
  layout: { position: 'bottom', safeMargin: 0.16, align: 'left', maxWordsPerLine: 3 },
  reel: {
    emphasisStyle: 'block',
    inferEmphasis: true,
    italicAccentRate: 0.05,
    tiers: {
      byPaletteIndex: {
        '0': { fontFamily: 'Permanent Marker', fontWeight: 400 },
        '1': { fontFamily: 'Pacifico', fontWeight: 400 },
      },
      italic: { fontFamily: 'Outfit', fontWeight: 400 },
    },
  },
  animation: { scaleFrom: 0.85, durationMs: 160 },
};

export const themeRetroArcade: StylepackPartial = {
  layout: { position: 'middle', safeMargin: 0.1, align: 'center', maxWordsPerLine: 3 },
  reel: {
    emphasisStyle: 'block',
    inferEmphasis: true,
    tiers: {
      byPaletteIndex: {
        '0': { fontFamily: 'Press Start 2P', fontWeight: 400, effect: 'crystal' },
        '1': { fontFamily: 'VT323', fontWeight: 400, effect: 'samba' },
      },
      italic: { fontFamily: 'JetBrains Mono', fontWeight: 400 },
    },
  },
  animation: { scaleFrom: 0.5, durationMs: 100 },
};

export const themeOpEd: StylepackPartial = {
  layout: { position: 'bottom', safeMargin: 0.2, align: 'left', maxWordsPerLine: 3 },
  reel: {
    emphasisStyle: 'block',
    inferEmphasis: true,
    italicAccentRate: 0.06,
    tiers: {
      byPaletteIndex: {
        '0': { fontFamily: 'Playfair Display', fontWeight: 900 },
        '1': { fontFamily: 'Cormorant Garamond', fontWeight: 700 },
      },
      italic: { fontFamily: 'DM Sans', fontWeight: 400 },
    },
  },
};

export const themeLateNightNeon: StylepackPartial = {
  layout: { position: 'middle', safeMargin: 0.1, align: 'center', maxWordsPerLine: 3 },
  reel: {
    emphasisStyle: 'block',
    inferEmphasis: true,
    tiers: {
      byPaletteIndex: {
        '0': {
          // Neon-tube gradient — hot pink → cyan, as in REEL_CLONE_THEMES.
          fill: {
            type: 'linear',
            angle: 90,
            stops: [
              { pos: 0, color: '#ff00aa' },
              { pos: 1, color: '#00f0ff' },
            ],
          },
          fontFamily: 'Bebas Neue',
          fontWeight: 400,
          effect: 'flare',
        },
        '1': {
          fontFamily: 'Workbench',
          fontWeight: 400,
          variableAxes: { BLED: 40 },
          effect: 'flare',
        },
      },
      italic: { fontFamily: 'Pacifico', fontWeight: 400, effect: 'breathe' },
    },
  },
  animation: { scaleFrom: 0.75, durationMs: 130 },
};

export const themeArchitect: StylepackPartial = {
  layout: { position: 'bottom', safeMargin: 0.2, align: 'left', maxWordsPerLine: 3 },
  reel: {
    emphasisStyle: 'block',
    inferEmphasis: true,
    tiers: {
      byPaletteIndex: {
        '0': { fontFamily: 'Cinzel', fontWeight: 900 },
        '1': { fontFamily: 'JetBrains Mono', fontWeight: 700 },
      },
      italic: { fontFamily: 'Outfit', fontWeight: 400 },
    },
  },
  animation: { scaleFrom: 0.95, durationMs: 180, tailMs: 240 },
};

// ---------------------------------------------------------------------------
// font/* — typeface + weight + size + transform. Pick at most one.

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

// Trending 2026 picks — display sans / variable / new-Google-Fonts faces
// surfaced by Typewolf + Creative Boom + the caption-font roundups.
export const fontFraunces: StylepackPartial = {
  font: {
    family: 'Fraunces',
    weight: 900,
    size: 200,
    letterSpacing: 0,
    textTransform: 'none',
  },
};

export const fontBricolageGrotesque: StylepackPartial = {
  font: {
    family: 'Bricolage Grotesque',
    weight: 800,
    size: 230,
    letterSpacing: -1.5,
    textTransform: 'lowercase',
  },
};

export const fontSpaceGrotesk: StylepackPartial = {
  font: {
    family: 'Space Grotesk',
    weight: 700,
    size: 220,
    letterSpacing: -1,
    textTransform: 'lowercase',
  },
};

export const fontUnboundedDisplay: StylepackPartial = {
  font: {
    family: 'Unbounded',
    weight: 800,
    size: 200,
    letterSpacing: 0,
    textTransform: 'uppercase',
  },
};

export const fontHankenGrotesk: StylepackPartial = {
  font: {
    family: 'Hanken Grotesk',
    weight: 900,
    size: 230,
    letterSpacing: -1.5,
    textTransform: 'lowercase',
  },
};

export const fontRecursive: StylepackPartial = {
  font: {
    family: 'Recursive',
    weight: 900,
    size: 220,
    letterSpacing: -1,
    textTransform: 'lowercase',
  },
};

export const fontInstrumentSans: StylepackPartial = {
  font: {
    family: 'Instrument Sans',
    weight: 700,
    size: 220,
    letterSpacing: -1,
    textTransform: 'lowercase',
  },
};

export const fontMontserratBold: StylepackPartial = {
  font: {
    family: 'Montserrat',
    weight: 900,
    size: 220,
    letterSpacing: -1,
    textTransform: 'uppercase',
  },
};

export const fontPoppinsBold: StylepackPartial = {
  font: {
    family: 'Poppins',
    weight: 900,
    size: 220,
    letterSpacing: -1,
    textTransform: 'uppercase',
  },
};

// Existing-theme picks — each anchors one of the curated REEL_CLONE_THEMES.
export const fontPlayfairBlack: StylepackPartial = {
  font: {
    family: 'Playfair Display',
    weight: 900,
    size: 200,
    letterSpacing: 0,
    textTransform: 'none',
  },
};

export const fontCormorantSerif: StylepackPartial = {
  font: {
    family: 'Cormorant Garamond',
    weight: 700,
    size: 210,
    letterSpacing: 0,
    textTransform: 'none',
  },
};

export const fontCinzelCaps: StylepackPartial = {
  font: {
    family: 'Cinzel',
    weight: 900,
    size: 200,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
};

export const fontAntonCondensed: StylepackPartial = {
  font: {
    family: 'Anton',
    weight: 400,
    size: 240,
    letterSpacing: 0,
    textTransform: 'uppercase',
  },
};

export const fontBebasCondensed: StylepackPartial = {
  font: {
    family: 'Bebas Neue',
    weight: 400,
    size: 240,
    letterSpacing: 0,
    textTransform: 'uppercase',
  },
};

export const fontArchivoBlack: StylepackPartial = {
  font: {
    family: 'Archivo Black',
    weight: 400,
    size: 220,
    letterSpacing: -1,
    textTransform: 'uppercase',
  },
};

export const fontPermanentMarker: StylepackPartial = {
  font: {
    family: 'Permanent Marker',
    weight: 400,
    size: 200,
    letterSpacing: 0,
    textTransform: 'none',
  },
};

export const fontPressStart2P: StylepackPartial = {
  font: {
    family: 'Press Start 2P',
    weight: 400,
    size: 140,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
};

export const fontPacificoScript: StylepackPartial = {
  font: {
    family: 'Pacifico',
    weight: 400,
    size: 220,
    letterSpacing: 0,
    textTransform: 'none',
  },
};

// ---------------------------------------------------------------------------
// palette/* — color triple (fill + emphasisFill[] + tier fills). Pick at most one.

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

// Curated 10 palettes mirroring the REEL_CLONE_THEMES swatches. Each one
// sets the base fill, the per-chunk cycle, and the matching tier fills so a
// `theme + palette` compose looks coherent end-to-end.

export const paletteEditorialCream: StylepackPartial = {
  color: {
    fill: '#fdf6e3',
    strokeWidth: 0,
    emphasisFill: ['#e8c87a', '#1b2a4e'],
  },
  reel: {
    multiColorEmphasis: true,
    tiers: {
      byPaletteIndex: {
        '0': { fill: '#e8c87a' },
        '1': { fill: '#1b2a4e' },
      },
      italic: { fill: '#7a8aa8' },
    },
  },
};

export const palettePosterRedBlack: StylepackPartial = {
  color: {
    fill: '#ffffff',
    strokeWidth: 0,
    emphasisFill: ['#ff1f3d', '#0d0d0d'],
  },
  reel: {
    multiColorEmphasis: true,
    tiers: {
      byPaletteIndex: {
        '0': { fill: '#ff1f3d' },
        '1': { fill: '#0d0d0d' },
      },
      italic: { fill: '#ff4fa3' },
    },
  },
};

export const paletteStudioNeonLime: StylepackPartial = {
  color: {
    fill: '#f5f7fa',
    strokeWidth: 0,
    emphasisFill: ['#1a1a1f', '#a8ff00'],
  },
  reel: {
    multiColorEmphasis: true,
    tiers: {
      byPaletteIndex: {
        '0': { fill: '#1a1a1f' },
        '1': { fill: '#a8ff00' },
      },
      italic: { fill: '#3a3a45' },
    },
  },
};

export const paletteCoutureRose: StylepackPartial = {
  color: {
    fill: '#fff8ee',
    strokeWidth: 0,
    emphasisFill: ['#c4a274', '#d8839f'],
  },
  reel: {
    multiColorEmphasis: true,
    tiers: {
      byPaletteIndex: {
        '0': { fill: '#c4a274' },
        '1': { fill: '#d8839f' },
      },
      italic: { fill: '#7a3b2e' },
    },
  },
};

export const paletteManifestoRed: StylepackPartial = {
  color: {
    fill: '#ffffff',
    strokeWidth: 0,
    emphasisFill: ['#ff0019', '#0d0d0d'],
  },
  reel: {
    multiColorEmphasis: true,
    tiers: {
      byPaletteIndex: {
        '0': { fill: '#ff0019' },
        '1': { fill: '#0d0d0d' },
      },
      italic: { fill: '#ff0019' },
    },
  },
};

export const paletteDiaryNavyRose: StylepackPartial = {
  color: {
    fill: '#fff5e8',
    strokeWidth: 0,
    emphasisFill: ['#1f3a5f', '#e8748a'],
  },
  reel: {
    multiColorEmphasis: true,
    tiers: {
      byPaletteIndex: {
        '0': { fill: '#1f3a5f' },
        '1': { fill: '#e8748a' },
      },
      italic: { fill: '#3a2418' },
    },
  },
};

export const paletteArcadeNeon: StylepackPartial = {
  color: {
    fill: '#ffffff',
    strokeWidth: 0,
    emphasisFill: ['#ffe600', '#00f0ff'],
  },
  reel: {
    multiColorEmphasis: true,
    tiers: {
      byPaletteIndex: {
        '0': { fill: '#ffe600' },
        '1': { fill: '#00f0ff' },
      },
      italic: { fill: '#a8ff00' },
    },
  },
};

export const paletteOpEdInkRed: StylepackPartial = {
  color: {
    fill: '#fdf6e3',
    strokeWidth: 0,
    emphasisFill: ['#0d0d0d', '#7a1a1a'],
  },
  reel: {
    multiColorEmphasis: true,
    tiers: {
      byPaletteIndex: {
        '0': { fill: '#0d0d0d' },
        '1': { fill: '#7a1a1a' },
      },
      italic: { fill: '#3a3a45' },
    },
  },
};

export const paletteVegasPinkCyan: StylepackPartial = {
  color: {
    fill: '#ffffff',
    strokeWidth: 0,
    emphasisFill: ['#ff00aa', '#00f0ff'],
  },
  reel: {
    multiColorEmphasis: true,
    tiers: {
      byPaletteIndex: {
        '0': { fill: '#ff00aa' },
        '1': { fill: '#00f0ff' },
      },
      italic: { fill: '#ffe600' },
    },
  },
};

export const paletteArchitectNavyGold: StylepackPartial = {
  color: {
    fill: '#fdf6e3',
    strokeWidth: 0,
    emphasisFill: ['#1b2a4e', '#c9a05c'],
  },
  reel: {
    multiColorEmphasis: true,
    tiers: {
      byPaletteIndex: {
        '0': { fill: '#1b2a4e' },
        '1': { fill: '#c9a05c' },
      },
      italic: { fill: '#a8a89c' },
    },
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
    editorialMix: themeEditorialMix,
    concertPoster: themeConcertPoster,
    designerStudio: themeDesignerStudio,
    boutiqueCouture: themeBoutiqueCouture,
    manifesto: themeManifesto,
    personalDiary: themePersonalDiary,
    retroArcade: themeRetroArcade,
    opEd: themeOpEd,
    lateNightNeon: themeLateNightNeon,
    architect: themeArchitect,
  },
  font: {
    interBlack: fontInterBlack,
    impactBold: fontImpactBold,
    fraunces: fontFraunces,
    bricolageGrotesque: fontBricolageGrotesque,
    spaceGrotesk: fontSpaceGrotesk,
    unboundedDisplay: fontUnboundedDisplay,
    hankenGrotesk: fontHankenGrotesk,
    recursive: fontRecursive,
    instrumentSans: fontInstrumentSans,
    montserratBold: fontMontserratBold,
    poppinsBold: fontPoppinsBold,
    playfairBlack: fontPlayfairBlack,
    cormorantSerif: fontCormorantSerif,
    cinzelCaps: fontCinzelCaps,
    antonCondensed: fontAntonCondensed,
    bebasCondensed: fontBebasCondensed,
    archivoBlack: fontArchivoBlack,
    permanentMarker: fontPermanentMarker,
    pressStart2P: fontPressStart2P,
    pacificoScript: fontPacificoScript,
  },
  palette: {
    yellowRed: paletteYellowRed,
    whiteOnly: paletteWhiteOnly,
    editorialCream: paletteEditorialCream,
    posterRedBlack: palettePosterRedBlack,
    studioNeonLime: paletteStudioNeonLime,
    coutureRose: paletteCoutureRose,
    manifestoRed: paletteManifestoRed,
    diaryNavyRose: paletteDiaryNavyRose,
    arcadeNeon: paletteArcadeNeon,
    opEdInkRed: paletteOpEdInkRed,
    vegasPinkCyan: paletteVegasPinkCyan,
    architectNavyGold: paletteArchitectNavyGold,
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
