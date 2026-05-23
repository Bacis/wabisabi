// Word-level caption effects. Each effect is one row in the CSS file
// (animations.css) implementing the named keyframes + a `.we-<id>` selector.
//
// To add a new effect:
//   1. Append a WordFxSpec entry below.
//   2. Add a matching `.caption .w.we-<id>` rule + @keyframes in animations.css.
//   3. The randomizer + inspector pick it up automatically.
//
// `we-wobble` is deliberately not in the body-pool randomizer choices (its
// infinite step animation destroys readability across ~10 simultaneous words)
// but it's still available as a scene-baked fx and listed for completeness.
// Ported from ae-packs-player.html (CAPTION_FX + FX_SPECS + FX_DESCRIPTIONS).

export type WordFxId =
  | 'we-word'
  | 'we-stair'
  | 'we-varied'
  | 'we-color'
  | 'we-wobble'
  // GSAP-vocabulary batch (CSS only — no GSAP runtime dep).
  | 'we-edges'
  | 'we-center'
  | 'we-typewriter'
  | 'we-elastic'
  | 'we-bounce'
  | 'we-expo'
  | 'we-wipe'
  | 'we-curtain'
  | 'we-rgb-split'
  | 'we-glitch'
  | 'we-neon-pulse'
  | 'we-wave'
  | 'we-jelly';

export type WordFxSpec = {
  id: WordFxId;
  label: string;
  description: string;
  // CSS values mirrored from animations.css so the JSON preset can self-describe.
  duration: string;
  easing: string;
  scope: 'word' | 'letter';
  keyframes: string;
  // Whether this effect requires splitting the word into per-letter spans.
  splitsLetters: boolean;
  // Whether the randomizer is allowed to pick this for the body pool.
  randomizable: boolean;
  // 'subtle' effects read as the block's baseline motion (used for all
  // non-emphasis body words). 'intense' effects are loud/showy and only used
  // on emphasis (italic) words so the block stays calm and the emphasis
  // visibly punches through.
  intensity: 'subtle' | 'intense';
};

