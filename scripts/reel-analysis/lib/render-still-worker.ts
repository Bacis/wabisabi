#!/usr/bin/env tsx
/**
 * Standalone worker script that renders a single still frame.
 * Called as a subprocess to isolate module resolution.
 *
 * Usage: node --import tsx/esm scripts/reel-analysis/lib/render-still-worker.ts <opts.json>
 */
import '../../../src/env.js';
import { renderStillFrame } from '../../../src/stages/renderStill.js';
import { readFileSync } from 'fs';

const optsPath = process.argv[2];
if (!optsPath) {
  console.error('Usage: render-still-worker.ts <opts.json>');
  process.exit(1);
}

const opts = JSON.parse(readFileSync(optsPath, 'utf-8'));
await renderStillFrame(opts);
