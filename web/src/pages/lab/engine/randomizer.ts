// Caption-lab randomizer. Given an optional preset, produces a complete
// LabRoll — theme, scene, fx, contrast-filtered accents, per-word role
// assignments. Pure function; no DOM mutation. The renderer reads LabRoll
// and writes CSS variables / class names accordingly.
//
// Ported from ae-packs-player.html randomize() (line 2162) + mount()'s
// per-word role decision (line 1711). The per-word RNG runs HERE (not in the
// component) so the roll is a single deterministic snapshot.

import type { LabTheme } from '../data/themes';
import { THEMES } from '../data/themes';
import type { LabScene } from '../data/scenes';
import { SCENES } from '../data/scenes';
import type { WordFxSpec, WordFxId } from '../data/effects';
import {
  FX_BY_ID,
  PUNCH_WOBBLE_PROB,
  randomIntenseFx,
  randomSubtleFx,
} from '../data/effects';
import { PAIRING_BY_ID, randomPairing } from '../data/fonts';
import type { FontPairing } from '../data/fonts';
import {
  MIN_CONTRAST,
  ensurePassing,
  hexToHsl,
  hslToHex,
  relLum,
  wcagContrast,
} from './contrast';

export type AccentSlot = 'c1' | 'c2' | 'c3' | 'c4';
export type AccentMeta = {
  key: AccentSlot;
  // Original theme-defined hex (before any contrast brightening).
  originalHex: string;
  // Used hex (after potential contrast brightening).
  hex: string;
  cssVar: string;
  // Both roles this accent owns: [sans-role, italic-role].
  roles: [string, string];
  originalContrast: number;
  contrast: number;
  passes: boolean;
  adjusted: boolean;
  // Role tags for the JSON spec: which logical roles this accent fills.
  roleTags: ReadonlyArray<'base' | 'emphasis' | 'punch' | 'available' | 'unused'>;
};

export type WordPlan =
  | {
      kind: 'punch';
      index: number;
      word: string;
      colorHex: string | null;
      accentSlot: AccentSlot | null;
      wobble: boolean;
    }
  | {
      kind: 'body';
      index: number;
      word: string;
      role: string; // r1..r8 OR r-ink-sans / r-ink-serif
      italic: boolean;
      colorHex: string | null;
      accentSlot: AccentSlot | null;
      // The fx applied to this word — captured here so re-renders are
      // deterministic without re-rolling the per-word RNG.
      fx: WordFxId;
    };

export type LabRoll = {
  theme: LabTheme;
  scene: LabScene;
  // The block-wide FX applied to non-emphasis body words — always a subtle
  // effect so the whole caption reads calm.
  bodyFx: WordFxSpec;
  // The intense FX reserved for emphasis (italic) body words so they punch
  // through the calm block baseline.
  emphasisFx: WordFxSpec;
  // The font pair driving --cap-sans / --cap-serif. Derived shortcuts kept
  // for convenience so existing consumers don't need to dereference pairing.
  pairing: FontPairing;
  fontSans: readonly [string, string]; // [stack, family]
  fontSerif: readonly [string, string];
  // Per-accent metadata (4 entries, always c1..c4 in order).
  accents: AccentMeta[];
  // Lighter half of the passing accents — drive the common sans body words.
  basePool: AccentMeta[];
  // More intense half — drive the rarer italic-serif emphasis words.
  emphasisPool: AccentMeta[];
  // The accent the PUNCH word uses (pulled from emphasisPool when possible).
  punchAccent: AccentMeta | null;
  punchWobble: boolean;
  // The per-word render decisions — already RNG'd, replays identically.
  words: WordPlan[];
  // Step duration between words, seconds. (scene.dur * 0.75) / wordCount.
  wordStepSec: number;
  // Body emphasis split, fixed at 70/30 to mirror the source.
  baseProb: number;
};

