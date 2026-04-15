import { spawn } from 'node:child_process';

export type VideoMeta = { width: number; height: number; duration: number };

// Probe the input video for dimensions and duration. Doing this in Node
// (rather than inside Remotion's calculateMetadata) avoids needing the
// browser-side `parseMedia` to fetch local file paths it can't reach. Used
// by both the local and Lambda render paths.
export function ffprobe(input: string): Promise<VideoMeta> {
  return new Promise((resolveP, rejectP) => {
    const proc = spawn('ffprobe', [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height:format=duration',
      '-of', 'json',
      input,
    ]);
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    proc.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    proc.on('error', rejectP);
    proc.on('close', (code) => {
      if (code !== 0) return rejectP(new Error(`ffprobe exited ${code}\n${stderr}`));
      try {
        const j = JSON.parse(stdout);
        const stream = j.streams?.[0];
        resolveP({
          width: Number(stream?.width),
          height: Number(stream?.height),
          duration: parseFloat(j.format?.duration ?? '0'),
        });
      } catch (e) {
        rejectP(e as Error);
      }
    });
  });
}
