// Render-side background sampling. Day 15 of the Director feature.
//
// Drives ffmpeg to extract N small RGBA frames per scene group, crops to
// the region where captions are likely to land (default: lower-third
// safe area), runs Day 12's k-means sampler on each, and returns a
// dominant background color per group. Feeds Day 14's `runContrastPass`
// so the planner can write remediated fills/strokes back into the
// DirectorScript before the renderer kicks off.
//
// Two layers:
//   * extractRawFrameRgba — thin wrapper around `ffmpeg -ss -vf
//     crop+scale -f rawvideo`. One spawn per call; small frames are
//     cheap.
//   * sampleBackgroundsForGroups — orchestration. Pure-ish: the extract
//     function is injectable so unit tests can mock the ffmpeg call.
//
// The default extractFn shells out to system ffmpeg the same way
// stages/ffprobe.ts shells out to system ffprobe — both run in the Node
// worker process, never in the browser.

import { spawn } from 'node:child_process';
import type { DirectorScript } from '../shared/director/schema.js';
import { sampleDominantColor } from './sample.js';

export type ExtractRawFrameArgs = {
  videoPath: string;
  timeSec: number;
  /** Pixel crop box on the source frame. Origin top-left. */
  crop: { x: number; y: number; w: number; h: number };
  /** Output downsample dimensions. 16x16 is plenty for dominant-color sampling. */
  scale: { w: number; h: number };
};

export type ExtractRawFrameFn = (args: ExtractRawFrameArgs) => Promise<Uint8ClampedArray>;

// ---------------------------------------------------------------------------
// ffmpeg-backed default. Outputs raw RGBA bytes for a single frame.

export const extractRawFrameRgba: ExtractRawFrameFn = (args) =>
  new Promise<Uint8ClampedArray>((resolveP, rejectP) => {
    const { videoPath, timeSec, crop, scale } = args;
    const vf = `crop=${crop.w}:${crop.h}:${crop.x}:${crop.y},scale=${scale.w}:${scale.h}`;
    const proc = spawn('ffmpeg', [
      '-loglevel', 'error',
      // -ss BEFORE -i is faster (seek before decode) and accurate enough
      // for our purposes — we're sampling representative frames, not
      // frame-perfect editing.
      '-ss', String(timeSec),
      '-i', videoPath,
      '-frames:v', '1',
      '-vf', vf,
      '-f', 'rawvideo',
      '-pix_fmt', 'rgba',
      '-',
    ]);
    const chunks: Buffer[] = [];
    let stderr = '';
    proc.stdout.on('data', (d: Buffer) => chunks.push(d));
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    proc.on('error', rejectP);
    proc.on('close', (code) => {
      if (code !== 0) {
        return rejectP(new Error(`ffmpeg exited ${code} for ${videoPath} @ ${timeSec}s\n${stderr}`));
      }
      const buf = Buffer.concat(chunks);
      const expected = scale.w * scale.h * 4;
      if (buf.length !== expected) {
        return rejectP(
          new Error(
            `ffmpeg produced ${buf.length} bytes; expected ${expected} for ${scale.w}x${scale.h} rgba`,
          ),
        );
      }
      resolveP(new Uint8ClampedArray(buf.buffer, buf.byteOffset, buf.byteLength));
    });
  });

// ---------------------------------------------------------------------------
// Per-group orchestration. Spreads `samplesPerGroup` timestamps across
// each group's word-range (mapped to seconds via the supplied
// `wordTimingsSec` array). Defaults: 5 samples per group, 16x16 grid,
// crop to the lower-third safe area.

export type SampleBackgroundsArgs = {
  videoPath: string;
  videoMeta: { width: number; height: number; duration: number };
  script: DirectorScript;
  /** wordTimingsSec[idx] = start time of word idx, in seconds. */
  wordTimingsSec: number[];
  /** How many frames to extract per group. Defaults to 5. */
  samplesPerGroup?: number;
  /**
   * Crop region as a fraction of the frame (0..1). Defaults to the
   * lower-third safe area: x 0.05..0.95, y 0.55..0.95. The Day 5+
   * placement model could in theory drive this per group; v1 uses the
   * one-size-fits-most default.
   */
  cropFracBox?: { x0: number; y0: number; x1: number; y1: number };
  /** Injected for tests — falls back to extractRawFrameRgba via ffmpeg. */
  extractFn?: ExtractRawFrameFn;
};

const DEFAULT_CROP_FRAC = { x0: 0.05, y0: 0.55, x1: 0.95, y1: 0.95 };

function clampFrac(v: number): number {
  return Math.min(1, Math.max(0, v));
}

function avgRgb(samples: Array<{ dominantRgb: [number, number, number] }>): string {
  if (samples.length === 0) throw new Error('avgRgb: empty');
  let r = 0, g = 0, b = 0;
  for (const s of samples) {
    r += s.dominantRgb[0];
    g += s.dominantRgb[1];
    b += s.dominantRgb[2];
  }
  const n = samples.length;
  const toHex = (v: number) => Math.round(v / n).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export async function sampleBackgroundsForGroups(
  args: SampleBackgroundsArgs,
): Promise<Record<string, string>> {
  const {
    videoPath,
    videoMeta,
    script,
    wordTimingsSec,
    samplesPerGroup = 5,
    cropFracBox = DEFAULT_CROP_FRAC,
    extractFn = extractRawFrameRgba,
  } = args;

  const cx0 = Math.floor(clampFrac(cropFracBox.x0) * videoMeta.width);
  const cy0 = Math.floor(clampFrac(cropFracBox.y0) * videoMeta.height);
  const cx1 = Math.ceil(clampFrac(cropFracBox.x1) * videoMeta.width);
  const cy1 = Math.ceil(clampFrac(cropFracBox.y1) * videoMeta.height);
  const cropW = Math.max(2, cx1 - cx0);
  const cropH = Math.max(2, cy1 - cy0);
  const crop = { x: cx0, y: cy0, w: cropW, h: cropH };
  const scale = { w: 16, h: 16 };

  const out: Record<string, string> = {};
  for (const group of script.groups) {
    const [wStart, wEnd] = group.wordRange;
    const tStart = wordTimingsSec[wStart];
    const tEnd = wordTimingsSec[Math.min(wEnd, wordTimingsSec.length - 1)];
    if (typeof tStart !== 'number' || typeof tEnd !== 'number') continue;

    // Spread N timestamps evenly across the group's time range.
    const ts: number[] = [];
    if (samplesPerGroup <= 1) {
      ts.push((tStart + tEnd) / 2);
    } else {
      for (let i = 0; i < samplesPerGroup; i++) {
        const f = i / (samplesPerGroup - 1);
        const t = tStart + f * (tEnd - tStart);
        // Clamp into the source's playable range.
        ts.push(Math.min(videoMeta.duration - 0.05, Math.max(0, t)));
      }
    }

    const sampled: Array<{ dominantRgb: [number, number, number] }> = [];
    for (const t of ts) {
      try {
        const pixels = await extractFn({ videoPath, timeSec: t, crop, scale });
        const s = sampleDominantColor({ pixels, width: scale.w, height: scale.h });
        sampled.push({ dominantRgb: s.dominantRgb });
      } catch {
        // Individual frame failures don't kill the pass — average over
        // whatever succeeded.
      }
    }
    if (sampled.length > 0) {
      out[group.id] = avgRgb(sampled);
    }
  }
  return out;
}
