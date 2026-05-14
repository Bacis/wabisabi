// Tier 2 runner: call the live Director planner with the reference prompt
// + orhan transcript, then grade the response.
//
// Requires OPENROUTER_API_KEY. Costs ~one Sonnet 4.5 call per invocation.
// Invoked manually by scripts/quality-live.ts (the npm run quality:live
// entrypoint) — never imported by the always-on vitest spec.

import { writeFileSync } from 'node:fs';
import { loadCanonicalFixture } from '../../fixtures/canonical.js';
import {
  proposeDirectorScript,
  type PlannerWord,
} from '../../../src/stages/proposeDirectorScript.js';
import type { GradeResult } from './types.js';
import { loadReference } from './loadReference.js';
import { gradeScript } from './grade.js';

export type RunLiveOptions = {
  /** Reference directory name under tests/quality/references/. */
  reference: string;
  /** Target clip id; today only 'orhan' is supported (the canonical fixture). */
  target?: 'orhan';
  /** When true, write the planner's output to the mocked-script path. */
  updateMock?: boolean;
  /** OpenRouter model override; defaults to the planner's own default. */
  model?: string;
};

/** Convert the canonical orhan transcript into the planner's PlannerWord shape. */
function orhanTranscript(): PlannerWord[] {
  const fixture = loadCanonicalFixture();
  return fixture.transcript.words.map((w, idx) => ({
    idx,
    t: w.start,
    w: w.word,
  }));
}

export async function runLive(opts: RunLiveOptions): Promise<GradeResult> {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY is not set — Tier 2 live runs need it');
  }
  const target = opts.target ?? 'orhan';
  const ref = loadReference(opts.reference, target);
  const transcript = target === 'orhan' ? orhanTranscript() : [];
  if (transcript.length === 0) {
    throw new Error(`no transcript wired for target "${target}"`);
  }

  const result = await proposeDirectorScript({
    transcript,
    message: ref.promptText.trim(),
    model: opts.model,
  });
  if (!result.ok) {
    throw new Error(`planner failed: ${result.error}`);
  }

  if (opts.updateMock) {
    writeFileSync(ref.mockedScriptPath, JSON.stringify(result.script, null, 2) + '\n');
  }

  return gradeScript(result.script, ref.expected, 'live');
}
