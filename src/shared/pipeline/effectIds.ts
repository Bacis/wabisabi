// Backend-safe canonical list of effect ids the agent + schema reason
// about. Mirrors the runtime registry at remotion/src/lib/fx/registry.ts —
// kept duplicated because the backend (NodeNext resolution) cannot import
// from remotion's src/ tree (Bundler resolution). If you add an effect,
// update both files; the registry test will fail loud if they drift.

export const EFFECT_IDS = [
  'none',
  'samba', 'crystal', 'magnetic',
  'breathe', 'flare',
  'resonance', 'inflation', 'ferro', 'shockwave',
  'slice',
] as const;

export type EffectId = (typeof EFFECT_IDS)[number];

export const EFFECT_KIND_BY_ID: Record<EffectId, 'none' | 'per-letter' | 'per-word' | 'svg-filter' | 'structural'> = {
  none: 'none',
  samba: 'per-letter',
  crystal: 'per-letter',
  magnetic: 'per-letter',
  breathe: 'per-word',
  flare: 'per-word',
  resonance: 'svg-filter',
  inflation: 'svg-filter',
  ferro: 'svg-filter',
  shockwave: 'svg-filter',
  slice: 'structural',
};
