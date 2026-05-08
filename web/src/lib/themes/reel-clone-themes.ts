import type { Theme } from '../types';

// 10 named theme bundles for the reel-clone template. Each one applies as a
// styleSpec patch (deep-merged into current state) so non-themed knobs like
// animation timing and position survive a theme swap.
//
// **Variety strategy**: each theme intentionally pairs THREE different fonts
// across the primary / secondary / italic tiers. Real-world graphic design
// constantly mixes typefaces — a magazine layout uses serif headlines with
// mono captions, a concert poster stacks heavy condensed display with
// hand-drawn marker italics. Color may be near-monochromatic on some themes
// (Manifesto, Designer Studio, Architect) and let the type carry the vibe.
//
// Conventions:
// - swatch — 4–5 hex colors used to render the card preview dots, in
//   prominence order (base → primary → secondary → italic).
// - patch.font.family must be a font preloaded in lib/preloadFonts.ts.
// - patch.color.emphasisFill seeds the palette cycle; tier fills override.
// - reel.tiers.byPaletteIndex.0 = "primary emphasis" (every other emphasis word).
// - reel.tiers.byPaletteIndex.1 = "secondary emphasis".
// - reel.tiers.italic = the hash-gated italic accent words.

export const REEL_CLONE_THEMES: Theme[] = [
  {
    id: 'editorial-mix',
    name: 'Editorial Mix',
    description: 'Serif headline + mono caption + italic byline',
    swatch: ['#fdf6e3', '#e8c87a', '#1b2a4e', '#7a8aa8', '#0d1633'],
    displayFont: 'Playfair Display',
    patch: {
      font: { family: 'Playfair Display', weight: 700 },
      color: {
        fill: '#fdf6e3',
        emphasisFill: ['#e8c87a', '#1b2a4e'],
      },
      reel: {
        tiers: {
          byPaletteIndex: {
            '0': {
              fill: '#e8c87a',
              fontFamily: 'Playfair Display',
              fontWeight: 900,
              effect: 'breathe',
            },
            '1': { fill: '#1b2a4e', fontFamily: 'JetBrains Mono', fontWeight: 700 },
          },
          italic: {
            fill: '#7a8aa8',
            fontFamily: 'Cormorant Garamond',
            fontWeight: 400,
          },
        },
      },
    },
  },

  {
    id: 'concert-poster',
    name: 'Concert Poster',
    description: 'Heavy slab + condensed + marker scrawl',
    swatch: ['#ffffff', '#ff1f3d', '#0d0d0d', '#ff4fa3', '#ffe600'],
    displayFont: 'Anton',
    patch: {
      font: { family: 'Anton', weight: 400, textTransform: 'uppercase' },
      color: {
        fill: '#ffffff',
        emphasisFill: ['#ff1f3d', '#0d0d0d'],
      },
      reel: {
        tiers: {
          byPaletteIndex: {
            '0': {
              fill: '#ff1f3d',
              fontFamily: 'Anton',
              fontWeight: 400,
              strokeColor: '#0d0d0d',
              strokeWidth: 2,
              effect: 'magnetic',
            },
            '1': {
              fill: '#0d0d0d',
              fontFamily: 'Bebas Neue',
              fontWeight: 400,
            },
          },
          italic: {
            fill: '#ff4fa3',
            fontFamily: 'Permanent Marker',
            fontWeight: 400,
            effect: 'crystal',
          },
        },
      },
      animation: { scaleFrom: 0.6, durationMs: 90 },
    },
  },

  {
    id: 'designer-studio',
    name: 'Designer Studio',
    description: 'Geometric sans + code mono + soft italic',
    swatch: ['#f5f7fa', '#1a1a1f', '#a8ff00', '#3a3a45', '#ffffff'],
    displayFont: 'DM Sans',
    patch: {
      font: { family: 'DM Sans', weight: 700 },
      color: {
        fill: '#f5f7fa',
        emphasisFill: ['#1a1a1f', '#a8ff00'],
      },
      reel: {
        tiers: {
          byPaletteIndex: {
            '0': { fill: '#1a1a1f', fontFamily: 'DM Sans', fontWeight: 900 },
            '1': { fill: '#a8ff00', fontFamily: 'JetBrains Mono', fontWeight: 700 },
          },
          italic: {
            fill: '#3a3a45',
            fontFamily: 'Outfit',
            fontWeight: 400,
          },
        },
      },
    },
  },

  {
    id: 'boutique-couture',
    name: 'Boutique Couture',
    description: 'Elegant serif + script flourish + classical roman',
    swatch: ['#fff8ee', '#c4a274', '#d8839f', '#7a3b2e', '#3a2418'],
    displayFont: 'Cormorant Garamond',
    patch: {
      font: { family: 'Cormorant Garamond', weight: 700 },
      color: {
        fill: '#fff8ee',
        emphasisFill: ['#c4a274', '#d8839f'],
      },
      reel: {
        tiers: {
          byPaletteIndex: {
            '0': { fill: '#c4a274', fontFamily: 'Cormorant Garamond', fontWeight: 700 },
            '1': { fill: '#d8839f', fontFamily: 'Pacifico', fontWeight: 400 },
          },
          italic: {
            fill: '#7a3b2e',
            fontFamily: 'Cinzel',
            fontWeight: 400,
          },
        },
      },
      animation: { scaleFrom: 0.92, durationMs: 200, tailMs: 280 },
    },
  },

  {
    id: 'manifesto',
    name: 'Manifesto',
    description: 'Brutalist slab + condensed + retro terminal italic',
    swatch: ['#ffffff', '#ff0019', '#0d0d0d', '#ffffff', '#ff0019'],
    displayFont: 'Archivo Black',
    patch: {
      font: { family: 'Archivo Black', weight: 400, textTransform: 'uppercase' },
      color: {
        fill: '#ffffff',
        emphasisFill: ['#ff0019', '#0d0d0d'],
      },
      reel: {
        tiers: {
          byPaletteIndex: {
            '0': {
              fill: '#ff0019',
              fontFamily: 'Archivo Black',
              fontWeight: 400,
              strokeColor: '#0d0d0d',
              strokeWidth: 3,
            },
            '1': {
              fill: '#0d0d0d',
              fontFamily: 'Anton',
              fontWeight: 400,
              strokeColor: '#ffffff',
              strokeWidth: 2,
            },
          },
          italic: {
            fill: '#ff0019',
            fontFamily: 'VT323',
            fontWeight: 400,
          },
        },
      },
      animation: { scaleFrom: 0.7, durationMs: 80 },
    },
  },

  {
    id: 'personal-diary',
    name: 'Personal Diary',
    description: 'Marker pen + cursive script + clean reflective',
    swatch: ['#fff5e8', '#1f3a5f', '#e8748a', '#3a2418', '#ffd9a0'],
    displayFont: 'Permanent Marker',
    patch: {
      font: { family: 'Permanent Marker', weight: 400 },
      color: {
        fill: '#fff5e8',
        emphasisFill: ['#1f3a5f', '#e8748a'],
      },
      reel: {
        tiers: {
          byPaletteIndex: {
            '0': { fill: '#1f3a5f', fontFamily: 'Permanent Marker', fontWeight: 400 },
            '1': { fill: '#e8748a', fontFamily: 'Pacifico', fontWeight: 400 },
          },
          italic: {
            fill: '#3a2418',
            fontFamily: 'Outfit',
            fontWeight: 400,
          },
        },
      },
      animation: { scaleFrom: 0.85, durationMs: 160 },
    },
  },

  {
    id: 'retro-arcade',
    name: 'Retro Arcade',
    description: '8-bit blocks + CRT terminal + clean code italic',
    swatch: ['#0a0a16', '#ffe600', '#00f0ff', '#a8ff00', '#ff00aa'],
    displayFont: 'Press Start 2P',
    patch: {
      font: { family: 'Press Start 2P', weight: 400, textTransform: 'uppercase' },
      color: {
        fill: '#ffffff',
        emphasisFill: ['#ffe600', '#00f0ff'],
      },
      reel: {
        tiers: {
          byPaletteIndex: {
            '0': {
              fill: '#ffe600',
              fontFamily: 'Press Start 2P',
              fontWeight: 400,
              effect: 'crystal',
            },
            '1': {
              fill: '#00f0ff',
              fontFamily: 'VT323',
              fontWeight: 400,
              effect: 'samba',
            },
          },
          italic: {
            fill: '#a8ff00',
            fontFamily: 'JetBrains Mono',
            fontWeight: 400,
          },
        },
      },
      animation: { scaleFrom: 0.5, durationMs: 100 },
    },
  },

  {
    id: 'op-ed',
    name: 'Op-Ed',
    description: 'Newspaper headline + body serif + sans byline',
    swatch: ['#fdf6e3', '#0d0d0d', '#7a1a1a', '#3a3a45', '#c9a05c'],
    displayFont: 'Playfair Display',
    patch: {
      font: { family: 'Playfair Display', weight: 900 },
      color: {
        fill: '#fdf6e3',
        emphasisFill: ['#0d0d0d', '#7a1a1a'],
      },
      reel: {
        tiers: {
          byPaletteIndex: {
            '0': { fill: '#0d0d0d', fontFamily: 'Playfair Display', fontWeight: 900 },
            '1': { fill: '#7a1a1a', fontFamily: 'Cormorant Garamond', fontWeight: 700 },
          },
          italic: {
            fill: '#3a3a45',
            fontFamily: 'DM Sans',
            fontWeight: 400,
          },
        },
      },
    },
  },

  {
    id: 'late-night-neon',
    name: 'Late Night Neon',
    description: 'Vegas marquee + wavy sign + late-night script',
    swatch: ['#0a0220', '#ff00aa', '#00f0ff', '#ffe600', '#ffffff'],
    displayFont: 'Bebas Neue',
    patch: {
      font: { family: 'Bebas Neue', weight: 400, textTransform: 'uppercase' },
      color: {
        fill: '#ffffff',
        emphasisFill: ['#ff00aa', '#00f0ff'],
      },
      reel: {
        tiers: {
          byPaletteIndex: {
            '0': {
              // Hot pink → cyan gradient — neon tube vibe.
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
              fill: '#00f0ff',
              fontFamily: 'Workbench',
              fontWeight: 400,
              variableAxes: { BLED: 40 },
              effect: 'flare',
            },
          },
          italic: {
            fill: '#ffe600',
            fontFamily: 'Pacifico',
            fontWeight: 400,
            effect: 'breathe',
          },
        },
      },
      animation: { scaleFrom: 0.75, durationMs: 130 },
    },
  },

  {
    id: 'architect',
    name: 'Architect',
    description: 'Classical caps + technical mono + clean italic',
    swatch: ['#fdf6e3', '#1b2a4e', '#a8a89c', '#c9a05c', '#0d1633'],
    displayFont: 'Cinzel',
    patch: {
      font: { family: 'Cinzel', weight: 700 },
      color: {
        fill: '#fdf6e3',
        emphasisFill: ['#1b2a4e', '#c9a05c'],
      },
      reel: {
        tiers: {
          byPaletteIndex: {
            '0': { fill: '#1b2a4e', fontFamily: 'Cinzel', fontWeight: 900 },
            '1': { fill: '#c9a05c', fontFamily: 'JetBrains Mono', fontWeight: 700 },
          },
          italic: {
            fill: '#a8a89c',
            fontFamily: 'Outfit',
            fontWeight: 400,
          },
        },
      },
      animation: { scaleFrom: 0.95, durationMs: 180, tailMs: 240 },
    },
  },
];
