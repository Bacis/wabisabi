// Serialize a LabRoll (+ wordOverrides) into the JSON preset format
// emitted by ae-packs-player.html. The shape is preserved so a roll exported
// from the lab can be pasted into the HTML's LOAD modal and vice-versa.

import type { LabRoll, AccentSlot } from './randomizer';
import { FONT_IMPORTS } from '../data/fonts';
import { THEMES } from '../data/themes';
import { SCENES } from '../data/scenes';
import { WORD_FX, FX_BY_ID } from '../data/effects';
import type { WordFxId } from '../data/effects';
import { MIN_CONTRAST, hexToHsl } from './contrast';

// Free-form per-word transform applied via the standalone CSS `translate`,
// `rotate`, `scale` properties (NOT `transform`) so it composes with the
// keyframe animations in animations.css instead of clobbering them.
export type WordTransform = { x: number; y: number; rot: number; scale: number };

// Block-level positioning applied to the inner `.caption` flex container.
// Anchor controls vertical placement inside the stage; align controls
// horizontal text alignment of the wrapped word flow.
export type BlockTransform = {
  x: number;
  y: number;
  align: 'left' | 'center' | 'right';
  anchor: 'top' | 'middle' | 'bottom';
};

export const DEFAULT_BLOCK_TRANSFORM: BlockTransform = {
  x: 0,
  y: 0,
  align: 'center',
  anchor: 'middle',
};

export type WordOverride = {
  colorSlot?: AccentSlot;
  italic?: boolean;
  spacing?: number;
  transform?: WordTransform;
  customColor?: string; // hex, takes precedence over colorSlot / role color
  fxOverride?: WordFxId;
};

export type WordOverrides = Record<number, WordOverride>;

