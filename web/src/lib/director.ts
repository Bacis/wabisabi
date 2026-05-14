// Web-side mirror of src/shared/director/. Plain TypeScript types and
// the role-family color map — no Zod, no LangGraph deps, no server imports.
// The shapes mirror src/shared/director/schema.ts; if you add a field
// there, mirror it here. CI checks won't catch drift, but the runtime
// schema rejects unknowns at the wire boundary so client-side data we
// don't recognize is already filtered out.

// Mirror of GROUP_ROLES from src/shared/director/vocabularies.ts. Declared
// as a runtime tuple so the role-change UI can iterate over the closed
// set without reaching into server code (no shared-runtime build today).
export const GROUP_ROLES_LIST = [
  'intro-hook',
  'hero-title-card',
  'backstory-beat',
  'enumerated-list',
  'stat-callout',
  'pull-quote',
  'pov-shift',
  'comparison-pair',
  'cta-overlay',
  'outro',
] as const;

export type GroupRole = (typeof GROUP_ROLES_LIST)[number];

export type SonicGesture =
  | 'thud' | 'slam' | 'pop' | 'click'
  | 'whoosh' | 'swipe' | 'rise' | 'drop'
  | 'shimmer' | 'rumble' | 'sizzle' | 'flutter'
  | 'snap' | 'sigh' | 'whisper' | 'tick';

export type LayoutStrategyId =
  | 'cascade-stack'
  | 'single-line-flow'
  | 'lower-third'
  | 'karaoke-row'
  | 'centered-pop'
  | 'top-banner'
  | 'two-column-split'
  | 'free-positioned';

export type WordRange = [number, number];

export type Placement = {
  anchor: 'top' | 'middle' | 'bottom' | 'baseline-lower-third';
  alignment?: 'left' | 'center' | 'right';
  offsetY?: number;
  offsetX?: number;
};

export type AudioCue = { gesture: SonicGesture; volume?: number; offsetMs?: number };

export type AudioPattern = {
  type: 'typewriter' | 'tick-per-word' | 'sustained-drone' | 'rise-build';
  params?: {
    sampleSet?: string;
    intervalMs?: number;
    volume?: number;
    pitchVariation?: number;
  };
};

export type StyleOverride = {
  fill?: string;
  emphasisFill?: string;
  font?: string;
  fontSize?: number;
  casing?: 'none' | 'uppercase' | 'lowercase';
  effect?: string;
  intensity?: number;
};

export type ProjectInvariants = {
  fill: string;
  emphasisFill: string;
  font: string;
  fontSize: number;
  casing: 'none' | 'uppercase' | 'lowercase';
  defaultEffect: string;
  defaultIntensity: number;
};

export type SceneGroup = {
  id: string;
  role: GroupRole;
  wordRange: WordRange;
  label?: string;
  layoutStrategy?: LayoutStrategyId;
  layoutParams?: Record<string, unknown>;
  maxPerLine?: number;
  placement?: Placement;
  overrides?: StyleOverride;
  audioCue?: AudioCue;
  audioPattern?: AudioPattern;
  relation?:
    | { kind: 'cut' }
    | { kind: 'fade'; durationMs?: number }
    | { kind: 'morph-from-previous'; durationMs?: number };
  rationale?: string;
};

export type CaptionBeat = {
  id: string;
  groupId: string;
  wordRange: WordRange;
  overrides?: StyleOverride;
  audioCue?: AudioCue;
  relation?:
    | { kind: 'isolate' }
    | { kind: 'echo'; count?: number }
    | { kind: 'inline-italic' };
};

export type DirectorScript = {
  project: ProjectInvariants;
  groups: SceneGroup[];
  beats: CaptionBeat[];
};

// ---------------------------------------------------------------------------
// Role family + color mapping. Mirrors src/shared/director/vocabularies.ts
// ROLE_FAMILIES; the eye reads function before identity so the timeline pill
// + checklist row tint by family, not by individual role.