export type RollPreset = {
  themeId?: string;
  sceneId?: string;
  // Subtle FX for the block / non-emphasis body words.
  fxId?: WordFxId;
  // Intense FX for emphasis (italic) words.
  emphasisFxId?: WordFxId;
  pairingId?: string;
  punchWobble?: boolean;
};

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Transform a rolled words array so a different index becomes the PUNCH.
// Non-destructive: the original WordPlan[] is returned unchanged if the
// override matches the natural punch. Promotion keeps the body word's
// rolled accent/color so the new punch inherits the same palette role.
// Demotion synthesizes a sensible sans body role based on the old punch's
// accent slot — the user's WordOverrides (keyed by index) still apply.
export function applyPunchOverride(
  words: readonly WordPlan[],
  punchIdx: number,
  bodyFxId: WordFxId,
): WordPlan[] {
  return words.map((w, i) => {
    if (i === punchIdx) {
      if (w.kind === 'punch') return w;
      return {
        kind: 'punch',
        index: i,
        word: w.word,
        colorHex: w.colorHex,
        accentSlot: w.accentSlot,
        wobble: false,
      };
    }
    if (w.kind === 'punch') {
      // Demote — synthesize a body role from the punch's accent slot. Sans
      // (non-italic) role: c1→r1, c2→r3, c3→r5, c4→r7.
      const slotIdx = w.accentSlot
        ? parseInt(w.accentSlot.slice(1), 10) - 1
        : null;
      const role = slotIdx === null ? 'r-ink-sans' : `r${slotIdx * 2 + 1}`;
      return {
        kind: 'body',
        index: i,
        word: w.word,
        role,
        italic: false,
        colorHex: w.colorHex,
        accentSlot: w.accentSlot,
        fx: bodyFxId,
      };
    }
    return w;
  });
}

