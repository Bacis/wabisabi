#!/usr/bin/env tsx
// Render a slug's reel with a candidate styleSpec at a list of timestamps.
// Reuses (or creates) a cached captionPlan so we burn at most one Haiku call
// per run, then iterate locally on the styleSpec for free.
//
// Usage:
//   tsx scripts/reel-analysis/render-candidate.ts --slug DXhn5HNhTxy --label v1 --secs 2,7,15,25,35
try { process.loadEnvFile(); } catch {}

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { renderStillLocal } from './lib/render-still.js';
import { enrichTranscript } from '../../src/stages/enrichTranscript.js';
import { chunkLocally } from './lib/local-chunker.js';

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

const slug = arg('slug');
const label = arg('label', 'cand');
const secsArg = arg('secs', '2,7,15,25,35');
const styleArg = arg('style', 'candidate_style.json');
if (!slug) { console.error('--slug required'); process.exit(1); }

const runDir = resolve('scripts/reel-analysis/runs', slug);
const reelPath = join(runDir, 'input', 'reel.mp4');
const transcript = JSON.parse(readFileSync(join(runDir, 'transcript.json'), 'utf-8'));
const styleSpec = JSON.parse(readFileSync(join(runDir, styleArg!), 'utf-8'));

const planCachePath = join(runDir, 'captionPlan.json');
const localPlanPath = join(runDir, 'captionPlan.local.json');
const useLocal = arg('local', '0') === '1';
let captionPlan: any = null;
if (useLocal) {
  console.log('Using local heuristic chunker (no API)');
  captionPlan = chunkLocally(transcript);
  writeFileSync(localPlanPath, JSON.stringify(captionPlan));
  console.log(`  ${captionPlan.chunks.length} chunks`);
} else if (existsSync(planCachePath)) {
  console.log('Using cached captionPlan');
  captionPlan = JSON.parse(readFileSync(planCachePath, 'utf-8'));
} else {
  console.log('Generating captionPlan (1 Haiku call)...');
  captionPlan = await enrichTranscript(transcript);
  if (!captionPlan) {
    console.log('Enrichment unavailable, falling back to local chunker');
    captionPlan = chunkLocally(transcript);
  }
  if (captionPlan) writeFileSync(planCachePath, JSON.stringify(captionPlan));
}

const outDir = join(runDir, 'iterations', label, 'rendered');
mkdirSync(outDir, { recursive: true });

const secs = secsArg!.split(',').map((s) => parseFloat(s.trim()));
for (const sec of secs) {
  const out = join(outDir, `t${String(Math.round(sec * 10)).padStart(4, '0')}.png`);
  console.log(`  Rendering t=${sec}s -> ${out}`);
  renderStillLocal({
    inputVideo: reelPath,
    transcript,
    captionPlan,
    faces: null,
    styleSpec,
    templateId: 'reel-clone',
    frameSec: sec,
    outputPath: out,
  });
}
console.log('Done. Frames in:', outDir);
