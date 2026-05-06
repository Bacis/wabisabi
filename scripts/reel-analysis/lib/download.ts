import { execSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';

export function download(url: string, runDir: string): string {
  const inputDir = join(runDir, 'input');
  mkdirSync(inputDir, { recursive: true });
  const output = join(inputDir, 'reel.mp4');

  if (existsSync(output)) {
    console.log(`  Already downloaded: ${output}`);
    return output;
  }

  console.log(`  Downloading: ${url}`);
  execSync(
    `yt-dlp -f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]" --merge-output-format mp4 -o "${output}" "${url}"`,
    { stdio: 'inherit' },
  );

  if (!existsSync(output)) {
    throw new Error('Download failed — no output file produced');
  }

  return output;
}
