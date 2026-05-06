import { execSync } from 'child_process';
import { mkdirSync, readdirSync, copyFileSync, writeFileSync } from 'fs';
import { join, basename } from 'path';

/**
 * Compare two frames using ffmpeg's PSNR filter.
 * Returns the PSNR value — higher means more similar.
 * Identical frames → Inf. Threshold of ~30 means visually very similar.
 */
function computePSNR(frameA: string, frameB: string): number {
  try {
    const result = execSync(
      `ffmpeg -i "${frameA}" -i "${frameB}" -lavfi psnr -f null - 2>&1 | grep "average"`,
      { encoding: 'utf-8' },
    );
    // Output like: [Parsed_psnr_0 ...] PSNR y:45.12 u:48.33 v:49.01 average:46.15 ...
    const match = result.match(/average:([\d.]+|inf)/i);
    if (match) {
      return match[1] === 'inf' ? Infinity : parseFloat(match[1]);
    }
  } catch {
    // If ffmpeg errors, treat as different
  }
  return 0;
}

export function deduplicateFrames(
  framesDir: string,
  runDir: string,
  threshold = 38,
): string[] {
  const uniqueDir = join(runDir, 'unique');
  mkdirSync(uniqueDir, { recursive: true });

  const allFrames = readdirSync(framesDir)
    .filter((f) => f.endsWith('.png'))
    .sort()
    .map((f) => join(framesDir, f));

  if (allFrames.length === 0) {
    throw new Error('No frames found to deduplicate');
  }

  const kept: string[] = [];

  // Always keep the first frame
  kept.push(allFrames[0]);

  for (let i = 1; i < allFrames.length; i++) {
    const lastKept = kept[kept.length - 1];
    const psnr = computePSNR(lastKept, allFrames[i]);

    // High PSNR = very similar → skip. Low PSNR = different → keep.
    if (psnr < threshold) {
      kept.push(allFrames[i]);
    }
  }

  // Copy unique frames to output directory and record the source-frame index
  // (1fps extraction means source index N → second N in the original video).
  const indexMap: Array<{ uniqueIdx: number; sourceIdx: number; sourceSec: number }> = [];
  kept.forEach((src, idx) => {
    const uniqueIdx = idx + 1;
    const dest = join(uniqueDir, `unique_${String(uniqueIdx).padStart(3, '0')}.png`);
    copyFileSync(src, dest);
    // src basename is `frame_NNN.png` from extract-frames.ts (1fps), so NNN === second
    const m = basename(src).match(/frame_(\d+)\.png$/);
    const sourceIdx = m ? parseInt(m[1]!, 10) : uniqueIdx;
    indexMap.push({ uniqueIdx, sourceIdx, sourceSec: sourceIdx });
  });
  writeFileSync(join(uniqueDir, 'index.json'), JSON.stringify(indexMap, null, 2));

  console.log(`  Kept ${kept.length} of ${allFrames.length} frames (${allFrames.length - kept.length} duplicates removed)`);

  return kept.map((_, idx) => join(uniqueDir, `unique_${String(idx + 1).padStart(3, '0')}.png`));
}
