#!/usr/bin/env tsx
import '../../src/env.js';

import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderStillFrame } from '../../src/stages/renderStill.js';
import { loadCanonicalFixture } from '../../tests/fixtures/canonical.js';

// Seeds (or re-seeds) the golden PNG frames the regression suite checks
// against. Run this ONCE on a known-good baseline (typically `main` before
// you start the refactor); commit the resulting PNGs. The regression vitest
// test re-renders the same frames and asserts pixel-equality (within the
// pixelmatch threshold defined in diff-frames.ts).
//
//   npm run regression:seed              # render all frames
//   npm run regression:seed -- f01-anchor-entry  # re-seed one frame by id
//
// Frames whose golden PNG already exists are skipped unless --force is set.

const HERE = dirname(fileURLToPath(import.meta.url));
const GOLDEN_DIR = resolve(HERE, '../../tests/fixtures/golden');

async function main() {
  const argv = process.argv.slice(2);
  const force = argv.includes('--force');
  const wanted = new Set(argv.filter((a) => !a.startsWith('--')));

  await mkdir(GOLDEN_DIR, { recursive: true });

  const fixture = loadCanonicalFixture();
  if (!existsSync(fixture.inputVideo)) {
    throw new Error(
      `fixture video missing: ${fixture.inputVideo}\nRefresh the orhan reel-analysis run or set REGRESSION_FIXTURE_VIDEO.`,
    );
  }

  console.log(`Seeding goldens to ${GOLDEN_DIR}`);
  console.log(`Template: ${fixture.templateId}`);
  console.log(`Input:    ${fixture.inputVideo}`);
  console.log(`Frames:   ${fixture.frames.length}\n`);

  for (const frame of fixture.frames) {
    if (wanted.size > 0 && !wanted.has(frame.id)) continue;
    const outputPath = resolve(GOLDEN_DIR, `${frame.id}.png`);
    if (existsSync(outputPath) && !force) {
      console.log(`  [skip] ${frame.id} (already exists, pass --force to overwrite)`);
      continue;
    }
    process.stdout.write(`  [render] ${frame.id} @ ${frame.t}s ...`);
    const t0 = Date.now();
    await renderStillFrame({
      inputVideo: fixture.inputVideo,
      transcript: fixture.transcript,
      captionPlan: fixture.captionPlan,
      faces: null,
      styleSpec: fixture.styleSpec,
      templateId: fixture.templateId,
      frameSec: frame.t,
      outputPath,
    });
    console.log(` ${Date.now() - t0}ms`);
  }

  console.log('\nDone. Commit tests/fixtures/golden/*.png to lock the baseline.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
