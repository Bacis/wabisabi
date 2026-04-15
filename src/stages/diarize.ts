import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve as resolvePath } from 'node:path';
import type { Diarization } from '../shared/productionTypes.js';

const PYTHON_BIN = process.env.PYTHON_BIN ?? 'python3';
const DIARIZE_SCRIPT = resolvePath(
  process.env.DIARIZE_SCRIPT ?? './transcribe-py/diarize.py',
);

// Shell out to the Python diarization sidecar. Same file-based protocol as
// transcribe.ts and detectFaces.ts. The sidecar soft-fails (writes empty
// result) on missing HF token or pyannote errors — callers should treat an
// empty `segments` array as "no diarization available", not a crash.
export async function diarize(audioPath: string): Promise<Diarization> {
  const dir = await mkdtemp(join(tmpdir(), 'diarize-'));
  const outPath = join(dir, 'diarize.json');

  try {
    await new Promise<void>((resolveP, rejectP) => {
      const proc = spawn(PYTHON_BIN, [DIARIZE_SCRIPT, audioPath, outPath], {
        stdio: ['ignore', 'inherit', 'inherit'],
      });
      proc.on('error', rejectP);
      proc.on('close', (code) => {
        if (code === 0) resolveP();
        else rejectP(new Error(`diarize exited ${code}`));
      });
    });

    return JSON.parse(await readFile(outPath, 'utf8')) as Diarization;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
