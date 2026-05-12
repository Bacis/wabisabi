// Compact spec-digest helpers for the agent's user turn.
//
// Replaces the previous `AUTHORITATIVE current styleSpec: ${JSON.stringify(...)}`
// dump (1-3K tokens of mostly-default noise) with two small artifacts the
// model can actually reason over:
//
//   1. summarizeSpec(spec) — a one-line "Currently: ..." state line. Detects
//      named archetypes (e.g. "hormozi-cascade") by checking if the spec
//      contains every leaf of a slot recipe, then falls back to listing the
//      active slots one by one. The strings here mirror the # Archetypes
//      section in agentChat.ts's SYSTEM_PROMPT — both must move together.
//
//   2. diffFromDefaults(spec, templateId) — flat dotted-path object of fields
//      that differ from the template's canonical default (reel-clone-default
//      for reel-clone; classic for pop-words). Caps at 30 paths so a wild
//      spec still produces a bounded payload.
//
// The functions are pure — easy to unit-test and safe to call from any
// request path without side effects.
//
// Detection cost: per turn, walks PRESET_PACKS once (~12 presets × small
// depth). Negligible vs the model call.
//
// Why "compose detection" beats raw JSON in the user turn:
//   - Token budget: typical override count is <10; output stays <300 chars
//     where the raw spec was 1-3K.
//   - Shared vocabulary: when the agent reads "Currently: hormozi-cascade"
//     and applied that archetype itself last turn, it knows what's there.
//   - Reasoning: the model decides whether to mutate or replace by reading
//     the diff, not by diffing 60 fields against its own training prior.

import type { StylepackPartial } from '../shared/pipeline/compose.js';
import { PRESET_PACKS } from '../shared/pipeline/packs/index.js';
import { PRESETS } from '../shared/presets.js';

const MAX_DIFF_PATHS = 30;

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const deepEqual = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => deepEqual(x, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((k) => deepEqual(a[k], b[k]));
  }
  return false;
};

// "spec is a superset of preset" — every leaf the preset declares must equal
// the corresponding leaf in spec. Missing branches in spec mean the preset
// is NOT active (the user has reset some of its fields).
const specContainsPreset = (preset: unknown, spec: unknown): boolean => {
  if (Array.isArray(preset)) return deepEqual(preset, spec);
  if (!isPlainObject(preset)) return preset === spec;
  if (!isPlainObject(spec)) return false;
  for (const [k, v] of Object.entries(preset)) {
    if (!specContainsPreset(v, spec[k])) return false;
  }
  return true;
};

// Named archetypes — mirror the # Archetypes section in agentChat.ts. Each
// entry lists the slot recipe that, when fully matched in the spec, names
// the archetype. Order = match priority; more specific recipes (longer slot
// lists) checked first.
const ARCHETYPE_RECIPES: ReadonlyArray<{
  name: string;
  slots: ReadonlyArray<{ slot: keyof typeof PRESET_PACKS; presetId: string }>;
}> = [
  {
    name: 'hormozi-cascade',
    slots: [
      { slot: 'theme', presetId: 'cinematicCascade' },
      { slot: 'font', presetId: 'interBlack' },
      { slot: 'palette', presetId: 'yellowRed' },
      { slot: 'motion', presetId: 'progressiveReveal' },
    ],
  },
  {
    name: 'mr-beast-pop',
    slots: [
      { slot: 'theme', presetId: 'popMinimal' },
      { slot: 'font', presetId: 'impactBold' },
      { slot: 'palette', presetId: 'whiteOnly' },
      { slot: 'motion', presetId: 'snappyPop' },
    ],
  },
  {
    name: 'submagic-pop',
    slots: [
      { slot: 'theme', presetId: 'popMinimal' },
      { slot: 'palette', presetId: 'whiteOnly' },
      { slot: 'motion', presetId: 'snappyPop' },
    ],
  },
  {
    name: 'netflix-minimal',
    slots: [
      { slot: 'theme', presetId: 'popMinimal' },
      { slot: 'palette', presetId: 'whiteOnly' },
    ],
  },
  {
    name: 'karaoke-fill',
    slots: [
      { slot: 'motion', presetId: 'progressiveReveal' },
      { slot: 'accent', presetId: 'subtleItalic' },
    ],
  },
];

const isPresetActive = (
  slot: keyof typeof PRESET_PACKS,
  presetId: string,
  spec: Record<string, unknown>,
): boolean => {
  const slotMap = PRESET_PACKS[slot] as Record<string, StylepackPartial> | undefined;
  if (!slotMap) return false;
  const pack = slotMap[presetId];
  if (!pack) return false;
  return specContainsPreset(pack, spec);
};

