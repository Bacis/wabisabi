// One-shot end-to-end smoke test for the three-effects template through the
// production worker code path. Loads a previously-completed job's transcript
// + captionPlan + faces from the SQLite database, then calls
// renderCaptionsLocal directly with templateId='three-effects'. Exercises:
//   - Remotion bundle reload (picks up the new ThreeEffects composition)
//   - selectComposition matching the new id
//   - renderMedia with chromiumOptions: { gl: 'angle' } (required for WebGL)
//   - Real h264 mp4 output, not just a still frame
//
// Skip transcription / face-detection because we already have those for the
// source job — this isolates the test to JUST the rendering changes.
//
// Usage: npx tsx scripts/test-three-effects-render.ts <sourceJobId>

import '../src/env.js';
import { resolve } from 'node:path';
import { db } from '../src/db.js';
import { renderCaptionsLocal } from '../src/stages/renderLocal.js';
import type { CaptionPlan, FaceData, Transcript } from '../src/shared/types.js';
import type { StyleSpec } from '../src/shared/styleSpec.js';

const sourceJobId = process.argv[2];
if (!sourceJobId) {
  console.error('usage: tsx scripts/test-three-effects-render.ts <sourceJobId>');
  process.exit(1);
}

type JobRow = {
  id: string;
  inputPath: string;
  transcript: string | null;
  captionPlan: string | null;
  faces: string | null;
};

const row = db
  .prepare('select id, inputPath, transcript, captionPlan, faces from jobs where id = ?')
  .get(sourceJobId) as JobRow | undefined;

if (!row) {
  console.error(`source job ${sourceJobId} not found`);
  process.exit(1);
}
if (!row.transcript) {
  console.error(`source job ${sourceJobId} has no transcript — pick a 'done' job`);
  process.exit(1);
}

const transcript = JSON.parse(row.transcript) as Transcript;
const captionPlan: CaptionPlan | null = row.captionPlan
  ? (JSON.parse(row.captionPlan) as CaptionPlan)
  : null;
const faces: FaceData | null = row.faces ? (JSON.parse(row.faces) as FaceData) : null;

// Use the same StyleSpec as the three-burst preset so the output matches
// what an end-user would get by selecting that preset in the viewer.
const styleSpec: StyleSpec = {
  font: { weight: 900, size: 64, textTransform: 'uppercase' },
  color: {
    fill: '#ffffff',
    stroke: '#000000',
    strokeWidth: 12,
    emphasisFill: '#ffe14b',
  },
  layout: { position: 'bottom', safeMargin: 0.18, maxWordsPerLine: 4 },
  animation: { tailMs: 250 },
};

const outputPath = resolve('/tmp/three-effects-render-test.mp4');
console.log(
  `rendering ${row.inputPath} with three-effects → ${outputPath} (${transcript.words.length} words)`,
);

const t0 = Date.now();
await renderCaptionsLocal({
  inputVideo: resolve(row.inputPath),
  transcript,
  captionPlan,
  faces,
  styleSpec,
  templateId: 'three-effects',
  outputPath,
  onProgress: (p) => {
    if (p.mode === 'local' && p.percent !== undefined && p.percent % 10 === 0) {
      console.log(`  ${p.percent}% (${p.framesRendered}/${p.totalFrames})`);
    }
  },
});
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s — wrote ${outputPath}`);
process.exit(0);
