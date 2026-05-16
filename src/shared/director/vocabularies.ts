// Director closed vocabularies — the bullet lists the planner prompt sees
// and the Zod enums the schema validates against. Keeping them as const
// arrays lets us derive the runtime Zod enum AND the TypeScript union from
// a single declaration. The planner prompt template iterates the same lists
// so drift between prompt and schema is impossible.
//
// Adding a value to any of these is the same 1-line change across the
// codebase. Removing one is a breaking change for any saved DirectorScript.

import { z } from 'zod';

// ---------------------------------------------------------------------------
// GROUP_ROLES — functional category the planner assigns to each scene group.
// Drives ROLE_DEFAULTS (layout/size/casing fallback) and the timeline pill's
// color family. Closed set; the planner cannot invent a new role.

export const GROUP_ROLES = [
  'intro-hook',           // Opening 1-3 seconds: grab attention, declare premise
  'hero-title-card',      // Big anchored title introducing the topic
  'backstory-beat',       // Narrative context, often slower-paced
  'enumerated-list',      // "First... Second... Third..." — list role
  'stat-callout',         // Numeric punch-line ("$42K in revenue", "27%")
  'pull-quote',           // Verbatim quote, often centered with editorial weight
  'pov-shift',            // Speaker / perspective change — visual reset
  'comparison-pair',      // Before-vs-after, this-vs-that, two-column-ish
  'cta-overlay',          // Final ask / link / button-like call to action
  'outro',                // Closing beat, often a sign-off
] as const;

export type GroupRole = (typeof GROUP_ROLES)[number];
export const groupRoleSchema = z.enum(GROUP_ROLES);

// Role families — drive timeline pill color. Tighter than the role set so
// the eye reads function before identity.
export const ROLE_FAMILIES = {
  structural: ['intro-hook', 'hero-title-card', 'outro'] as const,
  narrative: ['backstory-beat', 'pov-shift'] as const,
  enumerative: ['enumerated-list', 'stat-callout', 'comparison-pair'] as const,
  editorial: ['pull-quote'] as const,
  interactive: ['cta-overlay'] as const,
} satisfies Record<string, readonly GroupRole[]>;

export type RoleFamily = keyof typeof ROLE_FAMILIES;

export function roleFamily(role: GroupRole): RoleFamily {
  for (const [family, roles] of Object.entries(ROLE_FAMILIES)) {
    if ((roles as readonly string[]).includes(role)) return family as RoleFamily;
  }
  // Exhaustiveness: the type system would have caught a missing role at
  // build time, but the explicit throw protects against runtime drift if
  // ROLE_FAMILIES is edited without keeping sync with GROUP_ROLES.
  throw new Error(`roleFamily: no family registered for role "${role}"`);
}

// ---------------------------------------------------------------------------
// LAYOUT_STRATEGIES — closed set of layout shapes the renderer knows about.
// Mirrors stylepackSchema.layoutConfigSchema's discriminated union literals.
// `rendererReady` flags which are wired today; the agent's tool layer
// (Day 9) uses this to steer the planner away from forward-compat ids.

export const LAYOUT_STRATEGIES = [
  'cascade-stack',
  'single-line-flow',
  'lower-third',          // a.k.a. bottom-anchor in the spec
  'karaoke-row',
  'centered-pop',
  'top-banner',
  'two-column-split',
  'free-positioned',
] as const;

export type LayoutStrategyId = (typeof LAYOUT_STRATEGIES)[number];
export const layoutStrategyIdSchema = z.enum(LAYOUT_STRATEGIES);

// v1 renderer-wired ids. Days 3-4 covered the first two non-cascade ones.
export const RENDERER_READY_STRATEGIES: ReadonlySet<LayoutStrategyId> = new Set([
  'cascade-stack',
  'single-line-flow',
  'lower-third',
]);

// ---------------------------------------------------------------------------
// SONIC_GESTURES — felt-impact descriptors the planner attaches to scene
// groups or individual beats. Maps to BOTH motion params (SONIC_MOTION_MAP
// in sonicMap.ts) and audio sample lookups (SAMPLE_LIBRARY, week 4 audio
// FX work). The vocabulary is physical-intuitive so the agent can reach
// for "thud" without learning sound-engineering jargon.

export const SONIC_GESTURES = [
  'thud',      'slam',     'pop',     'click',
  'whoosh',    'swipe',    'rise',    'drop',
  'shimmer',   'rumble',   'sizzle',  'flutter',
  'snap',      'sigh',     'whisper', 'tick',
] as const;

export type SonicGesture = (typeof SONIC_GESTURES)[number];
export const sonicGestureSchema = z.enum(SONIC_GESTURES);

// ---------------------------------------------------------------------------
// AUDIO_PATTERN_TYPES — group-level repeating patterns (the named hard case
// from the spec is the typewriter typing sequence). One audio cue → one
// pattern type → many <Audio> instances expanded at render time.

export const AUDIO_PATTERN_TYPES = [
  'typewriter',
  'tick-per-word',
  'sustained-drone',
  'rise-build',
] as const;

export type AudioPatternType = (typeof AUDIO_PATTERN_TYPES)[number];
export const audioPatternTypeSchema = z.enum(AUDIO_PATTERN_TYPES);

// ---------------------------------------------------------------------------
// CASING — re-declared here so the schema can validate it without depending
// on the renderer's local enum. Matches the renderer's `EffectiveCasing`.

export const CASINGS = ['none', 'uppercase', 'lowercase'] as const;
export type Casing = (typeof CASINGS)[number];
export const casingSchema = z.enum(CASINGS);

// ---------------------------------------------------------------------------
// MOTION_PRESETS — entry-animation specs ported from the pixel-point
// `animate-text` catalog. Each id resolves to a portable keyframe spec in
// remotion/src/lib/animationPresets.ts (MODE_SPECS) at render time. The
// names are duplicated here so the director schema can validate without
// depending on the renderer bundle.

export const MOTION_PRESETS = [
  'spring-scale-in',     // iOS-icon overshoot, per-word
  'soft-blur-in',        // Apple per-character blur fade
  'per-character-rise',  // tvOS crisp letter rise
  'per-word-crossfade',  // calm keynote rhythm, per-word (default)
  'shimmer-sweep',       // whole-headline horizontal glide
  'bottom-up-letters',   // pronounced per-letter staircase
  'focus-blur-resolve',  // cinematic blur → crisp focus pull
] as const;

export type MotionPreset = (typeof MOTION_PRESETS)[number];
export const motionPresetSchema = z.enum(MOTION_PRESETS);
