// DirectorScript — the agent's video plan. Day 6 of the Director feature.
//
// Three cascading layers compose the final per-word visual:
//   1. project invariants — defaults for the entire video (brand color, font)
//   2. scene groups       — functional regions (intro-hook, list, cta) each
//                           with a role, word range, and optional overrides
//   3. caption beats      — sub-group emphasis beats (one word, an inline
//                           italic accent, a per-beat audio cue)
//
// resolveWordContext (Day 5 stub, populated by Day 7 work) walks the layers
// in order; the last layer to set a field wins. The agent's UI surfaces the
// resolved value AND the layer that won, so "this word is yellow" can be
// explained as "the group's emphasisFill set it; the project's brand color
// would have left it white".
//
// Discriminated unions:
//   * groupRelation — how this group enters relative to the previous one
//     ('cut' | 'fade' | 'morph-from-previous'). v1 renders cut/fade only.
//   * beatRelation  — how this beat decorates its word ('isolate' | 'echo'
//                     | 'inline-italic'). Forward-compat hint for v2.
//
// superRefine validations enforce structural invariants the planner CAN
// emit but that would crash downstream code:
//   * Groups must not overlap on the word axis
//   * Every beat's groupId must reference an existing group
//   * Every beat's word range must be a subset of its parent group's range

import { z } from 'zod';
import {
  audioPatternTypeSchema,
  casingSchema,
  groupRoleSchema,
  layoutStrategyIdSchema,
  motionPresetSchema,
  sonicGestureSchema,
} from './vocabularies.js';

// ---------------------------------------------------------------------------
// Primitives.

export const colorHexSchema = z
  .string()
  .regex(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i, 'expected #rgb / #rrggbb / #rrggbbaa');

// [startIdx, endIdx] — both inclusive, both non-negative integers, start <= end.
// Indices reference the transcript's words array.
export const wordRangeSchema = z
  .tuple([z.number().int().nonnegative(), z.number().int().nonnegative()])
  .refine(([s, e]) => s <= e, { message: 'wordRange start must be <= end' });

export type WordRange = z.infer<typeof wordRangeSchema>;

export const placementSchema = z.object({
  anchor: z.enum(['top', 'middle', 'bottom', 'baseline-lower-third']),
  alignment: z.enum(['left', 'center', 'right']).default('center'),
  offsetY: z.number().min(-1).max(1).optional(),
  offsetX: z.number().min(-1).max(1).optional(),
});
export type Placement = z.infer<typeof placementSchema>;

// ---------------------------------------------------------------------------
// Audio.

export const audioCueSchema = z.object({
  gesture: sonicGestureSchema,
  volume: z.number().min(0).max(1).optional(),
  offsetMs: z.number().int().optional(),   // negative = anticipate, positive = delay
});
export type AudioCue = z.infer<typeof audioCueSchema>;

export const audioPatternSchema = z.object({
  type: audioPatternTypeSchema,
  params: z
    .object({
      sampleSet: z.string().optional(),
      intervalMs: z.number().positive().optional(),
      volume: z.number().min(0).max(1).optional(),
      pitchVariation: z.number().optional(),
    })
    .default({}),
});
export type AudioPattern = z.infer<typeof audioPatternSchema>;

// ---------------------------------------------------------------------------
// Style overrides — shared shape for project / group / beat layers.

export const styleOverrideSchema = z.object({
  fill: colorHexSchema.optional(),
  emphasisFill: colorHexSchema.optional(),
  font: z.string().optional(),
  fontSize: z.number().positive().optional(),
  casing: casingSchema.optional(),
  effect: z.string().optional(),
  intensity: z.number().min(0).max(1).optional(),
  // Per-group entry animation preset. When omitted the role default from
  // ROLE_DEFAULTS[role].motionPreset is used so every role gets a signature
  // animation language out of the box.
  motionPreset: motionPresetSchema.optional(),
});
export type StyleOverride = z.infer<typeof styleOverrideSchema>;

// ---------------------------------------------------------------------------
// Layer 1 — ProjectInvariants. Required defaults for the entire video.

export const projectInvariantsSchema = z.object({
  fill: colorHexSchema.default('#ffffff'),
  emphasisFill: colorHexSchema.default('#ffd100'),
  font: z.string().default('Inter'),
  // Cinematic baseline. The renderer's existing presets ship sizes around
  // 200-240 for Inter Black hero text; 96 here is the speaker-talk
  // baseline that role multipliers scale up from. Backstory (0.85×) lands
  // at ~80; stat-callout (2.6×) at ~250 — Jodie-scale chapter punctuation.
  fontSize: z.number().positive().default(96),
  casing: casingSchema.default('none'),
  // Default motion FX when a group/beat doesn't override. Use 'none' for
  // plain captions; specific effects (samba/shockwave/etc.) are tier-style.
  defaultEffect: z.string().default('none'),
  defaultIntensity: z.number().min(0).max(1).default(0.5),
});
export type ProjectInvariants = z.infer<typeof projectInvariantsSchema>;

// ---------------------------------------------------------------------------
// GroupRelation — how this group transitions in from the previous one.
// v1 renderer honors 'cut' and 'fade'; 'morph-from-previous' falls back to
// 'fade' with a render-time warning (renderer can't carry two-group state).

