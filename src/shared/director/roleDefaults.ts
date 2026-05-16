// Per-role layout/typography defaults. Day 6 of the Director feature.
//
// When a SceneGroup omits an override (layout, casing, sizeMultiplier),
// the cascade in resolveWordContext consults this table next. The planner
// authors a group as "this is an enumerated-list, give it the list defaults
// unless I say otherwise" — keeping the script terse and the per-role
// design language consistent.
//
// Edit values here to change the look of every group of that role across
// the app. New roles must add an entry; the satisfies clause below makes
// the build fail until they do.

import type { Casing, GroupRole, LayoutStrategyId, MotionPreset } from './vocabularies.js';
import { GROUP_ROLES } from './vocabularies.js';

export type RoleDefault = {
  layoutStrategy: LayoutStrategyId;
  casing: Casing;
  sizeMultiplier: number;
  // Entry animation preset for words in this group. Each role gets a
  // distinct preset so a multi-group reel naturally reads as a sequence
  // of different visual languages (cinematic title → keynote backstory
  // → crisp list → stat pop → quote blur, etc.). Planners can still
  // override per group via group.overrides.motionPreset.
  motionPreset: MotionPreset;
};

export const ROLE_DEFAULTS = {
  'intro-hook':       { layoutStrategy: 'single-line-flow', casing: 'none',      sizeMultiplier: 1.0,  motionPreset: 'shimmer-sweep' },
  'hero-title-card':  { layoutStrategy: 'cascade-stack',    casing: 'uppercase', sizeMultiplier: 1.2,  motionPreset: 'focus-blur-resolve' },
  'backstory-beat':   { layoutStrategy: 'single-line-flow', casing: 'none',      sizeMultiplier: 0.9,  motionPreset: 'per-word-crossfade' },
  'enumerated-list':  { layoutStrategy: 'lower-third',      casing: 'none',      sizeMultiplier: 1.0,  motionPreset: 'per-character-rise' },
  'stat-callout':     { layoutStrategy: 'cascade-stack',    casing: 'uppercase', sizeMultiplier: 1.3,  motionPreset: 'spring-scale-in' },
  'pull-quote':       { layoutStrategy: 'cascade-stack',    casing: 'none',      sizeMultiplier: 1.0,  motionPreset: 'soft-blur-in' },
  'pov-shift':        { layoutStrategy: 'single-line-flow', casing: 'none',      sizeMultiplier: 0.95, motionPreset: 'per-word-crossfade' },
  'comparison-pair':  { layoutStrategy: 'cascade-stack',    casing: 'uppercase', sizeMultiplier: 1.0,  motionPreset: 'bottom-up-letters' },
  'cta-overlay':      { layoutStrategy: 'lower-third',      casing: 'uppercase', sizeMultiplier: 1.1,  motionPreset: 'spring-scale-in' },
  'outro':            { layoutStrategy: 'single-line-flow', casing: 'none',      sizeMultiplier: 1.0,  motionPreset: 'soft-blur-in' },
} as const satisfies Record<GroupRole, RoleDefault>;

// Runtime sanity: every role in GROUP_ROLES must have a default. The
// `satisfies` clause above is build-time only; this guards against shipping
// a partial ROLE_DEFAULTS during a refactor.
for (const role of GROUP_ROLES) {
  if (!(role in ROLE_DEFAULTS)) {
    throw new Error(`ROLE_DEFAULTS missing entry for role "${role}"`);
  }
}
