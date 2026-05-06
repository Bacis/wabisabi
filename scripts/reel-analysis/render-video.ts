#!/usr/bin/env tsx
// Render a full-video preview of a slug using its refined_preset.json + cached
// captionPlan.json. No API calls — purely local. Use to verify motion/timing.
//
// Usage: tsx scripts/reel-analysis/render-video.ts --slug DXhn5HNhTxy
try { process.loadEnvFile(); } catch {}

import { existsSync, readFileSync } from 'fs';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'path';
import { renderCaptions } from '../../src/stages/render.js';

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

const slug = arg('slug');
if (!slug) { console.error('--slug required'); process.exit(1); }

const runDir = resolve('scripts/reel-analysis/runs', slug);
const reelPath = join(runDir, 'input', 'reel.mp4');
const transcript = JSON.parse(readFileSync(join(runDir, 'transcript.json'), 'utf-8'));
const presetArg = arg('preset');
const presetPath = presetArg ? resolve(presetArg) : join(runDir, 'refined_preset.json');
console.log(`preset: ${presetPath}`);
const refined = JSON.parse(readFileSync(presetPath, 'utf-8'));

// Prefer local heuristic plan if present (deterministic, free); fallback to
// API-derived plan; error if neither exists.
const localPlanPath = join(runDir, 'captionPlan.local.json');
const planPath = join(runDir, 'captionPlan.json');
const usePath = arg('plan', existsSync(localPlanPath) ? localPlanPath : planPath);
if (!existsSync(usePath!)) {
  console.error(`No captionPlan at ${usePath}. Run render-candidate.ts --local 1 first.`);
  process.exit(1);
}
console.log(`captionPlan: ${usePath}`);
const captionPlan = JSON.parse(readFileSync(usePath!, 'utf-8'));

const outDir = join(runDir, 'preview');
await mkdir(outDir, { recursive: true });
const outName = arg('out-name', 'refined-style.mp4')!;
const outputPath = join(outDir, outName);

console.log(`Slug: ${slug}`);
console.log(`Preset: ${refined.id} (templateId=${refined.templateId})`);
console.log(`Caption chunks: ${captionPlan.chunks.length}`);
console.log(`Output: ${outputPath}\n`);

const result = await renderCaptions({
  inputVideo: reelPath,
  transcript,
  captionPlan,
  faces: null,
  styleSpec: refined.styleSpec,
  templateId: refined.templateId,
  outputPath,
  onProgress: (p) => { process.stdout.write(`\rprogress: ${p.percent}%`); },
});
console.log(`\n\nDone: ${result.outputPath}`);
