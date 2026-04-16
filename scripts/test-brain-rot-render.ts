// Local smoke test for the brain-rot split-screen render path. Bypasses
// the pipeline's transcription + mode detection (which need Python) and
// drives renderProductionLocal directly with a synthetic speaker clip +
// a real brain-rot clip from /storage/brain-rot/.
//
// Useful when Railway's transcribe silently returns 0 words and pipeline
// keeps landing in narrated_story mode — that path is a no-op by design
// for brain-rot, so you can't verify the rendering from a pipeline run.
//
// Usage:
//   npx tsx scripts/test-brain-rot-render.ts [speakerClip.mp4]
//
// Defaults to ./input_orhan.mp4. Output: /tmp/brain-rot-local-test.mp4.

import '../src/env.js';
import { readdir } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { ffprobe } from '../src/stages/ffprobe.js';
import { renderProductionLocal } from '../src/stages/renderProductionLocal.js';
import type { CutTimelineEntry } from '../src/shared/productionTypes.js';
import type { Transcript } from '../src/shared/types.js';
import type { StyleSpec } from '../src/shared/styleSpec.js';

const speakerInput = resolve(process.argv[2] ?? './input_orhan.mp4');
const brainRotDir = resolve('./storage/brain-rot');
const outputPath = '/tmp/brain-rot-local-test.mp4';

// 12-second demo. Long enough to confirm the brain-rot loops when the
// source clip is ~3s, short enough to render in well under a minute.
const DEMO_DURATION_SEC = 12;

async function main() {
  console.log(`speaker:   ${speakerInput}`);
  console.log(`brain-rot: ${brainRotDir}`);
  console.log(`output:    ${outputPath}`);
  console.log('');

  // Pick the smallest brain-rot clip for fastest staging.
  const entries = await readdir(brainRotDir);
  const clips = entries.filter((n) => n.toLowerCase().endsWith('.mp4')).sort();
  if (clips.length === 0) throw new Error(`no brain-rot clips in ${brainRotDir}`);
  const brainRotPath = join(brainRotDir, clips[0]!);
  const brainRotMeta = await ffprobe(brainRotPath);
  console.log(`picked brain-rot: ${basename(brainRotPath)} (${brainRotMeta.duration.toFixed(2)}s)`);

  // Synthetic transcript — 4 chunks of 2 words each, spanning the demo.
  // Word times are in clip-local seconds (0..DEMO_DURATION_SEC).
  const words = [
    'BRAIN',
    'ROT',
    'SPLIT',
    'SCREEN',
    'WORKS',
    'LOCALLY',
    'TEST',
    'PASSED',
  ];
  const perWord = DEMO_DURATION_SEC / words.length;
  const transcript: Transcript = {
    language: 'en',
    duration: DEMO_DURATION_SEC,
    words: words.map((w, i) => ({
      word: w,
      start: i * perWord,
      end: (i + 1) * perWord - 0.05,
      confidence: 1,
    })),
  };

  const timeline: CutTimelineEntry[] = [
    {
      assetId: 'demo-speaker',
      role: 'speaker',
      inSec: 0,
      outSec: DEMO_DURATION_SEC,
      keepAudio: true,
      // renderProductionLocal stages cutPath into publicDir and trims by
      // `durationInFrames`, not by re-cutting the mp4. Pointing at the
      // full input is fine — only the first DEMO_DURATION_SEC will render.
      cutPath: speakerInput,
      cutDurationSec: DEMO_DURATION_SEC,
      transcript,
      captionPlan: null,
      faces: null,
    },
  ];

  // styleSpec with splitScreen flipped on — matches what the pipeline
  // would produce for a `--brainrot` submission.
  const styleSpec = {
    splitScreen: { brainRot: true },
    layout: { position: 'middle' as const, safeMargin: 0.15 },
    font: { size: 72 },
    color: { fill: '#ffffff', stroke: '#000000', strokeWidth: 8, emphasisFill: '#ffe14b' },
    animation: { preset: 'pop' as const },
  } as unknown as StyleSpec;

  const t0 = Date.now();
  const result = await renderProductionLocal({
    timeline,
    narrationPath: null,
    narrationScript: null,
    narrationTranscript: null,
    narrationCaptionPlan: null,
    hookDurationSec: 0,
    styleSpec,
    brainRotClipPath: brainRotPath,
    brainRotDurationSec: brainRotMeta.duration,
    outputPath,
    onProgress: (p) => {
      if (p.mode === 'local' && p.percent !== undefined && p.percent % 10 === 0) {
        console.log(`  ${p.percent}% (${p.framesRendered}/${p.totalFrames})`);
      }
    },
  });
  console.log('');
  console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s — ${result.outputPath}`);
  console.log(`play:   open ${result.outputPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