export type RoleFamily =
  | 'structural'
  | 'narrative'
  | 'enumerative'
  | 'editorial'
  | 'interactive';

const FAMILY_OF: Record<GroupRole, RoleFamily> = {
  'intro-hook': 'structural',
  'hero-title-card': 'structural',
  'outro': 'structural',
  'backstory-beat': 'narrative',
  'pov-shift': 'narrative',
  'enumerated-list': 'enumerative',
  'stat-callout': 'enumerative',
  'comparison-pair': 'enumerative',
  'pull-quote': 'editorial',
  'cta-overlay': 'interactive',
};

export function roleFamily(role: GroupRole): RoleFamily {
  return FAMILY_OF[role];
}

// Color triple per family — (border, fill16% alpha, text). Designed to read
// at-a-glance over the existing dark-grey chat card background.
export const FAMILY_COLORS: Record<RoleFamily, { border: string; fill: string; text: string }> = {
  structural:  { border: '#a78bfa55', fill: '#a78bfa16', text: '#c4b5fd' }, // violet/purple
  narrative:   { border: '#5eead455', fill: '#5eead416', text: '#5eead4' }, // teal
  enumerative: { border: '#fbbf2455', fill: '#fbbf2416', text: '#fbbf24' }, // amber
  editorial:   { border: '#f472b655', fill: '#f472b616', text: '#f472b6' }, // pink
  interactive: { border: '#60a5fa55', fill: '#60a5fa16', text: '#60a5fa' }, // blue
};

// 3-letter badge per role — used in the timeline pill. Day 16 will surface
// these alongside the user-facing label.
export const ROLE_BADGE: Record<GroupRole, string> = {
  'intro-hook': 'INTRO',
  'hero-title-card': 'TITLE',
  'backstory-beat': 'BACK',
  'enumerated-list': 'LIST',
  'stat-callout': 'STAT',
  'pull-quote': 'QUOTE',
  'pov-shift': 'POV',
  'comparison-pair': 'CMP',
  'cta-overlay': 'CTA',
  'outro': 'OUT',
};

// ---------------------------------------------------------------------------
// DirectorScript → StyleSpec patch.
//
// The renderer (remotion/src/templates/ReelClone.tsx) reads visual style
// from styleSpec. The Director planner emits a DirectorScript with project
// invariants and per-group overrides; we still need to fan those back
// into a styleSpec patch the renderer already knows how to consume.
//
// Day 10 wiring shipped the script into state + chat checklist + timeline
// lane but did NOT translate project invariants into styleSpec — captions
// kept rendering with the prior flat spec. This helper closes that gap.
//
// v1 scope:
//   * Project invariants → top-level styleSpec.color / styleSpec.font.
//   * Per-group overrides: NOT YET translated. They require a word→chunk
//     index mapping (captionPlan chunks span N words each), which is a
//     follow-up step. For now the renderer honors the project palette,
//     and the chunk-level emphasis selection still picks from it.

// Defense against the planner emitting a preset id (e.g. "interBlack") in
// project.font instead of a real CSS font family. The planner's open
// `font: z.string()` field tempts Sonnet to reach for vocabulary it saw
// in the agentChat tool surface; this map converts known preset ids back
// to the family + weight combo they encode. Unknown strings pass through
// (the schema can't enumerate every legitimate font name).
const FONT_PRESET_ID_TO_FAMILY: Record<string, string> = {
  interBlack: 'Inter',
  impactBold: 'Impact',
};

function normalizeFontFamily(name: string): string {
  return FONT_PRESET_ID_TO_FAMILY[name] ?? name;
}

export function directorScriptToStyleSpecPatch(
  script: DirectorScript,
): Record<string, unknown> {
  const p = script.project;
  return {
    font: {
      family: normalizeFontFamily(p.font),
      size: p.fontSize,
      textTransform: p.casing,
    },
    color: {
      fill: p.fill,
      emphasisFill: p.emphasisFill,
    },
  };
}