export const WORD_FX: readonly WordFxSpec[] = [
  {
    id: 'we-word',
    label: 'Plain',
    description: 'word fades + scales in (no letter split)',
    duration: '0.4s',
    easing: 'cubic-bezier(.5,1.2,.3,1)',
    scope: 'word',
    keyframes: 'capWord',
    splitsLetters: false,
    randomizable: true,
    intensity: 'subtle',
  },
  {
    id: 'we-stair',
    label: 'Staircase',
    description:
      'letters drop from below (translateY .6em→0) with blur fade (6px→0)',
    duration: '0.55s',
    easing: 'cubic-bezier(.16,1.2,.3,1)',
    scope: 'letter',
    keyframes: 'capStair',
    splitsLetters: true,
    randomizable: true,
    intensity: 'subtle',
  },
  {
    id: 'we-varied',
    label: 'Varied',
    description:
      'letters cycle through 4 variants by index mod 4 — drop / blur-only / flip-X / slide-X',
    duration: '0.7s',
    easing: 'cubic-bezier(.16,1,.3,1)',
    scope: 'letter',
    keyframes: 'capVDrop / capVBlur / capVFlip / capVSlide',
    splitsLetters: true,
    randomizable: true,
    intensity: 'intense',
  },
  {
    id: 'we-color',
    label: 'Color flash',
    description:
      'letters fade in with a brief color flash from accent → final color',
    duration: '1.15s',
    easing: 'cubic-bezier(.5,0,.2,1)',
    scope: 'letter',
    keyframes: 'capColor',
    splitsLetters: true,
    randomizable: true,
    intensity: 'intense',
  },
  {
    id: 'we-wobble',
    label: 'Wobble',
    description:
      'frame-stepped entrance + infinite stepped wobble loop (indie-doc feel)',
    duration: '0.35s + infinite',
    easing: 'steps(3,end) / steps(4,end)',
    scope: 'letter',
    keyframes: 'capWobIn / capWobLoop',
    splitsLetters: true,
    randomizable: false,
    intensity: 'intense',
  },

  // ----- GSAP-vocabulary batch -----

  {
    id: 'we-edges',
    label: 'Edges In',
    description:
      'letters spring in from both word edges toward center on back.out',
    duration: '0.55s',
    easing: 'cubic-bezier(.34,1.56,.64,1)',
    scope: 'letter',
    keyframes: 'capEdges',
    splitsLetters: true,
    randomizable: true,
    intensity: 'subtle',
  },
  {
    id: 'we-center',
    label: 'Center Out',
    description: 'letters fan out from the middle character toward both edges',
    duration: '0.55s',
    easing: 'cubic-bezier(.34,1.56,.64,1)',
    scope: 'letter',
    keyframes: 'capCenter',
    splitsLetters: true,
    randomizable: true,
    intensity: 'intense',
  },
  {
    id: 'we-typewriter',
    label: 'Typewriter',
    description: 'left-to-right per-letter binary reveal (steps timing, no caret)',
    duration: '0.001s × N',
    easing: 'steps(1,end)',
    scope: 'letter',
    keyframes: 'capType',
    splitsLetters: true,
    randomizable: false,
    intensity: 'subtle',
  },
  {
    id: 'we-elastic',
    label: 'Elastic',
    description:
      'elastic.out(1,.3) — multi-bounce Y settle, two damped oscillations',
    duration: '0.9s',
    easing: 'cubic-bezier(.5,0,.5,1)',
    scope: 'letter',
    keyframes: 'capElastic',
    splitsLetters: true,
    randomizable: true,
    intensity: 'intense',
  },
  {
    id: 'we-bounce',
    label: 'Bounce',
    description: 'bounce.out — floor-drop with three decreasing peaks',
    duration: '0.85s',
    easing: 'cubic-bezier(.3,0,.7,.3)',
    scope: 'letter',
    keyframes: 'capBounce',
    splitsLetters: true,
    randomizable: true,
    intensity: 'intense',
  },
  {
    id: 'we-expo',
    label: 'Expo Glide',
    description: 'expo.out — long deceleration slide-up from below (word-scope)',
    duration: '0.9s',
    easing: 'cubic-bezier(.16,1,.3,1)',
    scope: 'word',
    keyframes: 'capExpo',
    splitsLetters: false,
    randomizable: true,
    intensity: 'subtle',
  },
  {
    id: 'we-wipe',
    label: 'Wipe',
    description: 'DrawSVG-style clip-path inset opens L→R per letter',
    duration: '0.45s',
    easing: 'cubic-bezier(.65,0,.35,1)',
    scope: 'letter',
    keyframes: 'capWipe',
    splitsLetters: true,
    randomizable: true,
    intensity: 'subtle',
  },
  {
    id: 'we-curtain',
    label: 'Curtain',
    description:
      'letters fall from above with a top-clip mask peeling open + landing squash',
    duration: '0.7s',
    easing: 'cubic-bezier(.45,0,.2,1.2)',
    scope: 'letter',
    keyframes: 'capCurtain',
    splitsLetters: true,
    randomizable: false,
    intensity: 'intense',
  },
  {
    id: 'we-rgb-split',
    label: 'RGB Split',
    description:
      'chromatic aberration — cyan/magenta text-shadows converge to 0 with jitter',
    duration: '0.65s',
    easing: 'cubic-bezier(.16,1,.3,1)',
    scope: 'letter',
    keyframes: 'capRgbSplit',
    splitsLetters: true,
    randomizable: true,
    intensity: 'intense',
  },
  {
    id: 'we-glitch',
    label: 'Glitch',
    description:
      'RoughEase — 8-step jitter on translate, mod-4 per-letter offset vectors',
    duration: '0.5s',
    easing: 'steps(8,end)',
    scope: 'letter',
    keyframes: 'capGlitch',
    splitsLetters: true,
    randomizable: false,
    intensity: 'intense',
  },
  {
    id: 'we-neon-pulse',
    label: 'Neon Pulse',
    description:
      'text-shadow glow flash using --color01, decays to steady soft halo (word-scope)',
    duration: '0.9s',
    easing: 'cubic-bezier(.4,0,.2,1)',
    scope: 'word',
    keyframes: 'capNeon',
    splitsLetters: false,
    randomizable: false,
    intensity: 'intense',
  },
  {
    id: 'we-wave',
    label: 'Wave',
    description:
      'per-letter entrance + infinite low-amplitude sine bob (--j drives phase)',
    duration: '0.5s + infinite',
    easing: 'cubic-bezier(.16,1,.3,1) / ease-in-out',
    scope: 'letter',
    keyframes: 'capWaveIn / capWave',
    splitsLetters: true,
    randomizable: false,
    intensity: 'intense',
  },
  {
    id: 'we-jelly',
    label: 'Jelly',
    description:
      'Physics2D punch — anisotropic scaleX/scaleY phase-shift squash-stretch',
    duration: '0.75s',
    easing: 'cubic-bezier(.34,1.56,.64,1)',
    scope: 'letter',
    keyframes: 'capJelly',
    splitsLetters: true,
    randomizable: true,
    intensity: 'intense',
  },
];

// Pre-filtered helper pools.
export const SUBTLE_FX = WORD_FX.filter((f) => f.intensity === 'subtle');
export const INTENSE_FX = WORD_FX.filter((f) => f.intensity === 'intense');

export function randomSubtleFx(): WordFxSpec {
  // Prefer randomizable ones for body fx; fall back to all subtle if none.
  const pool = SUBTLE_FX.filter((f) => f.randomizable);
  const src = pool.length > 0 ? pool : SUBTLE_FX;
  return src[Math.floor(Math.random() * src.length)];
}

export function randomIntenseFx(): WordFxSpec {
  const pool = INTENSE_FX.filter((f) => f.randomizable);
  const src = pool.length > 0 ? pool : INTENSE_FX;
  return src[Math.floor(Math.random() * src.length)];
}

export const RANDOMIZABLE_FX = WORD_FX.filter((f) => f.randomizable);

export const FX_BY_ID: Record<WordFxId, WordFxSpec> = Object.fromEntries(
  WORD_FX.map((f) => [f.id, f]),
) as Record<WordFxId, WordFxSpec>;

// Per-letter cascade within a word — matches the --letter-step CSS variable.
export const LETTER_STEP_MS = 28;

// Probability the PUNCH word gets a continuous sway (rare — 20% per roll).
export const PUNCH_WOBBLE_PROB = 0.2;
