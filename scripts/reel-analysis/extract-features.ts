#!/usr/bin/env tsx
/**
 * Extract caption visual features from a reel: run OCR sidecar, then
 * aggregate per-frame detections into tracks, chunks, and a deterministic
 * style profile.
 *
 * Usage:
 *   tsx scripts/reel-analysis/extract-features.ts --slug DXhn5HNhTxy [--fps 4]
 *   tsx scripts/reel-analysis/extract-features.ts --video path/to/clip.mp4 \
 *       --out-dir runs/x [--fps 4]
 *
 * Outputs in <run-dir>:
 *   features.json       — raw per-frame OCR detections
 *   tracks.json         — temporally tracked words
 *   style-profile.json  — aggregated style profile
 *   captionPlan.gt.json — ground-truth caption plan derived from visual evidence
 */

try { process.loadEnvFile(); } catch {}

import { existsSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import { execSync } from 'child_process';
import { processFeatures } from './lib/feature-extract.js';

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

const slug = arg('slug');
const videoArg = arg('video');
const outDirArg = arg('out-dir');
const fpsArg = arg('fps', '4');
const force = process.argv.includes('--force');

let videoPath: string;
let runDir: string;

if (slug) {
  runDir = resolve('scripts/reel-analysis/runs', slug);
  videoPath = join(runDir, 'input', 'reel.mp4');
} else if (videoArg && outDirArg) {
  videoPath = resolve(videoArg);
  runDir = resolve(outDirArg);
} else {
  console.error('Usage: extract-features.ts --slug <slug> | --video <path> --out-dir <dir>');
  process.exit(1);
}

if (!existsSync(videoPath)) {
  console.error(`Input video not found: ${videoPath}`);
  process.exit(1);
}
mkdirSync(runDir, { recursive: true });

const featuresPath = join(runDir, 'features.json');
if (!existsSync(featuresPath) || force) {
  console.log(`[extract-features] running OCR on ${videoPath} (fps=${fpsArg})...`);
  const py = process.env.PYTHON_BIN ?? './.venv/bin/python';
  const script = resolve('ocr-py/extract_caption_features.py');
  execSync(`"${py}" "${script}" "${videoPath}" "${featuresPath}" --fps ${fpsArg}`, {
    stdio: 'inherit',
  });
} else {
  console.log(`[extract-features] using cached ${featuresPath}`);
}

console.log('[extract-features] aggregating tracks/chunks/profile...');
const { tracks, chunks, profile } = processFeatures(featuresPath, runDir);

console.log('');
console.log(`tracks: ${tracks.length}`);
console.log(`chunks: ${chunks.length}`);
console.log(`duration: ${profile.duration_sec.toFixed(1)}s`);
console.log(`dominant color: ${profile.dominant_color}`);
console.log(`emphasis colors: ${profile.emphasis_colors.join(', ') || '(none)'}`);
console.log(`color counts: ${JSON.stringify(profile.colors)}`);
console.log(`font heights p25/p50/p75/p95: ${profile.font_heights.p25}/${profile.font_heights.p50}/${profile.font_heights.p75}/${profile.font_heights.p95}`);
console.log(`cascade detected: ${profile.cascade_detected} (top/bottom ratio ${profile.cascade_top_ratio})`);
console.log(`position band: ${profile.pos_y_band} (median pos_y=${profile.pos_y_dominant})`);
console.log(`progressive reveal score: ${profile.progressive_reveal_score} ${
  profile.progressive_reveal_score > 0.25 ? '(progressive likely)' : '(all-at-once)'}`);
console.log(`emphasis case usage: ${JSON.stringify(profile.emphasis_case)}`);
console.log('');
console.log(`outputs in: ${runDir}`);
console.log(`  features.json, tracks.json, style-profile.json, captionPlan.gt.json`);