export function exportPreset(
  roll: LabRoll,
  overrides: WordOverrides,
  blockTransform: BlockTransform = DEFAULT_BLOCK_TRANSFORM,
): unknown {
  const { theme, scene, bodyFx, emphasisFx, fontSans, fontSerif, accents } = roll;
  const wordCount = roll.words.length;
  const wordStepSec = roll.wordStepSec;
  const fxDurSec = parseFloat(bodyFx.duration);
  const bodyEntranceEnd = (
    (wordCount - 1) * wordStepSec +
    (Number.isFinite(fxDurSec) ? fxDurSec : 0)
  ).toFixed(2);
  const punchEntranceStart = (scene.punch * wordStepSec).toFixed(2);
  const punchEntranceEnd = (scene.punch * wordStepSec + 0.55).toFixed(2);

  const hslStr = (hex: string) => {
    const [h, s, l] = hexToHsl(hex);
    return `hsl(${Math.round(h)}, ${Math.round(s)}%, ${Math.round(l)}%)`;
  };

  return {
    spec: {
      version: '1.0',
      generator: 'Wabisabi Caption Lab',
      timestamp: new Date().toISOString(),
    },
    sources: {
      scene: 'Captions Pack — 10 caption templates decoded from .aep files',
      themePalettes:
        'Playground ✦ Color Swatches by Al Fath Akbar / Lunative Studio (Figma)',
      fonts: 'Google Fonts (sans pool + italic serif pool)',
    },
    scene: {
      id: scene.id,
      name: scene.name,
      text: scene.text,
      duration: `${scene.dur}s`,
      wordCount,
      punch: {
        index: scene.punch,
        word: (scene.text.split(/\s+/)[scene.punch] || '').toUpperCase(),
      },
    },
    stage: {
      viewport: '920×580',
      mode: 'desktop',
      containerType: 'inline-size',
      padding: '6% 4%',
      alignment: 'horizontal center, vertical center',
      block: blockTransform,
    },
    palette: {
      theme: theme.name,
      bg: theme.bg,
      ink: theme.ink,
      threshold: `${MIN_CONTRAST}:1 (WCAG AA Normal)`,
      hierarchy: {
        base: roll.basePool.map((a) => ({ color: a.hex, fromAccent: a.key })),
        emphasis: roll.emphasisPool.map((a) => ({
          color: a.hex,
          fromAccent: a.key,
        })),
        punch: {
          color: roll.punchAccent ? roll.punchAccent.hex : theme.ink,
          fromAccent: roll.punchAccent ? roll.punchAccent.key : 'ink',
          rule: 'most intense accent in emphasisPool (or basePool fallback)',
        },
        split:
          'lighter half = base (sans, common); intense half = emphasis (italic, rare); 70/30 between pools per word',
      },
      accents: accents.map((a) => ({
        key: a.key,
        roles: a.roleTags,
        original: {
          hex: a.originalHex,
          hsl: hslStr(a.originalHex),
          contrastVsBg: a.originalContrast.toFixed(2) + ':1',
          passes: a.originalContrast >= MIN_CONTRAST,
        },
        used: {
          hex: a.hex,
          hsl: hslStr(a.hex),
          contrastVsBg: a.contrast.toFixed(2) + ':1',
          passes: a.contrast >= MIN_CONTRAST,
        },
        adjusted: a.adjusted,
      })),
      accentsPass: `${accents.filter((a) => a.passes).length}/4`,
    },
    typography: {
      fonts: {
        sans: {
          family: fontSans[1],
          weight: 800,
          import: FONT_IMPORTS[fontSans[1]] || null,
          stack: fontSans[0],
        },
        serif: {
          family: fontSerif[1],
          weight: 700,
          style: 'italic',
          import: FONT_IMPORTS[fontSerif[1]] || null,
          stack: fontSerif[0],
        },
      },
    },
    motion: {
      timing: {
        letterStep: '28ms',
        wordStep: wordStepSec.toFixed(3) + 's',
        wordStepFormula: '(scene.duration × 0.75) / wordCount',
        bodyEntranceEnd: bodyEntranceEnd + 's',
        punchEntranceStart: punchEntranceStart + 's',
        punchEntranceEnd: punchEntranceEnd + 's',
      },
      body: {
        fx: bodyFx.id,
        keyframes: bodyFx.keyframes,
        description: bodyFx.description,
        duration: bodyFx.duration,
        easing: bodyFx.easing,
        scope: bodyFx.scope,
        intensity: bodyFx.intensity,
      },
      emphasis: {
        fx: emphasisFx.id,
        keyframes: emphasisFx.keyframes,
        description: emphasisFx.description,
        duration: emphasisFx.duration,
        easing: emphasisFx.easing,
        scope: emphasisFx.scope,
        intensity: emphasisFx.intensity,
      },
      punch: {
        entrance: {
          keyframes: 'capPunch',
          description:
            'scale-pop entrance: scale(.6) blur(8px) opacity 0 → scale(1.04) → scale(1) blur(0) opacity 1',
          duration: '0.55s',
          easing: 'cubic-bezier(.16,1.5,.3,1)',
          delay: `${punchEntranceStart}s (= punch.index × wordStep)`,
        },
        wobble: roll.punchWobble
          ? {
              active: true,
              keyframes: 'punchSway',
              description: 'gentle continuous sway (±1° / 2.4s ease-in-out)',
              startsAt: punchEntranceEnd + 's',
            }
          : { active: false },
      },
    },
    render: {
      wordBreakdown: roll.words.map((w) =>
        w.kind === 'punch'
          ? {
              index: w.index,
              word: w.word,
              role: 'punch',
              font: fontSans[1],
              color: w.colorHex,
              accentSlot: w.accentSlot,
              italic: false,
              isPunch: true,
              wobble: w.wobble,
            }
          : {
              index: w.index,
              word: w.word,
              role: w.italic ? 'emphasis' : 'base',
              font: w.italic ? fontSerif[1] : fontSans[1],
              color: w.colorHex,
              accentSlot: w.accentSlot,
              italic: w.italic,
              isPunch: false,
              wobble: false,
            },
      ),
      wordOverrides:
        Object.keys(overrides).length > 0 ? overrides : undefined,
    },
    rng: {
      baseProb: 0.7,
      pools: {
        themes: THEMES.length,
        captionScenes: SCENES.length,
        bodyFx: WORD_FX.filter((f) => f.randomizable).length,
      },
      minContrast: MIN_CONTRAST,
    },
  };
}

// Quick lookup so the JSON copy/paste flow can ask "is this fx in our pool?"
export function isKnownFx(id: string): boolean {
  return id in FX_BY_ID;
}
