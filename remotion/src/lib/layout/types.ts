// Layout-strategy interface. Day 1 of the Director engine refactor.
//
// Today the renderer calls `layoutCascadeStack` directly at ReelClone.tsx:370.
// This file introduces a uniform shape every layout strategy must implement
// so the renderer can lookup-and-call without knowing which strategy is in
// use. Day 2 wraps the existing cascadeStack into this shape via a registry
// and points ReelClone at the lookup. Days 3-4 add single-line-flow and
// bottom-anchor as the first non-cascade strategies.
//
// Design notes:
//   * `LayoutStrategyId` mirrors the discriminated union literals in
//     src/shared/pipeline/stylepackSchema.ts (layoutConfigSchema). The
//     stylepack schema is the agent-side input shape; this file is the
//     renderer-side output shape. They must agree on the id set.
//   * `params` on the interface is `unknown` because every strategy resolves
//     its own typed param object at render time (e.g. CascadeStackParams).
//     The renderer constructs the typed object before the call; the strategy
//     adapter casts it back. This keeps the interface uniform without
//     forcing a sum-typed param at the interface layer.
//   * `LayoutPlan` / `LayoutLine` / `LayoutEntry` are re-exported from
//     cascadeStack.ts for now. Once Day 5 generalizes the position model,
//     these may grow `yOffset` / `placement` fields and diverge from the
//     cascade-stack shape. Day 1 keeps them aligned so cascade-stack wraps
//     byte-faithfully.

import type {
  CascadeStackInput,
  LayoutEntry,
  LayoutLine,
  LayoutPlan,
} from './cascadeStack';

export type { LayoutEntry, LayoutLine, LayoutPlan };

// ---------------------------------------------------------------------------
// LayoutStrategyId — closed set, mirrors stylepackSchema.layoutConfigSchema.

export const LAYOUT_STRATEGY_IDS = [
  'cascade-stack',
  'single-line-flow',
  'karaoke-row',
  'centered-pop',
  'top-banner',
  'lower-third',
  'two-column-split',
  'free-positioned',
] as const;

export type LayoutStrategyId = (typeof LAYOUT_STRATEGY_IDS)[number];

// ---------------------------------------------------------------------------
// StrategyInput — common renderer-side input every strategy receives.
//
// Generalized from CascadeStackInput. Today identical except for the
// addition of `frameWidth` (cascade-stack ignores it; future strategies
// like two-column-split will need it for horizontal partition math).

export type StrategyInput = CascadeStackInput & {
  frameWidth: number;
};

// ---------------------------------------------------------------------------
// LayoutStrategy — the interface.

export type LayoutStrategy = {
  id: LayoutStrategyId;
  // Render-time call. Params shape is strategy-specific; the renderer
  // constructs it before invoking. Day 2's registry registers a cascade-stack
  // adapter that casts to CascadeStackParams.
  computeLayout(input: StrategyInput, params: unknown): LayoutPlan;
};

// ---------------------------------------------------------------------------
// PositionedLine — forward-looking alias of LayoutLine. Days 3-5 will grow
// per-line placement fields (yOffset, alignment, baseline anchor) onto
// LayoutLine as new strategies emit them; cascade-stack will ignore them.
// Day 1 keeps PositionedLine ≡ LayoutLine so nothing breaks yet.

export type PositionedLine = LayoutLine;

// ---------------------------------------------------------------------------
// WordContext — what `resolveWordContext` will produce per word once the
// DirectorScript schema lands on Day 6. Day 1 declares the shape so the
// renderer can start importing it; the actual cascade walk
// (project → ROLE_DEFAULTS[role] → group.overrides → beat.overrides) is
// implemented in src/shared/director/resolveWordContext.ts (signature
// stub today; full impl on Day 5 once Days 3-4 prove the strategy interface).
//
// Per-word fields are the *effective* values — what the renderer should
// honor for this word, after all cascade layers have voted. `resolvedFrom`
// tracks which layer won so the agent UI can explain "this word is yellow
// because the group sets emphasisFill to yellow."

export type EffectiveCasing = 'none' | 'uppercase' | 'lowercase';

export type ResolutionSource =
  | 'project'
  | 'role-default'
  | 'group-override'
  | 'beat-override';

export type WordContext = {
  wordIdx: number;
  effectiveFill: string;
  effectiveSize: number;
  effectiveFont: string;
  effectiveCasing: EffectiveCasing;
  effectiveEffect: string;     // EffectId once schema lands; broadened today
  effectiveIntensity: number;
  resolvedFrom: ResolutionSource;
};
