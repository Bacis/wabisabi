import { z } from 'zod';
import { EFFECT_IDS } from './effectIds.js';

// New stage-shaped schema for the cinematic caption pipeline. Phase 4 ships
// this alongside the existing loose `reel: z.record(z.string(), z.any())`
// slot in styleSpec.ts — it's the typed surface Phase 8's stage-scoped
// agent tools validate payloads against. Phase 7 migrates `reel-clone-default`
// to emit this shape natively; Phase 9 flips the canonical StyleSpec to
// require it.
//
// Why three schemas (linguistics / chunking / layout / typography / motion / fx)
// instead of one flat dictionary:
//   - Each stage has its own independent surface; the agent edits one at a time.
//   - Discriminated unions (layout.strategy, motion.entry.preset, fx.tiers.*.effect)
//     reject incompatible params at parse time instead of at render time.
//   - Defensive normalizers like wordReveal:true → 'progressive' or
//     maxWidthPercent:0.8 → 80 disappear: the typed enums + ranges reject
//     them with a clear Zod message at the door.

// ---------------------------------------------------------------------------
// Shared primitives — re-exported so future schemas can compose without
// circular imports. colorSchema / gradientSchema / shadowSchema live in
// styleSpec.ts and stay there as the cross-template primitives.

const colorHex = z
  .string()
  .regex(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i, 'expected #rgb / #rrggbb / #rrggbbaa');

const gradientStop = z.object({
  pos: z.number().min(0).max(1),
  color: colorHex,
});

const fillSchema = z.union([
  colorHex,
  z.object({
    type: z.literal('linear').default('linear'),
    angle: z.number().default(90),
    stops: z.array(gradientStop).min(2),
  }),
]);

// Tier keys identify which words an override applies to.
//   'p0', 'p1', 'p2', ... — palette-index tiers (0 = primary emphasis color).
//   'italic' — words flagged italic by the linguistics stage.
export const tierKeySchema = z.union([
  z.literal('italic'),
  z.string().regex(/^p\d+$/, 'expected "italic" or palette tier id like "p0", "p1"'),
]);
export type TierKey = z.infer<typeof tierKeySchema>;

// ---------------------------------------------------------------------------
// 1. Linguistics — what the analyzer should look for in the transcript.

export const linguisticsConfigSchema = z.object({
  inferEmphasis: z.boolean().default(true),
  // Optional overrides for the curated FILLER_WORDS / VALUE_WORDS sets in
  // remotion/src/lib/linguistics. Leave undefined to use the defaults.
  fillerWords: z.array(z.string().toLowerCase()).optional(),
  valueWords: z.array(z.string().toLowerCase()).optional(),
  italicAccent: z
    .object({
      mode: z.enum(['off', 'rate', 'vocabulary']).default('off'),
      // Fraction (0..1). Effective rate is clamped to [0.08, 0.30] inside
      // the matcher so small targets still produce visible accents.
      rate: z.number().min(0).max(1).default(0),
      vocabulary: z.array(z.string().toLowerCase()).default([]),
      minAlphaLen: z.number().int().min(1).default(5),
    })
    .default({}),
});
export type LinguisticsConfig = z.infer<typeof linguisticsConfigSchema>;

// ---------------------------------------------------------------------------
// 2. Chunking — how the transcript is sliced into on-screen units.

export const chunkingConfigSchema = z.object({
  source: z.enum(['caption-plan', 'fallback']).default('caption-plan'),
  fallback: z
    .object({
      maxWordsPerChunk: z.number().int().positive().default(4),
    })
    .default({}),
  // How long after the chunk's last word the chunk stays on screen.
  tailMs: z.number().min(0).default(200),
});
export type ChunkingConfig = z.infer<typeof chunkingConfigSchema>;

// ---------------------------------------------------------------------------
// 3. Layout — discriminated by strategy id.

export const cascadeStackParamsSchema = z.object({
  cascadeTopRatio: z.number().min(0).default(1),
  cascadeBottomRatio: z.number().min(0).default(0.47),
  maxLines: z.number().int().positive().default(4),
  maxWordsPerLine: z.number().int().positive().default(3),
  emphasisFillRatio: z.number().min(0).max(1).default(0.75),
  emphasisMaxHeightRatio: z.number().min(0).max(1).default(0.16),
  columnGapRatio: z.number().min(0).default(0.18),
  rowGapRatio: z.number().min(0).default(0.04),
  // 0..100 PERCENT — typed range eliminates the wordReveal-style normalizer.
  maxWidthPercent: z.number().min(0).max(100).default(80),
  paddingPercent: z.number().min(0).max(100).default(6),
});

