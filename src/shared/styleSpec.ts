import { z } from 'zod';

// User-facing customization layer. Anything not specified falls back to a
// sensible TikTok-style default. The render template receives the parsed
// (defaults-applied) object as props.
//
// Phase A of the configurability work promoted every previously-hardcoded
// visual value into this schema with defaults matching the old inlined
// constants — existing jobs and presets render pixel-identically unless
// they set one of the new fields.
const colorSchema = z
  .string()
  .regex(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i, 'expected #rgb / #rrggbb / #rrggbbaa');

// Phase B adds three visual primitives on `color` (shadow, fillGradient,
// palette) plus `font.variableAxes`. Each is optional and backward-compatible
// — absent means the current behavior, present adds the new effect. The
// emphasis palette is a union of a single color (the historical shape) and
// an array that cycles per chunk.
const gradientStopSchema = z.object({
  pos: z.number().min(0).max(1),
  color: colorSchema,
});

const gradientSchema = z.object({
  type: z.literal('linear').default('linear'),
  angle: z.number().default(90),
  stops: z.array(gradientStopSchema).min(2),
});

const shadowSchema = z.object({
  color: colorSchema.default('#000000cc'),
  blurPx: z.number().min(0).default(0),
  offsetX: z.number().default(0),
  offsetY: z.number().default(0),
});

export const StyleSpecSchema = z
  .object({
    font: z
      .object({
        family: z.string().default('Inter'),
        weight: z.number().int().min(100).max(900).default(800),
        size: z.number().positive().default(72),
        letterSpacing: z.number().default(0),
        textTransform: z.enum(['none', 'uppercase', 'lowercase']).default('uppercase'),
        // Static variable-font axis settings, e.g. { "wght": 850, "slnt": -4 }.
        // Only takes effect if the loaded font file is a variable font;
        // for the default static Inter load, this is silently ignored.
        variableAxes: z.record(z.string(), z.number()).optional(),
      })
      .default({}),
    color: z
      .object({
        fill: colorSchema.default('#ffffff'),
        stroke: colorSchema.default('#000000'),
        strokeWidth: z.number().min(0).default(8),
        // Emphasis fill accepts either a single color (historical shape)
        // or an array that the template cycles through per chunk index.
        // With a palette of length N, chunk i uses palette[i % N].
        emphasisFill: z.union([colorSchema, z.array(colorSchema).min(1)]).default('#ffe14b'),
        background: colorSchema.optional(),
        // Optional drop shadow / glow applied via CSS text-shadow. A glow
        // is just a shadow with offsetX/Y = 0 and a large blur.
        shadow: shadowSchema.optional(),
        // Optional linear gradient fill. When set, overrides `fill` for
        // non-emphasis words — emphasis words still use a solid
        // `emphasisFill` color (or palette entry) so they stand out.
        fillGradient: gradientSchema.optional(),
      })
      .default({}),
    layout: z
      .object({
        // Caption rendering mode. "classic" is the original PopWords-style
        // flex-row layout (bottom/top/middle bar). "editorial" is the
        // hopecore serif layer: per-word size variance, mixed case, big
        // emphasis words fill the frame. Only the producer's
        // StoryComposition honors this; the single-video /jobs flow
        // ignores it.
        mode: z.enum(['classic', 'editorial']).default('classic'),
        position: z.enum(['top', 'middle', 'bottom']).default('bottom'),
        // Fraction of frame height kept clear from the top/bottom edge.
        safeMargin: z.number().min(0).max(0.5).default(0.15),
        maxWordsPerLine: z.number().int().positive().default(4),
        align: z.enum(['left', 'center', 'right']).default('center'),
        // Horizontal and vertical padding of the chunk container when
        // color.background is set. Previously hardcoded at 24 / 12.
        padding: z
          .object({
            x: z.number().min(0).default(24),
            y: z.number().min(0).default(12),
          })
          .default({}),
        // Corner radius of the chunk container background. Previously
        // hardcoded at 16.
        borderRadius: z.number().min(0).default(16),
        // Gap between words in a chunk, as a fraction of font.size.
        // Previously hardcoded at 0.25 (i.e. font.size * 0.25).
        gapRatio: z.number().min(0).default(0.25),
        // SingleWord-specific layout tuning. Size multiplier is what makes
        // the single-word look "big" (previously hardcoded 2.4). Fit margin
        // is the fraction of frame width the longest word is allowed to
        // occupy before the size is clamped (previously 0.85). Char advance
        // estimate is used by the clamp — roughly the average advance of a
        // capital letter in the font, relative to em (previously 0.6 for
        // Inter weight 900).
        singleWord: z
          .object({
            sizeMultiplier: z.number().positive().default(2.4),
            fitMargin: z.number().min(0).max(1).default(0.85),
            charAdvanceEst: z.number().positive().default(0.6),
          })
          .default({}),
      })
      .default({}),
    // Phase C: per-chunk style overrides. Optional array of
    // {range: [startIdx, endIdx], overrides: partial StyleSpec}. For each
    // rendered chunk, any matching range's overrides get two-level-deep
    // merged onto the base spec. Later entries win over earlier ones.
    // The override payload is intentionally loose (z.any) — we trust that
    // whatever the template reads is either absent (falls back to base)
    // or structurally valid. Tightening this would require Zod-partial of
    // every nested object, which is painful to maintain.
    chunkOverrides: z
      .array(
        z.object({
          range: z.tuple([
            z.number().int().nonnegative(),
            z.number().int().nonnegative(),
          ]),
          overrides: z.record(z.string(), z.any()),
        }),
      )
      .optional(),
    animation: z
      .object({
        preset: z.enum(['pop', 'fade', 'karaoke', 'typewriter', 'slide']).default('pop'),
        durationMs: z.number().positive().default(120),
        emphasisScale: z.number().min(1).max(3).default(1.15),
        // Starting scale for the pop/slide intro animation — the word
        // animates from this scale up to its target scale. Previously
        // hardcoded at 0.6 in PopWords and 0.55 in SingleWord; we use 0.6
        // as the unified default.
        scaleFrom: z.number().min(0).max(1).default(0.6),
        // Extra scale applied to the currently-spoken word on top of any
        // emphasis scaling, to give live tracking feedback. Previously
        // hardcoded at 1.06 in PopWords; SingleWord didn't apply it.
        activeBoost: z.number().min(1).max(2).default(1.06),
        // How long a chunk stays on screen after its last word ends, in
        // milliseconds. Previously hardcoded at 200ms in PopWords.
        tailMs: z.number().min(0).default(200),
        // Spring physics for the pop/slide animations. Previously
        // hardcoded at damping=12, stiffness=200, mass=0.6 in PopWords and
        // damping=11, stiffness=220, mass=0.5 in SingleWord; we use the
        // PopWords values as the unified default.
        spring: z
          .object({
            damping: z.number().positive().default(12),
            stiffness: z.number().positive().default(200),
            mass: z.number().positive().default(0.6),
          })
          .default({}),
      })
      .default({}),
  })
  .default({});

export type StyleSpec = z.infer<typeof StyleSpecSchema>;
