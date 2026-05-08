import type { StyleSpec } from './styleSpec.js';

// Named presets that bundle a templateId with a partial StyleSpec. The API
// merges the preset over the StyleSpec defaults, then merges the user's own
// overrides on top of that — so a user can pick `preset: "tiktok-pop"` and
// optionally tweak just one field (e.g. swap the emphasis color).
//
// Adding a new preset is one entry in this object. The viewer page picks up
// the description and templateId from `GET /presets` automatically.
export type TemplateId = 'pop-words' | 'reel-clone';

export type Preset = {
  id: string;
  name: string;
  description: string;
  templateId: TemplateId;
  styleSpec: DeepPartial<StyleSpec>;
};

// Helper type — Partial<T> only goes one level deep, but our StyleSpec has
// nested groups (font/color/layout/animation) that we want to override
// individually.
type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

export const PRESETS: Record<string, Preset> = {
  classic: {
    id: 'classic',
    name: 'Classic',
    description:
      'Balanced TikTok-style: bold white text, yellow emphasis, 4 words per line. Good default for most videos.',
    templateId: 'pop-words',
    styleSpec: {
      font: { weight: 800, size: 72, textTransform: 'uppercase' },
      color: {
        fill: '#ffffff',
        stroke: '#000000',
        strokeWidth: 8,
        emphasisFill: '#ffe14b',
      },
      layout: { position: 'bottom', safeMargin: 0.15, maxWordsPerLine: 4 },
      animation: { preset: 'pop', emphasisScale: 1.15, durationMs: 120 },
    },
  },
  // Cinematic — the latest reel-clone styleSpec, OCR-derived from the
  // reference Instagram reel. Position-aware emphasis: anchor words render as
  // white uppercase blocks; mid-stack emphasis stays inline-colored (yellow /
  // red). Cascading sizes top→bottom, progressive word-by-word reveal,
  // left-aligned. The id ends in '-default' so the editor's pickDefaultPreset
  // helper auto-applies it on a fresh reel-clone job.
  'reel-clone-default': {
    id: 'reel-clone-default',
    name: 'Cinematic',
    description:
      'Bold Inter Black with yellow + red inline emphasis and white uppercase block anchors. Cascading sizes, progressive word-by-word reveal, left-aligned.',
    templateId: 'reel-clone',
    styleSpec: {
      font: {
        family: 'Inter',
        weight: 900,
        size: 234,
        letterSpacing: -2,
        textTransform: 'lowercase',
      },
      color: {
        fill: '#ffffff',
        strokeWidth: 0,
        emphasisFill: ['#ffd700', '#ff2a2a'],
      },
      layout: {
        position: 'bottom',
        safeMargin: 0.18,
        maxWordsPerLine: 3,
        align: 'left',
      },
      // Empirically measured char-advance for Inter Black at letterSpacing=-2.
      charAdvance: 0.558,
      animation: {
        preset: 'karaoke',
        tailMs: 200,
        scaleFrom: 0.7,
        durationMs: 140,
      },
      reel: {
        emphasisStyle: 'block',
        emphasisFillRatio: 0.75,
        emphasisMaxHeightRatio: 0.16,
        fillerSizeMultiplier: 1,
        emphasisTextTransform: 'uppercase',
        fillerTextTransform: 'lowercase',
        mediumTextTransform: 'lowercase',
        emphasisWeight: 900,
        wordReveal: 'progressive',
        // Auto-flag emphasis words from the transcript when the caption
        // plan has none. Required for the editor's live preview — the
        // enrich step only runs server-side at render time, so the editor
        // is otherwise emphasis-less and themes (primary/secondary tiers)
        // never fire.
        inferEmphasis: true,
        columnGapRatio: 0.18,
        rowGapRatio: 0.04,
        maxWidthPercent: 80,
        paddingPercent: 6,
        // Top-down cascade: anchor (big) sits on top, lines below taper
        // smaller. Swap these two values to invert.
        cascadeTopRatio: 1,
        cascadeBottomRatio: 0.47,
        multiColorEmphasis: true,
        // ~6% of qualifying long emphasis words rendered italic. The
        // renderer hashes each candidate word and italicizes the matching
        // fraction — works on any transcript.
        italicAccentRate: 0.057,
      },
    },
  },
};

// Two-level deep merge for StyleSpec-shaped objects. The top level is keys
// like font/color/layout/animation; each value is a flat object. We don't
// need full recursion — that would also incorrectly merge any nested array
// or primitive that might be added in future.
export function mergeStyleSpec(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const key of Object.keys(override)) {
    const baseVal = base[key];
    const overrideVal = override[key];
    if (
      baseVal &&
      typeof baseVal === 'object' &&
      !Array.isArray(baseVal) &&
      overrideVal &&
      typeof overrideVal === 'object' &&
      !Array.isArray(overrideVal)
    ) {
      out[key] = { ...(baseVal as object), ...(overrideVal as object) };
    } else if (overrideVal !== undefined) {
      out[key] = overrideVal;
    }
  }
  return out;
}
