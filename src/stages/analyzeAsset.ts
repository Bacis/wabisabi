import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { ffprobe } from './ffprobe.js';
import { extractAudio } from './extractAudio.js';
import { transcribe } from './transcribe.js';
import { detectFaces } from './detectFaces.js';
import { diarize } from './diarize.js';
import { classifyAsset } from './classifyAsset.js';
import type {
  AssetAnalysis,
  Diarization,
  ProductionAsset,
} from '../shared/productionTypes.js';
import type { FaceData, Transcript } from '../shared/types.js';

// Per-asset analysis — runs every available sub-stage in parallel where
// possible. Each sub-stage is wrapped in its own try/catch so a single
// failure doesn't abort the rest of the asset's analysis. The caller
// persists the returned fields as they become available.

export type AnalyzedAsset = {
  durationSec: number;
  width: number | null;
  height: number | null;
  transcript: Transcript | null;
  diarization: Diarization | null;
  faces: FaceData | null;
  analysis: AssetAnalysis | null;
  hasSpeech: boolean;
  speakerCoverage: number | null;
};

async function safeProbe(path: string): Promise<{ width: number | null; height: number | null; duration: number }> {
  try {
    const meta = await ffprobe(path);
    return { width: meta.width, height: meta.height, duration: meta.duration };
  } catch (err) {
    // Images may report 0 duration which is fine. A true probe failure
    // (corrupt file) still blocks analysis for this asset.
    console.warn(`analyzeAsset: ffprobe failed for ${path}:`, (err as Error).message);
    return { width: null, height: null, duration: 0 };
  }
}

function computeSpeakerCoverage(transcript: Transcript | null, durationSec: number): number {
  if (!transcript || transcript.words.length === 0 || durationSec <= 0) return 0;
  // Sum speech-time from word spans, collapsing overlaps. Words are already
  // in chronological order from whisperx.
  let total = 0;
  let lastEnd = 0;
  for (const w of transcript.words) {
    const s = Math.max(w.start, lastEnd);
    const e = Math.max(w.end, s);
    if (e > s) {
      total += e - s;
      lastEnd = e;
    }
  }
  return Math.min(1, total / durationSec);
}

export async function analyzeVideoAsset(asset: ProductionAsset, workDir: string): Promise<AnalyzedAsset> {
  await mkdir(workDir, { recursive: true });
  const { width, height, duration } = await safeProbe(asset.path);

  // Extract audio once; transcribe + diarize share the same WAV to avoid
  // decoding the video twice.
  const audioPath = join(workDir, 'audio.wav');
  let audioOk = false;
  try {
    await extractAudio(asset.path, audioPath);
    const { size } = await import('node:fs/promises').then((m) => m.stat(audioPath));
    audioOk = size > 0;
    console.log(
      `analyzeAsset: extracted audio ${asset.path} -> ${audioPath} (${(size / 1024).toFixed(1)} KB)`,
    );
    if (!audioOk) {
      console.warn(
        `analyzeAsset: audio extract produced empty file — treating as silent`,
      );
    }
  } catch (err) {
    console.warn(`analyzeAsset: extractAudio failed for ${asset.path}:`, (err as Error).message);
  }

  const [transcript, diarization, faces, analysis] = await Promise.all([
    audioOk
      ? transcribe(audioPath).catch((err) => {
          console.warn(`analyzeAsset: transcribe failed: ${(err as Error).message}`);
          return null as Transcript | null;
        })
      : Promise.resolve(null as Transcript | null),
    audioOk
      ? diarize(audioPath).catch((err) => {
          console.warn(`analyzeAsset: diarize failed: ${(err as Error).message}`);
          return null as Diarization | null;
        })
      : Promise.resolve(null as Diarization | null),
    detectFaces(asset.path).catch((err) => {
      console.warn(`analyzeAsset: detectFaces failed: ${(err as Error).message}`);
      return null as FaceData | null;
    }),
    classifyAsset({ kind: 'video', path: asset.path, durationSec: duration }),
  ]);

  const coverage = computeSpeakerCoverage(transcript, duration);
  return {
    durationSec: duration,
    width,
    height,
    transcript,
    diarization,
    faces,
    analysis,
    hasSpeech: (transcript?.words.length ?? 0) > 0 && coverage > 0.05,
    speakerCoverage: transcript ? coverage : null,
  };
}

export async function analyzeImageAsset(asset: ProductionAsset): Promise<AnalyzedAsset> {
  const { width, height } = await safeProbe(asset.path);
  const analysis = await classifyAsset({ kind: 'image', path: asset.path, durationSec: 0 });
  return {
    durationSec: 0,
    width,
    height,
    transcript: null,
    diarization: null,
    faces: null,
    analysis,
    hasSpeech: false,
    speakerCoverage: null,
  };
}
