#!/usr/bin/env tsx
/**
 * Reusable caption style extraction pipeline.
 *
 * Usage:
 *   tsx scripts/reel-analysis/extract-style.ts --url "https://www.instagram.com/reels/ABC123/"
 *   tsx scripts/reel-analysis/extract-style.ts --file ./path/to/video.mp4
 */

// Load .env before anything else
try { process.loadEnvFile(); } catch {}

import { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync } from 'fs';
import { join, basename } from 'path';
import { download } from './lib/download.js';
import { extractFrames } from './lib/extract-frames.js';
import { deduplicateFrames } from './lib/deduplicate.js';
import { analyzeWithVision } from './lib/analyze-vision.js';
import { generatePreset } from './lib/generate-preset.js';

const RUNS_DIR = join(import.meta.dirname, 'runs');

function parseArgs() {
  const args = process.argv.slice(2);
  let url: string | undefined;
  let file: string | undefined;
  let register = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--url' && args[i + 1]) {
      url = args[++i];
    } else if (args[i] === '--file' && args[i + 1]) {
      file = args[++i];
    } else if (args[i] === '--register') {
      register = true;
    }
  }

  if (!url && !file) {
    console.error('Usage: extract-style.ts --url <instagram-url> | --file <video-path>');
    process.exit(1);
  }

  return { url, file, register };
}

function deriveSlug(url?: string, file?: string): string {
  if (url) {
    // Extract reel ID from Instagram URL
    const match = url.match(/reels?\/([A-Za-z0-9_-]+)/);
    if (match) return match[1];
    // Fallback: hash of URL
    return url.replace(/[^a-zA-Z0-9]/g, '').slice(-12);
  }
  if (file) {
    return basename(file, '.mp4').replace(/[^a-zA-Z0-9_-]/g, '_');
  }
  return `run_${Date.now()}`;
}

async function main() {
  const { url, file, register } = parseArgs();
  const slug = deriveSlug(url, file);
  const runDir = join(RUNS_DIR, slug);

  mkdirSync(runDir, { recursive: true });
  console.log(`\n📁 Run directory: ${runDir}`);
  console.log(`   Slug: ${slug}\n`);

  // Step 1: Get the video
  console.log('Step 1: Acquiring video...');
  let videoPath: string;
  if (url) {
    videoPath = download(url, runDir);
  } else {
    const inputDir = join(runDir, 'input');
    mkdirSync(inputDir, { recursive: true });
    videoPath = join(inputDir, 'reel.mp4');
    if (!existsSync(videoPath)) {
      copyFileSync(file!, videoPath);
    }
    console.log(`  Copied: ${videoPath}`);
  }

  // Step 2: Extract frames
  console.log('\nStep 2: Extracting frames...');
  const { framesDir, meta } = extractFrames(videoPath, runDir);
  console.log(`  Video: ${meta.width}x${meta.height} @ ${meta.fps}fps, ${meta.durationSec.toFixed(1)}s`);

  // Step 3: Deduplicate
  console.log('\nStep 3: Deduplicating frames...');
  const uniqueFrames = deduplicateFrames(framesDir, runDir);

  // Step 4: Analyze with Claude Vision
  console.log('\nStep 4: Analyzing with Claude Vision...');
  const recipe = await analyzeWithVision(uniqueFrames, meta, runDir);

  // Step 5: Generate preset
  console.log('\nStep 5: Generating preset...');
  const preset = generatePreset(recipe, slug, runDir);

  // Update runs index
  const indexPath = join(RUNS_DIR, 'index.json');
  let index: any[] = [];
  if (existsSync(indexPath)) {
    index = JSON.parse(readFileSync(indexPath, 'utf-8'));
  }
  const entry = {
    slug,
    url: url ?? null,
    file: file ?? null,
    presetId: preset.id,
    templateId: preset.templateId,
    createdAt: new Date().toISOString(),
    hasCustomElements: (recipe.customElements?.length ?? 0) > 0,
  };
  // Update existing or append
  const existingIdx = index.findIndex((e: any) => e.slug === slug);
  if (existingIdx >= 0) index[existingIdx] = entry;
  else index.push(entry);
  writeFileSync(indexPath, JSON.stringify(index, null, 2));

  // Summary
  console.log('\n✅ Done!');
  console.log(`   Recipe:  ${join(runDir, 'recipe.json')}`);
  console.log(`   Preset:  ${join(runDir, 'preset.json')}`);
  console.log(`   Template: ${preset.templateId}`);
  if (recipe.customElements?.length > 0) {
    console.log(`   ⚠ ${recipe.customElements.length} custom element(s) detected — may need a new template`);
  }

  if (register) {
    console.log('\n   --register flag: TODO auto-register to presets.ts');
    // Future: auto-append to src/shared/presets.ts
  }
}

main().catch((err) => {
  console.error('\n❌ Error:', err.message ?? err);
  process.exit(1);
});
