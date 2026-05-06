#!/usr/bin/env tsx
/**
 * Compare the local heuristic captionPlan to the ground-truth captionPlan
 * extracted from the reel via OCR. Surfaces which words our chunker missed,
 * mis-grouped, or wrongly emphasized.
 *
 * Usage:
 *   tsx scripts/reel-analysis/diff-chunks.ts --slug DXhn5HNhTxy
 */
try { process.loadEnvFile(); } catch {}

import { readFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

const slug = arg('slug');
if (!slug) { console.error('--slug required'); process.exit(1); }

const runDir = resolve('scripts/reel-analysis/runs', slug);
const localPath = join(runDir, 'captionPlan.local.json');
const gtPath = join(runDir, 'captionPlan.gt.json');
if (!existsSync(localPath) || !existsSync(gtPath)) {
  console.error('Need both captionPlan.local.json and captionPlan.gt.json. Run run-chunker.ts and extract-features.ts first.');
  process.exit(1);
}

const local = JSON.parse(readFileSync(localPath, 'utf-8'));
const gt = JSON.parse(readFileSync(gtPath, 'utf-8'));

function norm(w: string): string {
  return w.toLowerCase().replace(/[^a-z0-9]/g, '');
}

console.log(`\nlocal:  ${local.chunks.length} chunks`);
console.log(`gt:     ${gt.chunks.length} chunks`);

// Build word-level emphasis maps keyed by normalized word + start time bucket.
// We allow a 1.5s slop since OCR sample timings differ from audio word timings.
type Marker = { word: string; t: number; emph: boolean };
const localMarkers: Marker[] = [];
const gtMarkers: Marker[] = [];

for (const c of local.chunks) {
  for (let i = 0; i < c.words.length; i++) {
    localMarkers.push({
      word: norm(c.words[i].word),
      t: c.words[i].start,
      emph: c.emphasis[i],
    });
  }
}
for (const c of gt.chunks) {
  for (let i = 0; i < c.words.length; i++) {
    gtMarkers.push({
      word: norm(c.words[i].word),
      t: c.words[i].start,
      emph: c.emphasis[i],
    });
  }
}

// Match each gt marker to the closest local marker with same normalized text
// in a ±2s window. Track agreement on emphasis flag.
let matched = 0;
let agreeEmph = 0;
let gtEmphasized = 0;
let localEmphasized = 0;
let mismatches: { gt: Marker; local: Marker | null }[] = [];

for (const g of gtMarkers) {
  if (g.emph) gtEmphasized++;
  let best: Marker | null = null;
  let bestDist = Infinity;
  for (const l of localMarkers) {
    if (l.word !== g.word) continue;
    const d = Math.abs(l.t - g.t);
    if (d > 2.0) continue;
    if (d < bestDist) { bestDist = d; best = l; }
  }
  if (best) {
    matched++;
    if (best.emph === g.emph) agreeEmph++;
    else mismatches.push({ gt: g, local: best });
  } else {
    mismatches.push({ gt: g, local: null });
  }
}
for (const l of localMarkers) {
  if (l.emph) localEmphasized++;
}

console.log(`\nword-level coverage:`);
console.log(`  gt words:           ${gtMarkers.length}`);
console.log(`  local words:        ${localMarkers.length}`);
console.log(`  matched (in ±2s):   ${matched} (${(matched/gtMarkers.length*100).toFixed(0)}%)`);
console.log(`  emphasis agreement: ${agreeEmph}/${matched} (${matched ? (agreeEmph/matched*100).toFixed(0) : 0}%)`);
console.log(`\nemphasis density:`);
console.log(`  gt emphasized:      ${gtEmphasized}/${gtMarkers.length} (${(gtEmphasized/gtMarkers.length*100).toFixed(0)}%)`);
console.log(`  local emphasized:   ${localEmphasized}/${localMarkers.length} (${(localEmphasized/localMarkers.length*100).toFixed(0)}%)`);

// Show first ~20 mismatches with context
console.log(`\nfirst 20 emphasis mismatches (gt vs local):`);
mismatches.slice(0, 20).forEach((m) => {
  const gt = m.gt;
  const local = m.local;
  if (!local) {
    console.log(`  t=${gt.t.toFixed(2)}s "${gt.word}" gt:${gt.emph?'EMPH':'-'} local:NOT FOUND`);
  } else {
    console.log(`  t=${gt.t.toFixed(2)}s "${gt.word}" gt:${gt.emph?'EMPH':'-'} local:${local.emph?'EMPH':'-'}`);
  }
});
console.log('');
