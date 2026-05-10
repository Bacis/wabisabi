// One-time dev script: take a directory of .mp4 files, run the same
// transcribe + enrich pipeline POST /jobs uses, and emit the sidecar JSON
// files the themes feature needs (transcript.json, captionPlan.json,
// meta.json) plus a top-level index.json. The output lives at
// remotion/public/stock/<id>/ so both the Remotion bundler (staticFile())
// and the API's /stock/* fastifyStatic mount can read it.
//
// **Run this once locally and commit the resulting files**. Calling the
// transcribe stage hits the local Whisper sidecar; calling enrichTranscript
// hits the Anthropic API. Doing either at user runtime would reintroduce
// the per-view cost we are deliberately avoiding by serving themes from a
// static stock pool.
//
// Usage:
//   npx tsx scripts/seed-stock-clips.ts <input-dir>
//   npx tsx scripts/seed-stock-clips.ts <input-dir> --in-place
//
// Default mode copies each .mp4 from <input-dir> into
// remotion/public/stock/<slug>/clip.mp4. --in-place mode assumes <input-dir>
// IS remotion/public/stock and processes clips already in place.

import '../src/env.js';
import { mkdir, copyFile, writeFile, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, parse, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { ffprobe } from '../src/stages/ffprobe.js';
import { extractAudio } from '../src/stages/extractAudio.js';
import { transcribe } from '../src/stages/transcribe.js';
import { enrichTranscript } from '../src/stages/enrichTranscript.js';

const here = dirname(fileURLToPath(import.meta.url));
const STOCK_DIR = resolve(here, '../remotion/public/stock');
const FPS = 30;

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function titleize(slug: string): string {
  return slug
    .split('-')
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(' ');
}

type IndexEntry = {
  id: string;
  name: string;
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  hasTranscript: boolean;
};

async function processClip(
  sourceMp4: string,
  clipId: string,
  inPlace: boolean,
): Promise<IndexEntry> {
  const targetDir = join(STOCK_DIR, clipId);
  await mkdir(targetDir, { recursive: true });
  const targetMp4 = join(targetDir, 'clip.mp4');
  if (!inPlace && resolve(sourceMp4) !== resolve(targetMp4)) {
    await copyFile(sourceMp4, targetMp4);
  }

  console.log(`[${clipId}] ffprobe`);
  const probe = await ffprobe(targetMp4);

  const meta = {
    id: clipId,
    name: titleize(clipId),
    durationSec: probe.duration,
    width: probe.width,
    height: probe.height,
    fps: FPS,
  };
  await writeFile(join(targetDir, 'meta.json'), JSON.stringify(meta, null, 2));

  console.log(`[${clipId}] extract audio`);
  const tmp = await mkdtemp(join(tmpdir(), 'stock-seed-'));
  const wavPath = join(tmp, 'audio.wav');
  try {
    await extractAudio(targetMp4, wavPath);
    console.log(`[${clipId}] transcribe`);
    const transcript = await transcribe(wavPath);
    await writeFile(
      join(targetDir, 'transcript.json'),
      JSON.stringify(transcript, null, 2),
    );
    console.log(`[${clipId}] enrich (${transcript.words.length} words)`);
    const captionPlan = await enrichTranscript(transcript);
    if (captionPlan) {
      await writeFile(
        join(targetDir, 'captionPlan.json'),
        JSON.stringify(captionPlan, null, 2),
      );
    } else {
      console.warn(`[${clipId}] no captionPlan (LLM unavailable or empty input)`);
    }
    return { ...meta, hasTranscript: transcript.words.length > 0 };
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const inPlaceFlag = args.includes('--in-place');
  const positional = args.filter((a) => !a.startsWith('--'));
  const inputDir = positional[0];
  if (!inputDir) {
    console.error(
      'Usage: npx tsx scripts/seed-stock-clips.ts <input-dir> [--in-place]',
    );
    process.exit(2);
  }
  const inputDirAbs = resolve(inputDir);
  if (!existsSync(inputDirAbs)) {
    console.error(`input dir not found: ${inputDirAbs}`);
    process.exit(2);
  }

  const entries: IndexEntry[] = [];
  if (inPlaceFlag) {
    // In-place mode: each subfolder of STOCK_DIR is a clip. Use the folder
    // name as the id, look for clip.mp4 inside.
    const subdirs = (await readdir(STOCK_DIR, { withFileTypes: true }))
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    for (const sub of subdirs) {
      const mp4 = join(STOCK_DIR, sub, 'clip.mp4');
      if (!existsSync(mp4)) {
        console.warn(`skipping ${sub}: no clip.mp4`);
        continue;
      }
      entries.push(await processClip(mp4, sub, true));
    }
  } else {
    // Standard mode: scan inputDir for *.mp4, slugify filename → clip id.
    const files = (await readdir(inputDirAbs)).filter((f) => f.toLowerCase().endsWith('.mp4'));
    if (files.length === 0) {
      console.error(`no .mp4 files in ${inputDirAbs}`);
      process.exit(2);
    }
    for (const f of files) {
      const id = slugify(parse(f).name);
      if (!id) {
        console.warn(`skipping ${f}: empty slug`);
        continue;
      }
      entries.push(await processClip(join(inputDirAbs, f), id, false));
    }
  }

  await writeFile(
    join(STOCK_DIR, 'index.json'),
    JSON.stringify(entries, null, 2),
  );
  console.log(`\nseeded ${entries.length} clip(s) → ${STOCK_DIR}`);
  console.log(`Don't forget to commit:\n  git add remotion/public/stock`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
