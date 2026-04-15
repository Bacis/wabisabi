import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  CutTimelineEntry,
  ProductionAsset,
  TimelineEntry,
} from '../shared/productionTypes.js';

// ffmpeg segment cutter. For each timeline entry, trim the source asset to
// the [inSec, outSec] window and write a per-entry mp4 the renderer can
// stage into Remotion's public/ dir. Tries `-c copy` first (near-free) and
// falls back to a re-encode if the stream copy produces a broken output.
//
// For image assets, cut is a no-op — we pass the original path through and
// the Remotion composition uses <Img> for stills directly.

function runFfmpeg(args: string[]): Promise<{ ok: boolean; stderr: string }> {
  return new Promise((resolveP) => {
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    proc.on('error', () => resolveP({ ok: false, stderr }));
    proc.on('close', (code) => resolveP({ ok: code === 0, stderr }));
  });
}

async function cutVideo(
  sourcePath: string,
  inSec: number,
  durSec: number,
  outPath: string,
): Promise<void> {
  // Stream copy — fast, lossless, works when the cut lands near a keyframe.
  const copyArgs = [
    '-y',
    '-ss', String(inSec),
    '-i', sourcePath,
    '-t', String(durSec),
    '-avoid_negative_ts', 'make_zero',
    '-c', 'copy',
    '-movflags', '+faststart',
    outPath,
  ];
  const copyResult = await runFfmpeg(copyArgs);
  if (copyResult.ok) return;

  // Re-encode fallback. Slower but robust to arbitrary cut points.
  console.warn(
    `cutSegments: -c copy failed for ${sourcePath} @ ${inSec}s, re-encoding`,
  );
  const encodeArgs = [
    '-y',
    '-ss', String(inSec),
    '-i', sourcePath,
    '-t', String(durSec),
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '20',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-movflags', '+faststart',
    outPath,
  ];
  const encodeResult = await runFfmpeg(encodeArgs);
  if (!encodeResult.ok) {
    throw new Error(
      `cutSegments: ffmpeg failed for ${sourcePath}\n${encodeResult.stderr.slice(-400)}`,
    );
  }
}

export type CutSegmentsArgs = {
  timeline: TimelineEntry[];
  assets: ProductionAsset[];
  workDir: string;
};

export async function cutSegments(args: CutSegmentsArgs): Promise<CutTimelineEntry[]> {
  const cutsDir = join(args.workDir, 'cuts');
  await mkdir(cutsDir, { recursive: true });
  const byId = new Map(args.assets.map((a) => [a.id, a]));
  const result: CutTimelineEntry[] = [];

  for (const [i, entry] of args.timeline.entries()) {
    const asset = byId.get(entry.assetId);
    if (!asset) throw new Error(`cutSegments: unknown assetId ${entry.assetId}`);
    const durSec = Math.max(0.1, entry.outSec - entry.inSec);

    if (asset.kind === 'image') {
      // Image clips need no trimming — pass through. Renderer handles stills.
      result.push({
        ...entry,
        cutPath: asset.path,
        cutDurationSec: durSec,
      });
      continue;
    }

    const outPath = join(cutsDir, `${String(i).padStart(3, '0')}.mp4`);
    await cutVideo(asset.path, entry.inSec, durSec, outPath);
    result.push({
      ...entry,
      cutPath: outPath,
      cutDurationSec: durSec,
    });
  }

  return result;
}
