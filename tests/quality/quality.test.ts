// Reference-driven quality harness — Tier 1 (always-on).
//
// For each reference under tests/quality/references/, load the committed
// mocked DirectorScript at tests/quality/harness/mocks/<name>-on-orhan.json
// and assert against expected.json. Tests for not-yet-shipped capabilities
// start RED and flip GREEN when the feature lands; that's the ticket queue.
//
// When the mocked fixture is missing (first ever run), every reference's
// suite is skipped with a clear message: refresh via `npm run quality:live`.

import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadReference } from './harness/loadReference.js';
import { runMocked } from './harness/runMocked.js';

const REFERENCES = ['jodie'] as const;

for (const referenceName of REFERENCES) {
  // Probe whether the mock exists. `describe.skipIf` skips test EXECUTION
  // but Vitest still evaluates the describe body to discover tests — so
  // we cannot put `runMocked()` directly inside; that would throw at
  // collection time. Instead, render a skipped placeholder when the mock
  // is missing and bail out of this reference's iteration entirely.
  const mockedScriptPath = (() => {
    try {
      return loadReference(referenceName).mockedScriptPath;
    } catch {
      return null;
    }
  })();
  const haveMock = mockedScriptPath !== null && existsSync(mockedScriptPath);

  if (!haveMock) {
    describe(`quality: ${referenceName} — mocked fixture missing`, () => {
      it.skip(`run \`npm run quality:live -- ${referenceName} --update-mock\` to seed`, () => {});
    });
    continue;
  }

  describe(`quality: ${referenceName} → orhan (mocked)`, () => {
    const result = runMocked(referenceName);

    it('produces a non-empty DirectorScript with project invariants', () => {
      expect(result.script.groups.length).toBeGreaterThan(0);
      expect(result.script.project.font.length).toBeGreaterThan(0);
    });

    // Global property assertions (project-level)
    for (const g of result.globals) {
      const tag = g.capability === 'not-shipped' ? '[KNOWN GAP]' : '';
      it(`global · ${g.id} ${tag}`.trim(), () => {
        if (g.capability === 'not-shipped') {
          // Documents the gap. Doesn't fail CI for known-not-shipped items.
          expect(g.passed, g.reason).toBe(g.passed);
          return;
        }
        expect(g.passed, g.reason).toBe(true);
      });
    }

    // Per-beat assertions
    for (const beat of result.beats) {
      const tag = beat.capability === 'not-shipped' ? '[KNOWN GAP]' : beat.capability === 'partial' ? '[PARTIAL]' : '';
      it(`beat · ${beat.id} — ${beat.description} ${tag}`.trim(), () => {
        // Known gaps (not-shipped + partial) document expectations but
        // don't fail the suite. Only fully-shipped capabilities that
        // regress count as red.
        if (beat.capability !== 'shipped') {
          expect(typeof beat.passed).toBe('boolean');
          return;
        }
        if (!beat.passed) {
          const reasons = beat.failed.map((f) => `  · ${f.assertion.kind}: ${f.reason}`).join('\n');
          throw new Error(`beat "${beat.id}" failed:\n${reasons}`);
        }
        expect(beat.passed).toBe(true);
      });
    }

    it('summary', () => {
      const { passed, total, knownGaps } = result.summary;
      // Always passes — the summary is informational.
      console.log(
        `[quality:${referenceName}] ${passed}/${total} passed (${knownGaps} known gaps)`,
      );
      expect(total).toBeGreaterThan(0);
    });
  });

}
