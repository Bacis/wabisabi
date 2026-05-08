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
  // When true, the editor's /presets list filters this out — used for
  // server-only presets the producer pipeline / Telegram bot pick by id
  // (the story-* set) but that would just be clutter in the editor's
  // preset picker. Producer code accesses PRESETS directly, so it still
  // sees them.
  hidden?: boolean;
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

  // ------------------------------------------------------------------
  // Story-mode presets. Designed for narrated_story productions where
  // captions sit on top of silent b-roll. They all share:
  //   - 6-color palette on emphasisFill (cycles per chunk)
  //   - Wider layout (more words per line, smaller safeMargin, bigger padding)
  //   - Larger strokeWidth for readability over varied footage
  // The producer picks one deterministically from the production id when
  // the user didn't specify a preset (see producerPipeline.ts).
  // ------------------------------------------------------------------

  'story-rainbow': {
    id: 'story-rainbow',
    hidden: true,
    name: 'Story — Rainbow',
    description:
      'Wide, punchy layout for narrated shorts. 6-color palette cycles per chunk (coral, cyan, gold, lilac, mint, orange). Bold pop animation, uppercase.',
    templateId: 'pop-words',
    styleSpec: {
      font: { weight: 900, size: 64, textTransform: 'uppercase', letterSpacing: 1 },
      color: {
        fill: '#ffffff',
        stroke: '#0b0b18',
        strokeWidth: 10,
        emphasisFill: [
          '#ff3366', // coral
          '#00eaff', // cyan
          '#ffe14b', // gold
          '#9d4edd', // lilac
          '#06d6a0', // mint
          '#ff9e00', // orange
        ],
        shadow: { color: '#000000aa', blurPx: 14, offsetX: 0, offsetY: 4 },
      },
      layout: {
        position: 'bottom',
        safeMargin: 0.08,
        maxWordsPerLine: 5,
        padding: { x: 48, y: 14 },
        borderRadius: 24,
        gapRatio: 0.28,
      },
      animation: { preset: 'pop', emphasisScale: 1.22, durationMs: 140, tailMs: 250 },
    },
  },

  'story-sunset': {
    id: 'story-sunset',
    hidden: true,
    name: 'Story — Sunset',
    description:
      'Warm gradient fill (white → peach) with coral/amber/rose emphasis cycling. Slide-in animation, wide layout. Pairs with hopeful or nostalgic content.',
    templateId: 'pop-words',
    styleSpec: {
      font: { weight: 800, size: 62, textTransform: 'uppercase', letterSpacing: 0.5 },
      color: {
        fill: '#ffffff',
        stroke: '#2a0a1a',
        strokeWidth: 9,
        emphasisFill: ['#ff6b6b', '#ffb703', '#ff006e', '#fb5607'],
        fillGradient: {
          type: 'linear',
          angle: 180,
          stops: [
            { pos: 0, color: '#ffffff' },
            { pos: 1, color: '#ffd6a5' },
          ],
        },
        // Small warm drop shadow — not a halo. Keeps readability on sunsets.
        shadow: { color: '#7a1f1f66', blurPx: 8, offsetX: 0, offsetY: 4 },
      },
      layout: {
        position: 'bottom',
        safeMargin: 0.1,
        maxWordsPerLine: 5,
        padding: { x: 44, y: 12 },
        borderRadius: 20,
        gapRatio: 0.3,
      },
      animation: { preset: 'slide', emphasisScale: 1.18, durationMs: 180, tailMs: 220 },
    },
  },

  'story-cyberpunk': {
    id: 'story-cyberpunk',
    hidden: true,
    name: 'Story — Cyberpunk',
    description:
      'High-contrast cyan/magenta/acid-green palette on icy-white base. Karaoke animation lights each word as spoken. Wide layout, tech/sci-fi vibe. Subtle magenta accent glow behind emphasis words.',
    templateId: 'pop-words',
    styleSpec: {
      font: { weight: 900, size: 62, textTransform: 'uppercase', letterSpacing: 2 },
      color: {
        // Solid icy-white fill — no fillGradient. The gradient + heavy
        // glow + WebkitTextStroke + backgroundClip:text stack was fragile
        // in headless Chromium (glow washed out the letter interiors on
        // non-emphasis chunks), so we drop it and let the flat fill +
        // stroke + small glow do the talking.
        fill: '#eaf8ff',
        stroke: '#05010a',
        strokeWidth: 9,
        emphasisFill: ['#00f5d4', '#f15bb5', '#9b5de5', '#fee440', '#00bbf9'],
        // Small magenta accent — drop shadow, not halo. Low alpha, short
        // blur, small offset so it reads as a neon-glow hint but doesn't
        // saturate the letter interiors.
        shadow: { color: '#f15bb555', blurPx: 8, offsetX: 0, offsetY: 3 },
      },
      layout: {
        position: 'bottom',
        safeMargin: 0.1,
        maxWordsPerLine: 6,
        padding: { x: 52, y: 14 },
        borderRadius: 18,
        gapRatio: 0.26,
      },
      animation: { preset: 'karaoke', emphasisScale: 1.2, durationMs: 160, tailMs: 260 },
    },
  },

  'story-editorial': {
    id: 'story-editorial',
    hidden: true,
    name: 'Story — Editorial (Hopecore)',
    description:
      'Editorial serif with dramatic per-word size variance. Emphasis words render HUGE in uppercase, filler words shrink to small italic — think vintage magazine spread. Subtle per-chunk rotation. Best default for narrated b-roll shorts.',
    templateId: 'pop-words',
    styleSpec: {
      // mode: "editorial" tells StoryComposition to use the
      // HopecoreCaptionLayer instead of the classic flex-row CaptionLayer.
      layout: {
        mode: 'editorial',
        safeMargin: 0.05,
        maxWordsPerLine: 5,
      },
      font: {
        // Size is the BASE for filler/medium words — emphasis words are
        // drawn at ~2.8× this by the editorial layer. 60 keeps filler
        // legible while leaving room for huge emphasis words to dominate.
        family: 'Playfair Display',
        size: 60,
        weight: 900,
        textTransform: 'none',
        letterSpacing: 0,
      },
      color: {
        fill: '#ffffff',
        stroke: '#0b0710',
        strokeWidth: 12,
        // Primary magenta with cyan/gold accents — same energy as the
        // ig.mp4 reference.
        emphasisFill: ['#ff2bd6', '#00eaff', '#ff2bd6', '#ffe14b', '#ff2bd6'],
      },
      animation: {
        preset: 'pop',
        durationMs: 140,
        tailMs: 280,
      },
    },
  },

  'story-typewriter': {
    id: 'story-typewriter',
    hidden: true,
    name: 'Story — Typewriter',
    description:
      'Monospace typewriter reveal: words appear one at a time. Paper-white base with warm-amber/teal emphasis cycling, subtle drop shadow, medium width.',
    templateId: 'pop-words',
    styleSpec: {
      font: { weight: 800, size: 58, textTransform: 'none', letterSpacing: 1 },
      color: {
        fill: '#fefae0',
        stroke: '#1a1a1a',
        strokeWidth: 8,
        emphasisFill: ['#ffb703', '#2a9d8f', '#e76f51', '#264653'],
        shadow: { color: '#000000aa', blurPx: 10, offsetX: 3, offsetY: 5 },
      },
      layout: {
        position: 'bottom',
        safeMargin: 0.1,
        maxWordsPerLine: 6,
        padding: { x: 40, y: 12 },
        borderRadius: 8,
        gapRatio: 0.3,
      },
      animation: { preset: 'typewriter', emphasisScale: 1.15, durationMs: 140, tailMs: 240 },
    },
  },
};

// Narrated_story default rotation — picks one deterministically from
// production id when the user didn't pass a preset. Deliberately excludes
// minimal/classic (the user asked for VARIETY, not "safe default").
// The editorial (hopecore) layer is the default for narrated videos —
// matches the reference aesthetic the user asked for. Classic
// flex-row presets remain available via explicit presetId.
export const NARRATED_STORY_DEFAULT_PRESETS: readonly string[] = [
  'story-editorial',
];

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