export const groupRelationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('cut') }),
  z.object({
    kind: z.literal('fade'),
    durationMs: z.number().positive().default(200),
  }),
  z.object({
    kind: z.literal('morph-from-previous'),
    durationMs: z.number().positive().default(400),
  }),
]);
export type GroupRelation = z.infer<typeof groupRelationSchema>;

// ---------------------------------------------------------------------------
// Layer 2 — SceneGroup. A functional region with a role and word range.

export const sceneGroupSchema = z.object({
  id: z.string().min(1),
  role: groupRoleSchema,
  wordRange: wordRangeSchema,
  // User-facing label for the timeline pill. Short — 1-3 words.
  label: z.string().min(1).max(40).optional(),
  // Optional layout override. If omitted, ROLE_DEFAULTS[role].layoutStrategy
  // is used by the resolver. Schema doesn't validate layoutParams since each
  // strategy has its own params shape (kept on the renderer side).
  layoutStrategy: layoutStrategyIdSchema.optional(),
  layoutParams: z.record(z.string(), z.unknown()).optional(),
  // Words per line for this group. Forces one-word-per-line stacks (Jodie
  // "QUIT / HER / JOB" style) when set to 1. Omit to use the strategy's
  // default. The renderer reads styleSpec.layout.maxWordsPerLine after
  // chunkOverride merge.
  maxPerLine: z.number().int().min(1).max(10).optional(),
  placement: placementSchema.optional(),
  // Per-group style overrides — last layer in the cascade before beats.
  overrides: styleOverrideSchema.optional(),
  audioCue: audioCueSchema.optional(),
  audioPattern: audioPatternSchema.optional(),
  // Entry transition relative to the preceding group. First group ignores
  // this and is always rendered with a hard cut.
  relation: groupRelationSchema.default({ kind: 'cut' }),
  // Free-form rationale the planner provides; the UI shows it as a tooltip
  // on the timeline pill ("Why is this group an enumerated-list? ...")
  rationale: z.string().max(280).optional(),
});
export type SceneGroup = z.infer<typeof sceneGroupSchema>;

// ---------------------------------------------------------------------------
// BeatRelation — how the beat decorates its word(s). v1 ignores everything
// but 'isolate' (the default); 'echo' and 'inline-italic' are forward-compat.

export const beatRelationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('isolate') }),
  z.object({ kind: z.literal('echo'), count: z.number().int().min(2).max(5).default(2) }),
  z.object({ kind: z.literal('inline-italic') }),
]);
export type BeatRelation = z.infer<typeof beatRelationSchema>;

// ---------------------------------------------------------------------------
// Layer 3 — CaptionBeat. Sub-group emphasis (a single word, an italic accent,
// a per-beat audio cue). Multiple beats can target the same word.

export const captionBeatSchema = z.object({
  id: z.string().min(1),
  groupId: z.string().min(1),
  wordRange: wordRangeSchema,
  overrides: styleOverrideSchema.optional(),
  audioCue: audioCueSchema.optional(),
  relation: beatRelationSchema.default({ kind: 'isolate' }),
});
export type CaptionBeat = z.infer<typeof captionBeatSchema>;

// ---------------------------------------------------------------------------
// DirectorScript — the top-level structure. superRefine enforces:
//   * Groups' word ranges don't overlap each other
//   * Every beat's groupId references an existing group
//   * Every beat's word range is contained within its parent group's range

export const directorScriptSchema = z
  .object({
    project: projectInvariantsSchema.default({}),
    groups: z.array(sceneGroupSchema).min(1),
    beats: z.array(captionBeatSchema).default([]),
  })
  .superRefine((script, ctx) => {
    // ---- 1. group word-range non-overlap ----
    // Sort by start so we only compare adjacent pairs.
    const sorted = script.groups
      .map((g, i) => ({ g, i }))
      .sort((a, b) => a.g.wordRange[0] - b.g.wordRange[0]);
    for (let k = 1; k < sorted.length; k++) {
      const prev = sorted[k - 1]!;
      const cur = sorted[k]!;
      if (cur.g.wordRange[0] <= prev.g.wordRange[1]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['groups', cur.i, 'wordRange'],
          message: `group "${cur.g.id}" word range [${cur.g.wordRange.join(', ')}] overlaps group "${prev.g.id}" range [${prev.g.wordRange.join(', ')}]`,
        });
      }
    }

    // ---- 2. beat → group reference + containment ----
    const groupById = new Map(script.groups.map((g) => [g.id, g] as const));
    for (let bi = 0; bi < script.beats.length; bi++) {
      const beat = script.beats[bi]!;
      const parent = groupById.get(beat.groupId);
      if (!parent) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['beats', bi, 'groupId'],
          message: `beat "${beat.id}" references unknown group "${beat.groupId}"`,
        });
        continue;
      }
      const [bs, be] = beat.wordRange;
      const [gs, ge] = parent.wordRange;
      if (bs < gs || be > ge) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['beats', bi, 'wordRange'],
          message: `beat "${beat.id}" word range [${bs}, ${be}] is not contained within parent group "${parent.id}" range [${gs}, ${ge}]`,
        });
      }
    }
  });

export type DirectorScript = z.infer<typeof directorScriptSchema>;