// ---------------------------------------------------------------------------
// Role → default layout strategy. Mirror of ROLE_DEFAULTS.layoutStrategy on
// the server (src/shared/director/roleDefaults.ts). The web translator uses
// these when a SceneGroup omits an explicit `layoutStrategy` override so
// each role still produces visually distinct captions per group.

export const ROLE_DEFAULT_LAYOUT: Record<GroupRole, LayoutStrategyId> = {
  'intro-hook': 'single-line-flow',
  'hero-title-card': 'cascade-stack',
  'backstory-beat': 'single-line-flow',
  'enumerated-list': 'lower-third',
  'stat-callout': 'cascade-stack',
  'pull-quote': 'cascade-stack',
  'pov-shift': 'single-line-flow',
  'comparison-pair': 'cascade-stack',
  'cta-overlay': 'lower-third',
  'outro': 'single-line-flow',
};

// Per-role size multipliers tuned for cinematic per-group differentiation.
// The baseline (1.0×) is the speaker-talk backstory voice — small, low-key.
// Hero / stat / CTA cards are 2.5×–3.0× the baseline so they read as
// chapter-card punctuation in the Jodie / Hormozi reel idiom. The renderer
// caps via maxSizeForWord so long words shrink automatically.
export const ROLE_DEFAULT_SIZE_MULT: Record<GroupRole, number> = {
  'intro-hook': 2.0,        // big title-card open
  'hero-title-card': 3.0,   // brand-name drop, dominates the frame
  'backstory-beat': 0.85,   // small, sit-back storytelling
  'enumerated-list': 1.3,   // taller than backstory so beats POP
  'stat-callout': 2.6,      // full-frame chapter punctuation
  'pull-quote': 1.8,        // editorial emphasis
  'pov-shift': 1.4,         // visual reset between sections
  'comparison-pair': 1.6,
  'cta-overlay': 2.2,       // strong closing call
  'outro': 1.5,
};

// Role family → caption alignment. Hero / stat / CTA chapter cards center
// to dominate the frame; backstory & list left-align to read as captions
// rather than title cards. Maps to styleSpec.layout.align which the
// renderer threads into placementToContainerStyle.
export const ROLE_DEFAULT_ALIGN: Record<GroupRole, 'left' | 'center' | 'right'> = {
  'intro-hook': 'center',
  'hero-title-card': 'center',
  'backstory-beat': 'left',
  'enumerated-list': 'left',
  'stat-callout': 'center',
  'pull-quote': 'center',
  'pov-shift': 'center',
  'comparison-pair': 'center',
  'cta-overlay': 'center',
  'outro': 'center',
};

// Role family → vertical anchor. Chapter cards center vertically so they
// command the frame; speaker callouts stay at the bottom safe area.
export const ROLE_DEFAULT_ANCHOR: Record<GroupRole, 'top' | 'middle' | 'bottom'> = {
  'intro-hook': 'middle',
  'hero-title-card': 'middle',
  'backstory-beat': 'bottom',
  'enumerated-list': 'bottom',
  'stat-callout': 'middle',
  'pull-quote': 'middle',
  'pov-shift': 'middle',
  'comparison-pair': 'middle',
  'cta-overlay': 'bottom',
  'outro': 'middle',
};

// Words per line per role. Chapter cards default to 1 word per line so
// "QUIT / HER / JOB" stacks fall out of the cascade naturally. Speaker
// callouts and lists keep wider lines.
export const ROLE_DEFAULT_MAX_PER_LINE: Record<GroupRole, number> = {
  'intro-hook': 1,
  'hero-title-card': 1,
  'backstory-beat': 4,
  'enumerated-list': 2,
  'stat-callout': 1,
  'pull-quote': 3,
  'pov-shift': 2,
  'comparison-pair': 2,
  'cta-overlay': 1,
  'outro': 2,
};

