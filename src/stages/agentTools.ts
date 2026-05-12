// Stage-scoped agent-tool validators (Phase 8 of the pipeline refactor).
//
// These are PURE functions that the LangGraph tool bodies call to validate
// inputs against the typed schemas from src/shared/pipeline/. Keeping them
// pure means we can unit-test the validation surface without mocking the
// LangGraph harness, and the existing per-request closure pattern in
// agentChat.ts (draftPatch + toolTrace) stays intact.
//
// Each validator returns a tagged result so the tool body can decide whether
// to mutate draftPatch + return ok:true, or skip + return ok:false with the
// error message. The patches the validators emit write to the SAME loose
// `reel.*` paths the renderer currently reads — so these tools work TODAY
// without waiting for the Phase 9 typed renderer reader. The typed schema's
// role here is purely input validation: it's what makes the historical
// defensive normalizers (maxWidthPercent fraction-vs-percent, wordReveal
// bool-vs-string) obsolete by rejecting them at the door with a clear Zod
// error.

import { z } from 'zod';
import type { StylepackPartial } from '../shared/pipeline/compose.js';
import { getPresetPack, PRESET_PACKS, type PresetSlot } from '../shared/pipeline/packs/index.js';
import {
  cascadeStackParamsSchema,
  centeredPopParamsSchema,
  effectAssignmentSchema,
  freePositionedParamsSchema,
  karaokeRowParamsSchema,
  singleLineFlowParamsSchema,
  type EffectAssignment,
} from '../shared/pipeline/stylepackSchema.js';
import { EFFECT_IDS, type EffectId } from '../shared/pipeline/effectIds.js';

export type ValidatorOk<T> = { ok: true; patch: StylepackPartial; applied: string; payload?: T };
export type ValidatorErr = { ok: false; error: string };
export type ValidatorResult<T = void> = ValidatorOk<T> | ValidatorErr;

const truncate = (s: string, n = 200): string => (s.length > n ? `${s.slice(0, n)}…` : s);

// ---------------------------------------------------------------------------
// applyPreset({ slot, presetId }) — composes a slotted preset onto draftPatch.

const PRESET_SLOTS = Object.keys(PRESET_PACKS) as ReadonlyArray<PresetSlot>;

export function validateApplyPreset(input: { slot: string; presetId: string }): ValidatorResult {
  if (!PRESET_SLOTS.includes(input.slot as PresetSlot)) {
    return {
      ok: false,
      error: `unknown slot "${input.slot}" — known slots: ${PRESET_SLOTS.join(', ')}`,
    };
  }
  const pack = getPresetPack(input.slot, input.presetId);
  if (!pack) {
    const slotMap = (PRESET_PACKS as Record<string, Record<string, unknown>>)[input.slot]!;
    const known = Object.keys(slotMap).join(', ');
    return {
      ok: false,
      error: `unknown preset "${input.presetId}" in slot "${input.slot}" — known: ${known}`,
    };
  }
  return {
    ok: true,
    patch: pack,
    applied: `preset.${input.slot}.${input.presetId}`,
  };
}

// ---------------------------------------------------------------------------
// setEffect({ tier, effect, params }) — assigns an effect to a tier.

export function validateSetEffect(input: {
  tier: string;
  effect: string;
  params?: Record<string, unknown>;
}): ValidatorResult<EffectAssignment> {
  // Tier keys are 'p<digit>+' (palette index) or 'italic'.
  const tierIsPalette = /^p\d+$/.test(input.tier);
  const tierIsItalic = input.tier === 'italic';
  if (!tierIsPalette && !tierIsItalic) {
    return { ok: false, error: 'tier must be "italic" or a palette tier id like "p0", "p1"' };
  }

  if (!EFFECT_IDS.includes(input.effect as EffectId)) {
    return {
      ok: false,
      error: `unknown effect "${input.effect}" — known: ${EFFECT_IDS.join(', ')}`,
    };
  }

  const parsed = effectAssignmentSchema.safeParse({
    effect: input.effect,
    params: input.params ?? {},
  });
  if (!parsed.success) {
    return { ok: false, error: `params: ${truncate(parsed.error.message)}` };
  }

  // Translate to the existing loose `reel.tiers.*` shape the renderer reads.
  // Renderer reads { effect, intensity, fill?, fontWeight?, ... } per tier.
  const tierStyle: Record<string, unknown> = { effect: parsed.data.effect };
  if (parsed.data.params.intensity !== undefined) tierStyle.intensity = parsed.data.params.intensity;
  if (parsed.data.params.color !== undefined) tierStyle.fill = parsed.data.params.color;

  let patch: StylepackPartial;
  if (tierIsItalic) {
    patch = { reel: { tiers: { italic: tierStyle } } } as StylepackPartial;
  } else {
    const paletteIdx = input.tier.slice(1); // 'p0' → '0'
    patch = {
      reel: { tiers: { byPaletteIndex: { [paletteIdx]: tierStyle } } },
    } as StylepackPartial;
  }

  return {
    ok: true,
    patch,
    applied: `reel.tiers.${input.tier}`,
    payload: parsed.data,
  };
}