// Returns the matching archetype name + the slots it consumed, or null.
const detectArchetype = (
  spec: Record<string, unknown>,
): { name: string; consumed: Set<string> } | null => {
  for (const recipe of ARCHETYPE_RECIPES) {
    const allMatch = recipe.slots.every(({ slot, presetId }) =>
      isPresetActive(slot, presetId, spec),
    );
    if (allMatch) {
      const consumed = new Set<string>(recipe.slots.map((s) => s.slot));
      return { name: recipe.name, consumed };
    }
  }
  return null;
};

// Walk PRESET_PACKS for a single slot; return the first presetId whose pack
// is fully contained in the spec.
const findActivePresetForSlot = (
  slot: keyof typeof PRESET_PACKS,
  spec: Record<string, unknown>,
): string | null => {
  const slotMap = PRESET_PACKS[slot] as Record<string, StylepackPartial>;
  for (const [presetId, pack] of Object.entries(slotMap)) {
    if (specContainsPreset(pack, spec)) return presetId;
  }
  return null;
};

/**
 * One-line state digest for the agent's user turn. Detects named archetypes
 * first, then falls back to slot-by-slot active-preset detection. Empty spec
 * → "Currently: clean spec".
 */
export function summarizeSpec(spec: Record<string, unknown>): string {
  if (!spec || Object.keys(spec).length === 0) {
    return 'Currently: clean spec.';
  }

  const parts: string[] = [];
  const archetype = detectArchetype(spec);
  const consumedSlots = archetype?.consumed ?? new Set<string>();
  if (archetype) parts.push(archetype.name);

  // List remaining active slots (not consumed by the archetype match).
  const allSlots = Object.keys(PRESET_PACKS) as Array<keyof typeof PRESET_PACKS>;
  for (const slot of allSlots) {
    if (consumedSlots.has(slot)) continue;
    const presetId = findActivePresetForSlot(slot, spec);
    if (presetId) parts.push(`${slot}:${presetId}`);
  }

  // Headline knobs — short, eyeball-readable.
  const font = (spec.font ?? {}) as Record<string, unknown>;
  if (typeof font.weight === 'number') parts.push(`weight ${font.weight}`);
  if (font.textTransform && font.textTransform !== 'none') parts.push(String(font.textTransform));

  const tiers = (((spec.reel ?? {}) as Record<string, unknown>).tiers ?? {}) as Record<string, unknown>;
  const byPalette = (tiers.byPaletteIndex ?? {}) as Record<string, Record<string, unknown>>;
  for (const [idx, tier] of Object.entries(byPalette)) {
    if (tier?.effect && tier.effect !== 'none') {
      const eff = String(tier.effect);
      const intensity = typeof tier.intensity === 'number' ? ` (intensity ${tier.intensity})` : '';
      parts.push(`fx p${idx}:${eff}${intensity}`);
    }
  }

  if (parts.length === 0) return 'Currently: custom overrides (see below).';
  return `Currently: ${parts.join(' · ')}.`;
}

// ---------------------------------------------------------------------------
// diffFromDefaults

const baselineForTemplate = (templateId: string): Record<string, unknown> => {
  if (templateId === 'reel-clone') {
    return (PRESETS['reel-clone-default']?.styleSpec ?? {}) as Record<string, unknown>;
  }
  if (templateId === 'pop-words') {
    return (PRESETS.classic?.styleSpec ?? {}) as Record<string, unknown>;
  }
  return {};
};

const collectDiffPaths = (
  baseline: unknown,
  spec: unknown,
  prefix: string,
  out: Array<{ path: string; value: unknown }>,
): void => {
  // Leaf (primitive, array, or undefined) — compare against baseline.
  if (!isPlainObject(spec)) {
    if (!deepEqual(spec, baseline) && spec !== undefined) {
      out.push({ path: prefix || '(root)', value: spec });
    }
    return;
  }
  // Object — recurse, treating missing baseline keys as undefined.
  const baseObj = isPlainObject(baseline) ? baseline : {};
  for (const [k, v] of Object.entries(spec)) {
    const childPath = prefix ? `${prefix}.${k}` : k;
    collectDiffPaths(baseObj[k], v, childPath, out);
  }
};

/**
 * Flat dotted-path object of fields that differ from the template's
 * canonical default. Caps at 30 paths; if exceeded, appends a
 * `__truncated` marker with the count of dropped paths.
 */
export function diffFromDefaults(
  spec: Record<string, unknown>,
  templateId: string,
): Record<string, unknown> {
  const baseline = baselineForTemplate(templateId);
  const found: Array<{ path: string; value: unknown }> = [];
  collectDiffPaths(baseline, spec ?? {}, '', found);

  const out: Record<string, unknown> = {};
  for (let i = 0; i < Math.min(found.length, MAX_DIFF_PATHS); i++) {
    const entry = found[i]!;
    out[entry.path] = entry.value;
  }
  if (found.length > MAX_DIFF_PATHS) {
    out.__truncated = found.length - MAX_DIFF_PATHS;
  }
  return out;
}