// Mirrors ROLE_DEFAULTS.casing on the server. Drives font.textTransform on
// the chunkOverride so title cards and CTAs render in uppercase while
// backstory beats stay sentence-case.
export const ROLE_DEFAULT_CASING: Record<GroupRole, 'none' | 'uppercase' | 'lowercase'> = {
  'intro-hook': 'none',
  'hero-title-card': 'uppercase',
  'backstory-beat': 'none',
  'enumerated-list': 'none',
  'stat-callout': 'uppercase',
  'pull-quote': 'none',
  'pov-shift': 'none',
  'comparison-pair': 'uppercase',
  'cta-overlay': 'uppercase',
  'outro': 'none',
};

export type ChunkOverridePatch = {
  range: [number, number];
  overrides: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Per-group chunk-override translator.
//
// Maps each SceneGroup's wordRange onto chunk indices (assuming the
// renderer's fallback chunker — fixed N words per chunk) and emits one
// chunkOverrides entry per group. The renderer reads these via
// resolveChunkStyle to swap layout strategy per active chunk so the
// hero-title-card / list / cta visibly render in different shapes.
//
// Today's coverage: layout strategy + explicit group.overrides (fill,
// emphasisFill, casing). Per-group fontSize multipliers from ROLE_DEFAULTS
// are intentionally NOT applied here — they'd reflow the cascade math on
// chunk transitions in ways that need more renderer work first.

export function directorScriptToChunkOverrides(
  script: DirectorScript,
  maxPerLine: number,
): ChunkOverridePatch[] {
  if (maxPerLine <= 0) return [];
  const projectFontSize = script.project.fontSize;
  return script.groups.map((g) => {
    const startChunk = Math.floor(g.wordRange[0] / maxPerLine);
    const endChunk = Math.floor(g.wordRange[1] / maxPerLine);
    const strategy = g.layoutStrategy ?? ROLE_DEFAULT_LAYOUT[g.role];
    const sizeMultiplier = ROLE_DEFAULT_SIZE_MULT[g.role];
    const casing = g.overrides?.casing ?? ROLE_DEFAULT_CASING[g.role];
    const baseSize = g.overrides?.fontSize ?? projectFontSize;
    // Honor explicit planner placement first; fall back to role defaults.
    const align = g.placement?.alignment ?? ROLE_DEFAULT_ALIGN[g.role];
    const anchor = g.placement?.anchor ?? ROLE_DEFAULT_ANCHOR[g.role];
    // Honor explicit per-group maxPerLine; fall back to role defaults.
    const groupMaxPerLine = g.maxPerLine ?? ROLE_DEFAULT_MAX_PER_LINE[g.role];
    // Per-role cascade-stack parameters. Chapter-card roles flatten the
    // cascade (1.0 / 1.0) so all stacked words land at the same large
    // size; speaker-callout roles keep the gentle taper.
    const isChapterCard =
      g.role === 'hero-title-card' || g.role === 'stat-callout' || g.role === 'pull-quote' || g.role === 'cta-overlay';
    const overrides: Record<string, unknown> = {
      reel: {
        layout: { strategy },
        ...(isChapterCard ? { cascadeTopRatio: 1.0, cascadeBottomRatio: 1.0, emphasisLineBreak: true } : {}),
      },
      font: {
        size: g.overrides?.fontSize ?? baseSize * sizeMultiplier,
        textTransform: casing,
      },
      layout: {
        align,
        position: anchor,
        maxWordsPerLine: groupMaxPerLine,
      },
    };
    // Carry explicit per-group color overrides through. Layered onto the
    // base styleSpec by resolveChunkStyle's two-level merge.
    const color: Record<string, unknown> = {};
    if (g.overrides?.fill) color.fill = g.overrides.fill;
    if (g.overrides?.emphasisFill) color.emphasisFill = g.overrides.emphasisFill;
    if (Object.keys(color).length > 0) overrides.color = color;
    return { range: [startChunk, endChunk] as [number, number], overrides };
  });
}
