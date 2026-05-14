// Reference-driven quality harness — shared types.
//
// A reference is a directory under tests/quality/references/<name>/ that
// contains:
//   - prompt.txt           the natural-language prompt sent to the planner
//   - expected.json        per-beat structural assertions
//   - annotations.json     human-readable beat catalog (for spec.md)
//   - source.mp4 (asset)   the visual reference clip (not asserted against)
//
// The harness runs each assertion against either (a) a mocked DirectorScript
// committed at harness/mocks/<name>-on-<target>.json (Tier 1, no LLM) or
// (b) a live planner response (Tier 2, real Sonnet call). Both paths feed
// the same grader so the assertion library is the single source of truth.

import type { DirectorScript, SceneGroup } from '../../../src/shared/director/schema.js';

export type Capability = 'shipped' | 'partial' | 'not-shipped';

export type GroupMatcher = {
  /** Match groups whose role is in this list. */
  roleIn?: string[];
  /** Match the group whose wordRange contains this word index. */
  wordRangeContains?: number;
};

export type Assertion =
  | { kind: 'role-in'; values: string[] }
  | { kind: 'placement-anchor'; equals: string }
  | { kind: 'placement-alignment'; equals: string }
  | { kind: 'max-per-line'; equals: number }
  | { kind: 'font-size-min'; min: number }
  | { kind: 'casing'; equals: string }
  | { kind: 'layout-strategy'; equals: string }
  | { kind: 'audio-pattern-type'; equals: string }
  | { kind: 'audio-cue-present' }
  | { kind: 'motion-preset-equals'; equals: string }
  | { kind: 'font-family-override'; anyOf: string[] };

export type BeatExpectation = {
  id: string;
  description: string;
  groupMatcher: GroupMatcher;
  assertions: Assertion[];
  capability: Capability;
  knownGapNote?: string;
};

export type GlobalExpectation = {
  id: string;
  kind: 'global';
  path: string;
  equals: unknown;
  capability: Capability;
};

export type ExpectedFile = {
  reference: string;
  target: string;
  globals: GlobalExpectation[];
  beats: BeatExpectation[];
};

export type BeatResult = {
  id: string;
  description: string;
  capability: Capability;
  passed: boolean;
  failed: { assertion: Assertion; reason: string }[];
  knownGapNote?: string;
};

export type GlobalResult = {
  id: string;
  capability: Capability;
  passed: boolean;
  reason?: string;
};

export type GradeResult = {
  reference: string;
  target: string;
  source: 'mocked' | 'live';
  script: DirectorScript;
  globals: GlobalResult[];
  beats: BeatResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    knownGaps: number;
  };
};

export type { DirectorScript, SceneGroup };
