import { execSync } from 'child_process';
import { mkdirSync, readdirSync } from 'fs';
import { join } from 'path';

export type VideoMeta = {
  width: number;
  height: number;
  fps: number;
  durationSec: number;
};

export function extractFrames(videoPath: string, runDir: string): { framesDir: string; meta: VideoMeta } {
  const framesDir = join(runDir, 'frames');
  mkdirSync(framesDir, { recursive: true });

  // Check if already extracted
  const existing = readdirSync(framesDir).filter((f) => f.endsWith('.png'));
  if (existing.length > 0) {
    console.log(`  Frames already extracted: ${existing.length} files`);
  } else {
    // Extract 1 frame per second
    console.log(`  Extracting frames at 1fps...`);
    execSync(`ffmpeg -i "${videoPath}" -r 1 -q:v 2 "${join(framesDir, 'frame_%03d.png')}"`, {
      stdio: 'pipe',
    });
    const count = readdirSync(framesDir).filter((f) => f.endsWith('.png')).length;
    console.log(`  Extracted ${count} frames`);
  }

  // Get video metadata
  const probeJson = execSync(
    `ffprobe -v quiet -print_format json -show_streams -show_format "${videoPath}"`,
    { encoding: 'utf-8' },
  );
  const probe = JSON.parse(probeJson);
  const videoStream = probe.streams.find((s: any) => s.codec_type === 'video');

  const meta: VideoMeta = {
    width: videoStream.width,
    height: videoStream.height,
    fps: eval(videoStream.r_frame_rate), // e.g. "30/1" → 30
    durationSec: parseFloat(probe.format.duration),
  };

  return { framesDir, meta };
}
