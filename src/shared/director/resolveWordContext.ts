// Director cascading style resolver — signature stub (Day 1).
//
// Full implementation lands on Day 5 once the DirectorScript Zod schema
// (Day 6) declares ProjectInvariants, SceneGroup, CaptionBeat, and the
// ROLE_DEFAULTS lookup. The walk order is:
//
//   project invariants → ROLE_DEFAULTS[group.role] → group.overrides → beat.overrides
//
// Last layer wins per field. `resolvedFrom` on the returned WordContext
// tracks which layer voted, so the agent UI can explain why a word renders
// the way it does ("this word is yellow because the beat overrides project
// invariants").
//
// Today this file declares the function signature only. The Day 5 PR
// fills in the body and replaces this stub with a tested cascade walk.

// Forward declarations of the shapes the cascade reads. These will be
// imported from `./schema.ts` once Day 6 lands; declared inline for Day 1
// so the renderer can start importing WordContext without a circular dep.

export type ProjectInvariants = {
  // Day 6 fills in the full shape. Minimal stub:
  fill?: string;
  font?: string;
  fontSize?: number;
  casing?: 'none' | 'uppercase' | 'lowercase';
  defaultEffect?: string;
  defaultIntensity?: number;
};

export type SceneGroup = {
  id: string;
  role: string;             // GROUP_ROLES enum once Day 6 lands
  wordRange: [number, number];
  overrides?: Partial<ProjectInvariants>;
  // Day 6 will add: layoutStrategy, placement, audioCue, audioPattern, ...
};

export type CaptionBeat = {
  id: string;
  groupId: string;
  wordRange: [number, number];
  overrides?: Partial<ProjectInvariants>;
};

export type DirectorScriptLike = {
  project: ProjectInvariants;
  groups: SceneGroup[];
  beats: CaptionBeat[];
};

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
  effectiveEffect: string;
  effectiveIntensity: number;
  group: SceneGroup | null;
  beat: CaptionBeat | null;
  resolvedFrom: ResolutionSource;
};

// ---------------------------------------------------------------------------
// Signature stub. Day 5 replaces this with the real cascade walk + Vitest
// suite. The throw is intentional so any premature renderer integration
// fails loudly rather than silently using stale data.

export function resolveWordContext(
  _script: DirectorScriptLike,
  _wordIdx: number,
): WordContext {
  throw new Error('resolveWordContext: not implemented yet (Day 5 deliverable)');
}
