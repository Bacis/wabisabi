#!/usr/bin/env tsx
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { chunkLocally } from './lib/local-chunker.js';

const slug = process.argv[2];
if (!slug) { console.error('usage: run-chunker.ts <slug>'); process.exit(1); }

const runDir = resolve('scripts/reel-analysis/runs', slug);
const t = JSON.parse(readFileSync(`${runDir}/transcript.json`, 'utf-8'));
const plan = chunkLocally(t);

writeFileSync(`${runDir}/captionPlan.local.json`, JSON.stringify(plan));
console.log(`${plan.chunks.length} chunks written to captionPlan.local.json`);

// Print first 30 for inspection
plan.chunks.slice(0, 30).forEach((c: any, i: number) => {
  const txt = c.words
    .map((w: any, j: number) => (c.emphasis[j] ? `*${w.word.toUpperCase()}*` : w.word))
    .join(' ');
  console.log(`${String(i).padStart(2)} [${c.words[0].start.toFixed(2)}s] ${txt}`);
});