function shuffled<T>(arr: readonly T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Build the BASE / EMPHASIS color hierarchy across all four accents. We want
// *all* passing accents in the mix; the lighter half drives the common body
// (sans), the more intense half drives the rarer emphasis (italic serif).
// If an accent fails the contrast threshold, we brighten it — if it still
// can't reach the threshold it's tagged 'unused' and skipped.
function buildAccentHierarchy(theme: LabTheme): {
  accents: AccentMeta[];
  basePool: AccentMeta[];
  emphasisPool: AccentMeta[];
  punch: AccentMeta | null;
} {
  const seed: AccentMeta[] = (
    [
      { key: 'c1', cssVar: '--color01', roles: ['r1', 'r2'] as [string, string] },
      { key: 'c2', cssVar: '--color02', roles: ['r3', 'r4'] as [string, string] },
      { key: 'c3', cssVar: '--color03', roles: ['r5', 'r6'] as [string, string] },
      { key: 'c4', cssVar: '--color04', roles: ['r7', 'r8'] as [string, string] },
    ] as const
  ).map((a) => {
    const originalHex = theme[a.key];
    const contrast = wcagContrast(theme.bg, originalHex);
    return {
      key: a.key as AccentSlot,
      originalHex,
      hex: originalHex,
      cssVar: a.cssVar,
      roles: a.roles,
      originalContrast: contrast,
      contrast,
      passes: contrast >= MIN_CONTRAST,
      adjusted: false,
      roleTags: [] as AccentMeta['roleTags'],
    };
  });

  // Brighten any accent that doesn't reach the contrast threshold.
  // ensurePassing walks the L axis; if it can't reach MIN_CONTRAST (e.g.,
  // a mid-luminance green against a near-black bg, where L=95 still doesn't
  // hit 4.5:1) we fall back to an L-extreme + desaturated variant so the
  // accent is at least legible enough to participate in the roll. The user
  // explicitly asked for the theme's full palette in every roll — palette
  // fidelity wins over strict WCAG when forced to choose.
  const bgDark = relLum(theme.bg) < 0.5;
  for (const a of seed) {
    if (a.passes) continue;
    const adjusted = ensurePassing(a.originalHex, theme.bg, MIN_CONTRAST);
    if (adjusted) {
      a.hex = adjusted;
      a.contrast = wcagContrast(theme.bg, adjusted);
      a.adjusted = true;
      a.passes = true;
    } else {
      const [h, s] = hexToHsl(a.originalHex);
      const lifted = hslToHex(h, Math.max(35, s - 25), bgDark ? 90 : 10);
      a.hex = lifted;
      a.contrast = wcagContrast(theme.bg, lifted);
      a.adjusted = true;
      // a.passes stays false (for export/debug) but the accent still lands
      // in a pool below.
    }
  }

  // Every accent participates regardless of pass/fail. Sort by relative
  // luminance descending (lightest first); ceil() biases the split toward
  // base so the lighter colors are the common ones.
  const sorted = [...seed].sort((a, b) => relLum(b.hex) - relLum(a.hex));
  const half = Math.ceil(sorted.length / 2);
  const basePool = sorted.slice(0, half);
  const emphasisPool = sorted.slice(half);

  // PUNCH = single most intense accent (last entry after sort), with
  // emphasisPool → basePool fallback so the slot is always populated.
  let punch: AccentMeta | null = null;
  if (emphasisPool.length > 0) {
    punch = emphasisPool[emphasisPool.length - 1];
  } else if (basePool.length > 0) {
    punch = basePool[basePool.length - 1];
  }

  for (const a of seed) {
    const tags: AccentMeta['roleTags'][number][] = [];
    if (basePool.some((b) => b.key === a.key)) tags.push('base');
    if (emphasisPool.some((e) => e.key === a.key)) tags.push('emphasis');
    if (punch && a.key === punch.key) tags.push('punch');
    if (tags.length === 0) tags.push('available');
    a.roleTags = tags;
  }

  return { accents: seed, basePool, emphasisPool, punch };
}

// Per-word role decision. PUNCH is carved out at the scene's punch index.
// Each remaining word lands in one of two pools:
//   • basePool (lighter accents) → sans role + bodyFx (subtle), common.
//   • emphasisPool (intense accents) → italic serif role + emphasisFx
//     (intense), rarer.
// Within a pool we cycle through a shuffled copy of it (stratified pick) so
// every member surfaces at least once when there are enough words.
function planWords(
  scene: LabScene,
  bodyFx: WordFxSpec,
  emphasisFx: WordFxSpec,
  basePool: AccentMeta[],
  emphasisPool: AccentMeta[],
  punch: AccentMeta | null,
  punchWobble: boolean,
  baseProb: number,
): WordPlan[] {
  const words = scene.text.split(/\s+/);
  const nonPunchIndices: number[] = [];
  for (let i = 0; i < words.length; i++) {
    if (i !== scene.punch) nonPunchIndices.push(i);
  }

  // Decide which non-punch indices use emphasis. Force at least one
  // emphasis slot whenever the pool has members AND there's room — without
  // this, a roll that lands all body words on base would only show the punch
  // from emphasisPool, leaving the *other* emphasis accent unused.
  const shuffledNonPunch = shuffled(nonPunchIndices);
  const isEmph: boolean[] = new Array(words.length).fill(false);
  let emphCount = 0;
  const canEmph = emphasisPool.length > 0 && basePool.length > 0;
  if (canEmph) {
    for (const idx of shuffledNonPunch) {
      if (Math.random() >= baseProb) {
        isEmph[idx] = true;
        emphCount++;
      }
    }
    if (emphCount === 0 && shuffledNonPunch.length > 0) {
      isEmph[shuffledNonPunch[0]] = true;
    }
  }

  // Shuffle each pool for per-roll variety, then ensure the first emphasis
  // assignment isn't the same accent as PUNCH. When there's only one body
  // emphasis word, this guarantees both emphasis colors appear (one body,
  // one punch) — uniform random would collide ~50% of the time.
  const baseSeq = shuffled(basePool);
  const emphSeq = shuffled(emphasisPool);
  if (punch && emphSeq.length > 1 && emphSeq[0].key === punch.key) {
    [emphSeq[0], emphSeq[1]] = [emphSeq[1], emphSeq[0]];
  }
  let baseCursor = 0;
  let emphCursor = 0;

  return words.map((w, i) => {
    if (i === scene.punch) {
      return {
        kind: 'punch',
        index: i,
        word: w,
        colorHex: punch ? punch.hex : null,
        accentSlot: punch ? punch.key : null,
        wobble: punchWobble,
      };
    }
    const useEmphasis = isEmph[i];
    const seq = useEmphasis ? emphSeq : baseSeq;
    if (seq.length === 0) {
      // Both pools empty (shouldn't happen — every accent now participates
      // via best-effort brightening) — render in ink.
      return {
        kind: 'body',
        index: i,
        word: w,
        role: 'r-ink-sans',
        italic: false,
        colorHex: null,
        accentSlot: null,
        fx: bodyFx.id,
      };
    }
    const chosen = useEmphasis
      ? emphSeq[emphCursor++ % emphSeq.length]
      : baseSeq[baseCursor++ % baseSeq.length];
    return {
      kind: 'body',
      index: i,
      word: w,
      role: useEmphasis ? chosen.roles[1] /* italic serif */ : chosen.roles[0] /* sans */,
      italic: useEmphasis,
      colorHex: chosen.hex,
      accentSlot: chosen.key,
      fx: useEmphasis ? emphasisFx.id : bodyFx.id,
    };
  });
}

export function roll(preset: RollPreset = {}): LabRoll {
  // 1. Theme
  const themeIdx = preset.themeId
    ? Math.max(
        0,
        THEMES.findIndex((t) => t.id === preset.themeId),
      )
    : Math.floor(Math.random() * THEMES.length);
  const theme = THEMES[themeIdx === -1 ? 0 : themeIdx];

  // 2. Scene
  const sceneIdx = preset.sceneId
    ? Math.max(
        0,
        SCENES.findIndex((s) => s.id === preset.sceneId),
      )
    : Math.floor(Math.random() * SCENES.length);
  const scene = SCENES[sceneIdx === -1 ? 0 : sceneIdx];

  // 3. FX — body uses a SUBTLE effect (covers the whole block calmly),
  //    emphasis (italic) words use an INTENSE effect (punches through).
  //    Presets can pin either; the scene's baked-in fx — if any — overrides
  //    the body random pick to preserve the scene's intended baseline.
  let bodyFx: WordFxSpec;
  if (preset.fxId) {
    bodyFx = FX_BY_ID[preset.fxId] ?? randomSubtleFx();
  } else if (scene.fx) {
    bodyFx = FX_BY_ID[scene.fx] ?? randomSubtleFx();
  } else {
    bodyFx = randomSubtleFx();
  }
  const emphasisFx = preset.emphasisFxId
    ? (FX_BY_ID[preset.emphasisFxId] ?? randomIntenseFx())
    : randomIntenseFx();

  // 4. Font pairing — curated sans + serif combo, treated as a single unit.
  const pairing = preset.pairingId
    ? (PAIRING_BY_ID[preset.pairingId] ?? randomPairing())
    : randomPairing();
  const fontSans = pairing.sans;
  const fontSerif = pairing.serif;

  // 5. Accent hierarchy with contrast filtering / brightening
  const { accents, basePool, emphasisPool, punch } =
    buildAccentHierarchy(theme);

  // 6. Punch wobble (20% per roll unless preset locks it)
  const punchWobble =
    preset.punchWobble !== undefined
      ? !!preset.punchWobble
      : Math.random() < PUNCH_WOBBLE_PROB;

  // 7. Per-word role assignment (RNG runs here, fixed for this roll)
  const baseProb = 0.7;
  const words = planWords(
    scene,
    bodyFx,
    emphasisFx,
    basePool,
    emphasisPool,
    punch,
    punchWobble,
    baseProb,
  );

  const wordCount = scene.text.split(/\s+/).length;
  const wordStepSec = (scene.dur * 0.75) / Math.max(1, wordCount);

  return {
    theme,
    scene,
    bodyFx,
    emphasisFx,
    pairing,
    fontSans,
    fontSerif,
    accents,
    basePool,
    emphasisPool,
    punchAccent: punch,
    punchWobble,
    words,
    wordStepSec,
    baseProb,
  };
}
