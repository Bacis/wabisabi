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

import type { Casing, GroupRole, LayoutStrategyId } from './vocabularies.js';
import { GROUP_ROLES } from './vocabularies.js';

export type RoleDefault = {
  layoutStrategy: LayoutStrategyId;
  casing: Casing;
  sizeMultiplier: number;
};

export const ROLE_DEFAULTS = {
  'intro-hook':       { layoutStrategy: 'single-line-flow', casing: 'none',      sizeMultiplier: 1.0 },
  'hero-title-card':  { layoutStrategy: 'cascade-stack',    casing: 'uppercase', sizeMultiplier: 1.2 },
  'backstory-beat':   { layoutStrategy: 'single-line-flow', casing: 'none',      sizeMultiplier: 0.9 },
  'enumerated-list':  { layoutStrategy: 'lower-third',      casing: 'none',      sizeMultiplier: 1.0 },
  'stat-callout':     { layoutStrategy: 'cascade-stack',    casing: 'uppercase', sizeMultiplier: 1.3 },
  'pull-quote':       { layoutStrategy: 'cascade-stack',    casing: 'none',      sizeMultiplier: 1.0 },
  'pov-shift':        { layoutStrategy: 'single-line-flow', casing: 'none',      sizeMultiplier: 0.95 },
  'comparison-pair':  { layoutStrategy: 'cascade-stack',    casing: 'uppercase', sizeMultiplier: 1.0 },
  'cta-overlay':      { layoutStrategy: 'lower-third',      casing: 'uppercase', sizeMultiplier: 1.1 },
  'outro':            { layoutStrategy: 'single-line-flow', casing: 'none',      sizeMultiplier: 1.0 },
} as const satisfies Record<GroupRole, RoleDefault>;

// Runtime sanity: every role in GROUP_ROLES must have a default. The
// `satisfies` clause above is build-time only; this guards against shipping
// a partial ROLE_DEFAULTS during a refactor.
for (const role of GROUP_ROLES) {
  if (!(role in ROLE_DEFAULTS)) {
    throw new Error(`ROLE_DEFAULTS missing entry for role "${role}"`);
  }
}
