#!/usr/bin/env tsx
/**
 * Quick test: run the full pipeline on input_orhan.mp4 with the reel-clone template.
 */
import '../src/env.js';

import { resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { extractAudio } from '../src/stages/extractAudio.js';
import { transcribe } from '../src/stages/transcribe.js';
import { enrichTranscript } from '../src/stages/enrichTranscript.js';
import { detectFaces } from '../src/stages/detectFaces.js';
import { renderCaptions } from '../src/stages/render.js';
import { PRESETS } from '../src/shared/presets.js';

const INPUT = resolve('input_orhan.mp4');
const WORK_DIR = resolve('storage/work/test-reel-clone');
const OUTPUT = resolve('storage/outputs/test-reel-clone.mp4');

const preset = PRESETS['reel-clone-default']!;
console.log(`Template: ${preset.templateId}`);
console.log(`Preset: ${preset.id}\n`);

async function main() {
  await mkdir(WORK_DIR, { recursive: true });

  // 1. Extract audio
  console.log('1. Extracting audio...');
  const audioPath = resolve(WORK_DIR, 'audio.wav');
  await extractAudio(INPUT, audioPath);
  console.log('   Done.\n');

  // 2. Transcribe + detect faces in parallel
  console.log('2. Transcribe + face detection...');
  const [transcript, faces] = await Promise.all([
    transcribe(audioPath).then((t) => {
      console.log(`   Transcribe: ${t.words.length} words`);
      return t;
    }),
    detectFaces(INPUT)
      .then((f) => {
        console.log(`   Faces: ${f.samples.filter((s) => s.faces.length > 0).length} samples with faces`);
        return f;
      })
      .catch((err) => {
        console.log(`   Faces: skipped (${(err as Error).message})`);
        return null;
      }),
  ]);

  // 3. Enrich
  console.log('\n3. Enriching transcript...');
  const captionPlan = await enrichTranscript(transcript);
  console.log(`   Chunks: ${captionPlan?.chunks.length ?? 'fallback'}\n`);

  // 4. Render
  console.log('4. Rendering with reel-clone template...');
  const result = await renderCaptions({
    inputVideo: INPUT,
    transcript,
    captionPlan,
    faces,
    styleSpec: preset.styleSpec as any,
    templateId: preset.templateId,
    outputPath: OUTPUT,
    onProgress: (p) => {
      process.stdout.write(`\r   Progress: ${p.percent}%`);
    },
  });

  console.log(`\n\n✅ Output: ${result.outputPath}`);
}

main().catch((err) => {
  console.error('\n❌ Error:', err);
  process.exit(1);
});