export const singleLineFlowParamsSchema = z.object({
  maxWidthPercent: z.number().min(0).max(100).default(80),
  paddingPercent: z.number().min(0).max(100).default(6),
  align: z.enum(['left', 'center', 'right']).default('center'),
});

export const karaokeRowParamsSchema = z.object({
  maxWordsPerLine: z.number().int().positive().default(5),
  highlightLeadMs: z.number().default(0),
});

export const centeredPopParamsSchema = z.object({
  sizeMultiplier: z.number().positive().default(2.4),
  fitMargin: z.number().min(0).max(1).default(0.85),
});

export const freePositionedParamsSchema = z.object({
  // 1080×1920 reference frame — Caption Designer gizmo.
  box: z.object({
    x: z.number(),
    y: z.number(),
    w: z.number(),
    h: z.number(),
    rot: z.number().default(0),
  }),
});

export const layoutConfigSchema = z.discriminatedUnion('strategy', [
  z.object({ strategy: z.literal('cascade-stack'), params: cascadeStackParamsSchema.default({}) }),
  z.object({ strategy: z.literal('single-line-flow'), params: singleLineFlowParamsSchema.default({}) }),
  z.object({ strategy: z.literal('karaoke-row'), params: karaokeRowParamsSchema.default({}) }),
  z.object({ strategy: z.literal('centered-pop'), params: centeredPopParamsSchema.default({}) }),
  z.object({ strategy: z.literal('top-banner'), params: singleLineFlowParamsSchema.default({}) }),
  z.object({ strategy: z.literal('lower-third'), params: singleLineFlowParamsSchema.default({}) }),
  z.object({ strategy: z.literal('two-column-split'), params: cascadeStackParamsSchema.default({}) }),
  z.object({ strategy: z.literal('free-positioned'), params: freePositionedParamsSchema }),
]);
export type LayoutConfig = z.infer<typeof layoutConfigSchema>;

// ---------------------------------------------------------------------------
// 4. Typography — base + per-tier overrides.

export const typographyTierOverrideSchema = z.object({
  fill: fillSchema.optional(),
  fontFamily: z.string().optional(),
  fontWeight: z.number().int().min(100).max(900).optional(),
  fontStyle: z.enum(['normal', 'italic']).optional(),
  sizeMultiplier: z.number().positive().optional(),
  textTransform: z.enum(['none', 'uppercase', 'lowercase']).optional(),
  strokeColor: colorHex.optional(),
  strokeWidth: z.number().min(0).optional(),
});
export type TypographyTierOverride = z.infer<typeof typographyTierOverrideSchema>;

export const typographyConfigSchema = z.object({
  base: z
    .object({
      emphasisStyle: z.enum(['inline-color', 'block', 'combined']).default('combined'),
      emphasisWeight: z.number().int().min(100).max(900).optional(),
      emphasisTextTransform: z.enum(['none', 'uppercase', 'lowercase']).default('uppercase'),
      fillerTextTransform: z.enum(['none', 'uppercase', 'lowercase']).default('lowercase'),
      mediumTextTransform: z.enum(['none', 'uppercase', 'lowercase']).default('lowercase'),
      multiColorEmphasis: z.boolean().default(false),
      charAdvance: z.number().positive().optional(),
    })
    .default({}),
  tiers: z.record(tierKeySchema, typographyTierOverrideSchema).default({}),
});
export type TypographyConfig = z.infer<typeof typographyConfigSchema>;

// ---------------------------------------------------------------------------
// 5. Motion — entry / sustain / exit are deliberately distinct.

