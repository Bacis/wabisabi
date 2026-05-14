// Minimal effect registry — the seam Phase 4's typed StyleSpec schema reads
// to generate the discriminated `effectAssignmentSchema`. Keeping it tight
// for now (id + kind + sensible default intensity); the full Effect<P>
// interface (with per-effect Zod schemas, descriptors, and render functions)
// arrives when Phase 9 collapses ReelClone's branching switch into a single
// `switch (effect.kind)` over the registry.

import type { Vol03Effect } from './svgFilters';

export type EffectKind =
  | 'none'           // explicit "no effect"
  | 'per-letter'     // splits the word, returns { transform, opacity } per letter
  | 'per-word'       // single span, returns CSS fragments
  | 'svg-filter'     // emits a <filter> def, applied via `filter: url(#id)`
  | 'structural';    // owns the whole word render (e.g. SliceWord)

export type EffectId =
  | 'none'
  | 'samba' | 'crystal' | 'magnetic'         // per-letter (Vol.02)
  | 'breathe' | 'flare'                       // per-word (Vol.02)
  | 'resonance' | 'plasma' | 'inflation' | 'ferro' | 'shockwave'  // svg-filter (Vol.03)
  | 'slice';                                  // structural

export type EffectDescriptor = {
  id: EffectId;
  kind: EffectKind;
  // Family hint for the agent — separates the Vol.02 character-level kit
  // from the Vol.03 dramatic body-motion kit so prompts can reason by mood.
  family: 'vol02' | 'vol03' | 'none';
  defaultIntensity: number;
};

export const EFFECT_DESCRIPTORS: Record<EffectId, EffectDescriptor> = {
  none:      { id: 'none',      kind: 'none',         family: 'none',  defaultIntensity: 0 },
  samba:     { id: 'samba',     kind: 'per-letter',   family: 'vol02', defaultIntensity: 0.5 },
  crystal:   { id: 'crystal',   kind: 'per-letter',   family: 'vol02', defaultIntensity: 0.5 },
  magnetic:  { id: 'magnetic',  kind: 'per-letter',   family: 'vol02', defaultIntensity: 0.5 },
  breathe:   { id: 'breathe',   kind: 'per-word',     family: 'vol02', defaultIntensity: 0.5 },
  flare:     { id: 'flare',     kind: 'per-word',     family: 'vol02', defaultIntensity: 0.5 },
  resonance: { id: 'resonance', kind: 'svg-filter',   family: 'vol03', defaultIntensity: 0.5 },
  plasma:    { id: 'plasma',    kind: 'svg-filter',   family: 'vol03', defaultIntensity: 0.5 },
  inflation: { id: 'inflation', kind: 'svg-filter',   family: 'vol03', defaultIntensity: 0.5 },
  ferro:     { id: 'ferro',     kind: 'svg-filter',   family: 'vol03', defaultIntensity: 0.5 },
  shockwave: { id: 'shockwave', kind: 'svg-filter',   family: 'vol03', defaultIntensity: 0.5 },
  slice:     { id: 'slice',     kind: 'structural',   family: 'vol03', defaultIntensity: 0.6 },
};

export const EFFECT_IDS: ReadonlyArray<EffectId> =
  Object.keys(EFFECT_DESCRIPTORS) as ReadonlyArray<EffectId>;

export const PER_LETTER_EFFECT_IDS: ReadonlyArray<EffectId> =
  EFFECT_IDS.filter((id) => EFFECT_DESCRIPTORS[id].kind === 'per-letter');

export const SVG_FILTER_EFFECT_IDS: ReadonlyArray<Vol03Effect> =
  ['resonance', 'plasma', 'inflation', 'ferro', 'shockwave'];

export function getEffectKind(id: string | undefined | null): EffectKind {
  if (!id) return 'none';
  const desc = EFFECT_DESCRIPTORS[id as EffectId];
  return desc ? desc.kind : 'none';
}

export function isKnownEffect(id: string | undefined | null): id is EffectId {
  return typeof id === 'string' && id in EFFECT_DESCRIPTORS;
}
