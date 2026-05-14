import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readdirSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCanonicalFixture } from '../fixtures/canonical.js';
import { diffPng } from '../../scripts/regression/diff-frames.js';

// End-to-end visual regression for the reel-clone-default preset. Renders the
// canonical fixture's frames-of-interest with the live ReelClone code, then
// pixel-diffs each against the committed golden PNG. Skips with a clear
// message when goldens haven't been seeded yet (run `npm run regression:seed`
// from a known-good commit and check the PNGs in).
//
// Threshold rationale: 0.5% pixels-different at pixelmatch threshold 0.05 is
// loose enough to absorb font sub-pixel jitter across machines but tight
// enough to fail on real visual drift (one-pixel layout shifts, color
// mismatches, missing FX). If a phase legitimately changes pixels (it
// shouldn't until Phase 9), regenerate the golden and explain in the PR.

const HERE = dirname(fileURLToPath(import.meta.url));
const GOLDEN_DIR = resolve(HERE, '../fixtures/golden');
const TMP_DIR = resolve(HERE, '../../.regression-tmp');

const MAX_DIFFERING_RATIO = 0.005; // 0.5%

const goldensExist = existsSync(GOLDEN_DIR) && readdirSync(GOLDEN_DIR).some((f) => f.endsWith('.png'));

describe.skipIf(!goldensExist)('reel-clone-default golden frames', () => {
  let fixture: ReturnType<typeof loadCanonicalFixture>;
  let renderStillFrame: typeof import('../../src/stages/renderStill.js')['renderStillFrame'];

  beforeAll(async () => {
    fixture = loadCanonicalFixture();
    // env.js touches process.env.* — load it before anything that needs it.
    await import('../../src/env.js');
    ({ renderStillFrame } = await import('../../src/stages/renderStill.js'));
    await mkdir(TMP_DIR, { recursive: true });
  }, 60_000);

  for (const frame of (loadCanonicalFixture()).frames) {
    const goldenPath = resolve(GOLDEN_DIR, `${frame.id}.png`);
    if (!existsSync(goldenPath)) continue; // skip frames not yet seeded

    it(`matches golden: ${frame.id}`, async () => {
      const candidatePath = resolve(TMP_DIR, `${frame.id}.png`);
      await rm(candidatePath, { force: true });
      await renderStillFrame({
        inputVideo: fixture.inputVideo,
        transcript: fixture.transcript,
        captionPlan: fixture.captionPlan,
        faces: null,
        styleSpec: fixture.styleSpec,
        templateId: fixture.templateId,
        frameSec: frame.t,
        outputPath: candidatePath,
      });
      const result = diffPng(goldenPath, candidatePath);
      expect(result.ratio, `${result.differingPixels}/${result.totalPixels} px differ in ${frame.id}`).toBeLessThanOrEqual(MAX_DIFFERING_RATIO);
    }, 120_000);
  }
});

describe.skipIf(goldensExist)('regression suite — golden seeding required', () => {
  it.skip('skipped: no goldens in tests/fixtures/golden — run `npm run regression:seed`', () => {});
});