export const motionEntrySchema = z.discriminatedUnion('preset', [
  z.object({
    preset: z.literal('spring-pop'),
    durationMs: z.number().positive().default(140),
    scaleFrom: z.number().min(0).max(1).default(0.7),
    spring: z
      .object({
        damping: z.number().positive().default(14),
        stiffness: z.number().positive().default(240),
        mass: z.number().positive().default(0.5),
      })
      .default({}),
  }),
  z.object({
    preset: z.literal('fade'),
    durationMs: z.number().positive().default(200),
  }),
  z.object({
    preset: z.literal('typewriter'),
    msPerChar: z.number().positive().default(30),
  }),
  z.object({
    preset: z.literal('slide'),
    durationMs: z.number().positive().default(180),
    fromX: z.number().default(40),
  }),
  z.object({
    preset: z.literal('progressive-reveal'),
    perWordOffsetMs: z.number().min(0).default(0),
    durationMs: z.number().positive().default(140),
    scaleFrom: z.number().min(0).max(1).default(0.7),
  }),
]);

export const motionSustainSchema = z
  .object({
    activeBoost: z.number().min(1).max(2).default(1.06),
  })
  .default({});

export const motionExitSchema = z.discriminatedUnion('preset', [
  z.object({ preset: z.literal('cut'), tailMs: z.number().min(0).default(200) }),
  z.object({ preset: z.literal('fade-out'), durationMs: z.number().positive().default(160) }),
]);

export const motionConfigSchema = z.object({
  entry: motionEntrySchema.default({ preset: 'progressive-reveal' }),
  sustain: motionSustainSchema,
  exit: motionExitSchema.default({ preset: 'cut', tailMs: 200 }),
});
export type MotionConfig = z.infer<typeof motionConfigSchema>;

// ---------------------------------------------------------------------------
// 6. FX — discriminated union per effect, assigned per tier. The variant
// list is generated from EFFECT_IDS so adding an effect is one append in
// effectIds.ts (plus the matching registry entry on the renderer side).

const intensityField = z.number().min(0).max(1).default(0.5);

function effectVariant<T extends string>(effect: T) {
  return z.object({
    effect: z.literal(effect),
    params: z
      .object({
        // intensityField has .default(0.5) — keep it non-optional so the
        // default fires when the agent omits it.
        intensity: intensityField,
        color: colorHex.optional(),
      })
      .default({}),
  });
}

// Manually expand because Zod's discriminatedUnion needs a literal-typed
// array, not a generic mapped one. The list mirrors EFFECT_IDS — runtime
// assertion below catches drift.
export const effectAssignmentSchema = z.discriminatedUnion('effect', [
  effectVariant('none'),
  effectVariant('samba'),
  effectVariant('crystal'),
  effectVariant('magnetic'),
  effectVariant('breathe'),
  effectVariant('flare'),
  effectVariant('resonance'),
  effectVariant('plasma'),
  effectVariant('inflation'),
  effectVariant('ferro'),
  effectVariant('shockwave'),
  effectVariant('slice'),
]);
export type EffectAssignment = z.infer<typeof effectAssignmentSchema>;

// Sanity check that `effectAssignmentSchema` covers every id in EFFECT_IDS.
// Throws at module-load time so the build fails loudly if the two drift.
const __covered = new Set(effectAssignmentSchema.options.map((o) => o.shape.effect.value));
for (const id of EFFECT_IDS) {
  if (!__covered.has(id)) {
    throw new Error(
      `effectAssignmentSchema is missing variant for "${id}" — add effectVariant('${id}') to stylepackSchema.ts`,
    );
  }
}

export const fxConfigSchema = z.object({
  tiers: z
    .record(tierKeySchema, z.union([effectAssignmentSchema, z.array(effectAssignmentSchema)]))
    .default({}),
});
export type FxConfig = z.infer<typeof fxConfigSchema>;

// ---------------------------------------------------------------------------
// 7. ReelStylepack — the full pipeline-scoped config block.

export const reelStylepackSchema = z.object({
  linguistics: linguisticsConfigSchema.default({}),
  chunking: chunkingConfigSchema.default({}),
  layout: layoutConfigSchema.default({ strategy: 'cascade-stack', params: {} }),
  typography: typographyConfigSchema.default({}),
  motion: motionConfigSchema.default({
    entry: { preset: 'progressive-reveal' },
    sustain: {},
    exit: { preset: 'cut', tailMs: 200 },
  }),
  fx: fxConfigSchema.default({}),
});
export type ReelStylepack = z.infer<typeof reelStylepackSchema>;
