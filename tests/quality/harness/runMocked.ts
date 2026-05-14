// Tier 1 runner: load the committed mocked DirectorScript, run it through
// the grader. No LLM call. Used by the always-on Vitest spec.

import type { GradeResult } from './types.js';
import { loadReference } from './loadReference.js';
import { gradeScript } from './grade.js';

export function runMocked(referenceName: string, target = 'orhan'): GradeResult {
  const ref = loadReference(referenceName, target);
  if (!ref.mockedScript) {
    throw new Error(
      `tier 1 requires a mocked script at ${ref.mockedScriptPath}. ` +
        `Seed it once via: npm run quality:live -- ${referenceName} --update-mock`,
    );
  }
  return gradeScript(ref.mockedScript, ref.expected, 'mocked');
}
