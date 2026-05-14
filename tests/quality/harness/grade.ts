// Pure grading function: given a DirectorScript + the expected file,
// produce a GradeResult. Used by both Tier 1 (mocked) and Tier 2 (live).

import type { DirectorScript } from '../../../src/shared/director/schema.js';
import { checkAssertion, checkGlobal, findGroup } from './assertions.js';
import type {
  BeatResult,
  ExpectedFile,
  GlobalResult,
  GradeResult,
} from './types.js';

export function gradeScript(
  script: DirectorScript,
  expected: ExpectedFile,
  source: 'mocked' | 'live',
): GradeResult {
  const globals: GlobalResult[] = expected.globals.map((g) => {
    const r = checkGlobal(script, g.path, g.equals);
    return {
      id: g.id,
      capability: g.capability,
      passed: r.ok,
      reason: r.ok ? undefined : r.reason,
    };
  });

  const beats: BeatResult[] = expected.beats.map((b) => {
    const group = findGroup(script, b.groupMatcher);
    if (!group) {
      return {
        id: b.id,
        description: b.description,
        capability: b.capability,
        passed: false,
        failed: [
          {
            assertion: { kind: 'role-in', values: ['<any matching group>'] },
            reason: 'no group in script matched the beat\'s groupMatcher',
          },
        ],
        knownGapNote: b.knownGapNote,
      };
    }
    const failed: BeatResult['failed'] = [];
    for (const a of b.assertions) {
      const r = checkAssertion(group, a);
      if (!r.ok) failed.push({ assertion: a, reason: r.reason });
    }
    return {
      id: b.id,
      description: b.description,
      capability: b.capability,
      passed: failed.length === 0,
      failed,
      knownGapNote: b.knownGapNote,
    };
  });

  const totalEntries = globals.length + beats.length;
  const passedEntries = globals.filter((g) => g.passed).length + beats.filter((b) => b.passed).length;
  const failedEntries = totalEntries - passedEntries;
  const knownGaps =
    globals.filter((g) => !g.passed && g.capability === 'not-shipped').length +
    beats.filter((b) => !b.passed && b.capability === 'not-shipped').length;

  return {
    reference: expected.reference,
    target: expected.target,
    source,
    script,
    globals,
    beats,
    summary: {
      total: totalEntries,
      passed: passedEntries,
      failed: failedEntries,
      knownGaps,
    },
  };
}
