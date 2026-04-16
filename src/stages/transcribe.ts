import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve as resolvePath } from 'node:path';
import type { Transcript } from '../shared/types.js';

const PYTHON_BIN = process.env.PYTHON_BIN ?? 'python3';
const TRANSCRIBE_SCRIPT = resolvePath(
  process.env.TRANSCRIBE_SCRIPT ?? './transcribe-py/transcribe.py',
);

// Shell out to the Python sidecar. The transcript JSON is written to a
// temp file (not stdout) because some PyTorch helpers print progress
// directly to stdout and would corrupt a stdout-based protocol. The
// sidecar's stdout/stderr both stream through to the worker logs.
//
// VAD retry: Silero VAD (the default in faster-whisper) occasionally
// classifies an entire clip as silence when the speaker's audio is
// quiet, has background noise, or has a non-studio delivery. We've
// observed this on legitimate speaker-to-camera clips, where it
// cascades into a mis-classification as narrated_story (mode detector
// sees hasSpeech=0) and the speaker's original audio gets replaced
// by TTS narration. To guard against that: run the default pass, and
// if it returns zero words, retry once with `--no-vad`. The second
// pass is slower and can hallucinate on genuinely-silent input, but
// the cost of a wrong empty is much higher than a few spurious words
// on silence — silence rarely gets uploaded as part of a production.
export async function transcribe(audioPath: string): Promise<Transcript> {
  console.log(`transcribe: starting pass 1 (vad_filter=true) on ${audioPath}`);
  const first = await runTranscribe(audioPath, { noVad: false });
  console.log(
    `transcribe: pass 1 done — ${first.words.length} words, lang=${first.language}, audioDuration=${first.duration.toFixed(2)}s`,
  );
  if (first.words.length > 0) return first;

  console.warn(
    'transcribe: pass 1 returned 0 words; retrying with --no-vad (VAD likely suppressed speech)',
  );
  const second = await runTranscribe(audioPath, { noVad: true });
  console.log(
    `transcribe: pass 2 done — ${second.words.length} words, lang=${second.language}`,
  );
  if (second.words.length === 0) {
    console.warn(
      'transcribe: pass 2 without VAD also returned 0 words — check PYTHON stderr above for faster-whisper diagnostics',
    );
  } else {
    console.log(`transcribe: retry recovered ${second.words.length} words`);
  }
  return second;
}

async function runTranscribe(
  audioPath: string,
  opts: { noVad: boolean },
): Promise<Transcript> {
  const dir = await mkdtemp(join(tmpdir(), 'transcribe-'));
  const outPath = join(dir, 'transcript.json');
  const args = [TRANSCRIBE_SCRIPT, audioPath, outPath];
  if (opts.noVad) args.push('--no-vad');

  try {
    await new Promise<void>((resolveP, rejectP) => {
      const proc = spawn(PYTHON_BIN, args, {
        stdio: ['ignore', 'inherit', 'inherit'],
      });
      proc.on('error', rejectP);
      proc.on('close', (code) => {
        if (code === 0) resolveP();
        else rejectP(new Error(`transcribe exited ${code}`));
      });
    });

    const raw = await readFile(outPath, 'utf8');
    return JSON.parse(raw) as Transcript;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
