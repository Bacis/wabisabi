import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CaptionPlan, Transcript, Word } from '../../src/shared/types.js';
import type { StyleSpec } from '../../src/shared/styleSpec.js';
import { PRESETS } from '../../src/shared/presets.js';

const HERE = dirname(fileURLToPath(import.meta.url));

// Frozen end-to-end fixture used by both the seed script and the regression
// test. Reads the orhan reel-analysis ground-truth captionPlan, strips the
// reel-analysis-specific extra fields (color_hex, pos_y, font_height, case)
// down to the schema-compliant Word/CaptionChunk shape, derives a Transcript
// from the chunk word boundaries, and pairs everything with reel-clone-default.
//
// Why this fixture:
// - Real video, real transcript timing — exercises the layout/cascade math
//   under realistic chunk widths instead of synthetic "lorem ipsum" cases.
// - Frozen on disk — no network calls, no Whisper transcription cost on each
//   test run. Re-seed only when the underlying art changes.
// - Lives outside tests/fixtures/golden/ so it can be checked in without LFS.

export type CanonicalFixture = {
  inputVideo: string;
  transcript: Transcript;
  captionPlan: CaptionPlan;
  styleSpec: StyleSpec;
  templateId: string;
  // Frame seconds chosen to span the regression-sensitive moments:
  // entry, anchor-block reveal, mid-cascade, italic accent, plus a sample
  // each from a Vol.02 letter effect tier and a Vol.03 SVG-filter tier.
  frames: ReadonlyArray<{ id: string; t: number }>;
};

type RawWord = Word & Record<string, unknown>;
type RawChunk = { words: RawWord[]; emphasis: boolean[] };

function stripWord(w: RawWord): Word {
  return { word: w.word, start: w.start, end: w.end, confidence: w.confidence };
}

export function loadCanonicalFixture(): CanonicalFixture {
  const root = resolve(HERE, '../..');
  const planPath = resolve(root, 'scripts/reel-analysis/runs/orhan/captionPlan.gt.json');
  const inputVideo = resolve(root, 'scripts/reel-analysis/runs/orhan/input/reel.mp4');

  const raw = JSON.parse(readFileSync(planPath, 'utf8')) as { chunks: RawChunk[] };
  const chunks = raw.chunks.map((c) => ({
    words: c.words.map(stripWord),
    emphasis: c.emphasis,
  }));

  const allWords = chunks.flatMap((c) => c.words);
  const duration = allWords.length > 0
    ? allWords[allWords.length - 1]!.end + 0.5
    : 0;

  const transcript: Transcript = {
    language: 'en',
    duration,
    words: allWords,
  };

  const preset = PRESETS['reel-clone-default']!;

  return {
    inputVideo,
    transcript,
    captionPlan: { chunks },
    styleSpec: preset.styleSpec as StyleSpec,
    templateId: preset.templateId,
    frames: [
      // Tuned to chunk boundaries in the orhan caption plan.
      { id: 'f01-anchor-entry', t: 7.6 },
      { id: 'f02-cascade-mid', t: 11.5 },
      { id: 'f03-progressive', t: 15.2 },
      { id: 'f04-italic-accent', t: 18.0 },
      { id: 'f05-vol02-tier', t: 21.0 },
      { id: 'f06-vol03-filter', t: 24.0 },
    ],
  };
}