// ---------------------------------------------------------------------------
// setLayoutStrategy({ strategy, params }) — switches strategy + writes params
// to the loose `reel.*` fields the cascade-stack renderer currently reads.

const STRATEGY_PARAM_SCHEMAS = {
  'cascade-stack': cascadeStackParamsSchema,
  'single-line-flow': singleLineFlowParamsSchema,
  'karaoke-row': karaokeRowParamsSchema,
  'centered-pop': centeredPopParamsSchema,
  'top-banner': singleLineFlowParamsSchema,
  'lower-third': singleLineFlowParamsSchema,
  'two-column-split': cascadeStackParamsSchema,
  'free-positioned': freePositionedParamsSchema,
} as const;

const STRATEGY_IDS = Object.keys(STRATEGY_PARAM_SCHEMAS) as ReadonlyArray<keyof typeof STRATEGY_PARAM_SCHEMAS>;

export function validateSetLayoutStrategy(input: {
  strategy: string;
  params?: Record<string, unknown>;
}): ValidatorResult {
  if (!(STRATEGY_IDS as ReadonlyArray<string>).includes(input.strategy)) {
    return {
      ok: false,
      error: `unknown strategy "${input.strategy}" — known: ${STRATEGY_IDS.join(', ')}`,
    };
  }
  const schema = STRATEGY_PARAM_SCHEMAS[input.strategy as keyof typeof STRATEGY_PARAM_SCHEMAS];
  const parsed = schema.safeParse(input.params ?? {});
  if (!parsed.success) {
    return { ok: false, error: `params: ${truncate(parsed.error.message)}` };
  }

  // For the existing renderer (cascade-stack only), translate to loose fields.
  // Other strategies don't have a renderer yet — Phase 9 wires them. Until
  // then the patch includes the strategy hint so future Phase 9 reader code
  // can pick it up.
  const reelPatch: Record<string, unknown> = {};
  if (input.strategy === 'cascade-stack') {
    const p = parsed.data as z.infer<typeof cascadeStackParamsSchema>;
    Object.assign(reelPatch, {
      cascadeTopRatio: p.cascadeTopRatio,
      cascadeBottomRatio: p.cascadeBottomRatio,
      emphasisFillRatio: p.emphasisFillRatio,
      emphasisMaxHeightRatio: p.emphasisMaxHeightRatio,
      columnGapRatio: p.columnGapRatio,
      rowGapRatio: p.rowGapRatio,
      maxWidthPercent: p.maxWidthPercent,
      paddingPercent: p.paddingPercent,
    });
  }
  // Forward-compat hint for the Phase 9 typed reader.
  reelPatch.layout = { strategy: input.strategy, params: parsed.data };

  return {
    ok: true,
    patch: { reel: reelPatch } as StylepackPartial,
    applied: `reel.layout (${input.strategy})`,
  };
}

// ---------------------------------------------------------------------------
// tuneField({ path, value }) — escape-hatch dot-path dial. Restricts paths
// to the known top-level groups so the agent can't write to arbitrary fields
// (ALL_TOP_LEVEL acts as the gate). Validation deferred to the composer's
// final StyleSpecSchema.parse(): if the dot-path produces an invalid spec,
// the parse error becomes the tool's error message.

const TUNE_ALLOWED_ROOTS = ['font', 'color', 'layout', 'animation', 'reel', 'charAdvance'] as const;

export function validateTuneField(input: { path: string; value: unknown }): ValidatorResult {
  const segments = input.path.split('.').filter((s) => s.length > 0);
  if (segments.length === 0) {
    return { ok: false, error: 'path must be a non-empty dot-path like "font.weight" or "reel.cascadeBottomRatio"' };
  }
  const root = segments[0]!;
  if (!(TUNE_ALLOWED_ROOTS as ReadonlyArray<string>).includes(root)) {
    return {
      ok: false,
      error: `path root "${root}" not allowed — must be one of: ${TUNE_ALLOWED_ROOTS.join(', ')}`,
    };
  }
  const patch: Record<string, unknown> = {};
  let cursor: Record<string, unknown> = patch;
  for (let i = 0; i < segments.length - 1; i++) {
    const next: Record<string, unknown> = {};
    cursor[segments[i]!] = next;
    cursor = next;
  }
  cursor[segments[segments.length - 1]!] = input.value;

  return {
    ok: true,
    patch: patch as StylepackPartial,
    applied: input.path,
  };
}
