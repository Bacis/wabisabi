import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve as resolvePath } from 'node:path';
import type { FaceData } from '../shared/types.js';

const PYTHON_BIN = process.env.PYTHON_BIN ?? 'python3';
const FACES_SCRIPT = resolvePath(
  process.env.FACES_SCRIPT ?? './transcribe-py/detect_faces.py',
);

// Shell out to the Python sidecar for MediaPipe face detection. Same
// file-based protocol as transcribe.ts so we can't be tripped up by any
// library writing to stdout.
export async function detectFaces(videoPath: string): Promise<FaceData> {
  const dir = await mkdtemp(join(tmpdir(), 'faces-'));
  const outPath = join(dir, 'faces.json');

  try {
    await new Promise<void>((resolveP, rejectP) => {
      const proc = spawn(PYTHON_BIN, [FACES_SCRIPT, videoPath, outPath], {
        stdio: ['ignore', 'inherit', 'inherit'],
      });
      proc.on('error', rejectP);
      proc.on('close', (code) => {
        if (code === 0) resolveP();
        else rejectP(new Error(`detect_faces exited ${code}`));
      });
    });

    return JSON.parse(await readFile(outPath, 'utf8')) as FaceData;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
