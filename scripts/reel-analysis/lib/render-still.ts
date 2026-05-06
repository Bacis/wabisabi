import { execSync } from 'child_process';
import { mkdirSync, writeFileSync, unlinkSync } from 'fs';
import { dirname, resolve, join } from 'path';
import { randomUUID } from 'crypto';
import { tmpdir } from 'os';

export type RenderStillOpts = {
  inputVideo: string;
  transcript: any;
  captionPlan: any;
  faces: any;
  styleSpec: any;
  templateId: string;
  frameSec: number;
  outputPath: string;
};

const WORKER_SCRIPT = resolve(import.meta.dirname, 'render-still-worker.ts');

/**
 * Render a single still frame by shelling out to the worker script.
 */
export function renderStillLocal(opts: RenderStillOpts): void {
  mkdirSync(dirname(opts.outputPath), { recursive: true });

  const projectRoot = resolve(import.meta.dirname, '../../..');

  // Write opts to a temp file
  const tmpPath = join(tmpdir(), `render-still-${randomUUID()}.json`);
  writeFileSync(tmpPath, JSON.stringify({
    inputVideo: resolve(opts.inputVideo),
    transcript: opts.transcript,
    captionPlan: opts.captionPlan,
    faces: opts.faces,
    styleSpec: opts.styleSpec,
    templateId: opts.templateId,
    frameSec: opts.frameSec,
    outputPath: resolve(opts.outputPath),
  }));

  try {
    execSync(`npx tsx "${WORKER_SCRIPT}" "${tmpPath}"`, {
      cwd: projectRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 120000,
      maxBuffer: 50 * 1024 * 1024,
    });
  } finally {
    try { unlinkSync(tmpPath); } catch {}
  }
}
