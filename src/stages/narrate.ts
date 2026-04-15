import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { NarrationBeat } from '../shared/productionTypes.js';
import type { Transcript, Word } from '../shared/types.js';

const STORAGE_DIR = resolve(process.env.STORAGE_DIR ?? './storage');

const ELEVENLABS_URL = 'https://api.elevenlabs.io/v1/text-to-speech';
const DEFAULT_MODEL_ID = process.env.ELEVENLABS_MODEL_ID ?? 'eleven_multilingual_v2';

export type NarrateArgs = {
  beats: NarrationBeat[];
  voiceId: string | null;
  workDir: string;
};

export type NarrateResult = {
  // Absolute path to the concatenated narration.mp3, or null if narration
  // generation was skipped (missing API key, all beats failed, etc).
  narrationPath: string | null;
  // The beats' startSec/endSec rewritten to match real audio durations.
  beats: NarrationBeat[];
  // Per-word transcript of the full narration, with timings in the global
  // (concatenated) narration timeline. Null when no audio was produced.
  // Fed to enrichTranscript() for PopWords-style caption chunking.
  transcript: Transcript | null;
};

// ElevenLabs TTS with per-character alignment. We use the
// /with-timestamps endpoint so we can render captions over the narration
// without needing Whisper to re-transcribe our own output.
//
// We generate ONE request per beat (so each beat's audio + alignment are
// cached independently and we get accurate per-beat durations), then
// concatenate the mp3s via ffmpeg and offset each beat's alignment by the
// running cumulative duration.
//
// Missing ELEVENLABS_API_KEY is NOT an error: the pipeline falls back to a
// silent render with a warning log (no transcript either).

type ElevenLabsAlignment = {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
};

type ElevenLabsWithTimestamps = {
  audio_base64: string;
  alignment: ElevenLabsAlignment | null;
  normalized_alignment?: ElevenLabsAlignment | null;
};

function ffprobeDuration(path: string): Promise<number> {
  return new Promise((resolveP, rejectP) => {
    const proc = spawn('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      path,
    ]);
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => (stdout += d.toString()));
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    proc.on('error', rejectP);
    proc.on('close', (code) => {
      if (code !== 0) return rejectP(new Error(`ffprobe exited ${code}: ${stderr}`));
      const dur = parseFloat(stdout.trim());
      if (!Number.isFinite(dur)) return rejectP(new Error(`ffprobe bad duration: ${stdout}`));
      resolveP(dur);
    });
  });
}

function runFfmpegConcat(listPath: string, outPath: string): Promise<void> {
  return new Promise((resolveP, rejectP) => {
    const proc = spawn('ffmpeg', [
      '-y',
      '-f', 'concat',
      '-safe', '0',
      '-i', listPath,
      '-c', 'copy',
      outPath,
    ]);
    let stderr = '';
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    proc.on('error', rejectP);
    proc.on('close', (code) => {
      if (code === 0) resolveP();
      else rejectP(new Error(`ffmpeg concat exited ${code}: ${stderr.slice(-400)}`));
    });
  });
}

function cacheKey(voiceId: string, modelId: string, text: string): string {
  return createHash('sha256').update(`${voiceId}|${modelId}|${text}`).digest('hex');
}

// Cap on the on-disk TTS cache. The cache is content-addressable (SHA256
// of voice+model+text) so hits are free; we just need a bound so a
// long-running service doesn't quietly accumulate gigabytes of unique
// narration forever. 500 MB holds roughly 100 hours of speech which is
// way more than any reasonable retention window needs.
const TTS_CACHE_MAX_BYTES =
  Number(process.env.TTS_CACHE_MAX_MB ?? 500) * 1024 * 1024;

// When the TTS cache exceeds the cap, delete files in least-recently-used
// order (mtime-based) until we're back under. Best-effort — failures are
// swallowed because a slightly-oversize cache is far better than a failed
// render. Called before every synthesize so the cache stays bounded
// without any cron/sweeper infrastructure.
async function trimTtsCache(cacheDir: string): Promise<void> {
  try {
    const entries = await readdir(cacheDir).catch((err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') return [] as string[];
      throw err;
    });
    if (entries.length === 0) return;
    const rows = await Promise.all(
      entries.map(async (name) => {
        const full = join(cacheDir, name);
        const st = await stat(full).catch(() => null);
        return st && st.isFile()
          ? { full, mtimeMs: st.mtimeMs, size: st.size }
          : null;
      }),
    );
    const files = rows.filter((r): r is NonNullable<typeof r> => r !== null);
    const total = files.reduce((s, f) => s + f.size, 0);
    if (total <= TTS_CACHE_MAX_BYTES) return;
    // Oldest first.
    files.sort((a, b) => a.mtimeMs - b.mtimeMs);
    let over = total - TTS_CACHE_MAX_BYTES;
    let freed = 0;
    let removed = 0;
    for (const f of files) {
      if (over <= 0) break;
      await rm(f.full, { force: true }).catch(() => undefined);
      over -= f.size;
      freed += f.size;
      removed++;
    }
    if (removed > 0) {
      console.log(
        `narrate: trimmed TTS cache — removed ${removed} files, freed ${(freed / 1024 / 1024).toFixed(1)} MB`,
      );
    }
  } catch (err) {
    console.warn('narrate: TTS cache trim failed:', (err as Error).message);
  }
}

// Group aligned characters into words. Whitespace characters delimit words;
// punctuation is kept attached to whatever word it's adjacent to so the
// rendered captions read naturally.
function alignmentToWords(alignment: ElevenLabsAlignment): Word[] {
  const { characters, character_start_times_seconds, character_end_times_seconds } = alignment;
  const words: Word[] = [];
  let current = '';
  let currentStart = 0;
  let currentEnd = 0;
  let currentHasChars = false;
  for (let i = 0; i < characters.length; i++) {
    const ch = characters[i] ?? '';
    const cs = character_start_times_seconds[i] ?? 0;
    const ce = character_end_times_seconds[i] ?? cs;
    if (/\s/.test(ch)) {
      if (currentHasChars) {
        words.push({
          word: current.trim(),
          start: currentStart,
          end: currentEnd,
          confidence: 1,
        });
        current = '';
        currentHasChars = false;
      }
      continue;
    }
    if (!currentHasChars) {
      currentStart = cs;
      currentHasChars = true;
    }
    current += ch;
    currentEnd = ce;
  }
  if (currentHasChars && current.trim().length > 0) {
    words.push({
      word: current.trim(),
      start: currentStart,
      end: currentEnd,
      confidence: 1,
    });
  }
  return words;
}

type BeatOutput = {
  mp3Path: string;
  duration: number;
  alignment: ElevenLabsAlignment | null;
};

async function synthesizeOne(
  voiceId: string,
  modelId: string,
  text: string,
  mp3Path: string,
  alignmentPath: string,
  apiKey: string,
): Promise<ElevenLabsAlignment | null> {
  const cacheDir = join(STORAGE_DIR, 'cache', 'tts');
  await mkdir(cacheDir, { recursive: true });
  // Keep the cache bounded — every new synthesis that misses cache grows
  // the directory. Cheap (one readdir+stat per file) at the sizes we care
  // about, and runs before the write so the cap holds tight.
  await trimTtsCache(cacheDir);
  const key = cacheKey(voiceId, modelId, text);
  const cachedMp3 = join(cacheDir, `${key}.mp3`);
  const cachedAlign = join(cacheDir, `${key}.alignment.json`);

  if (existsSync(cachedMp3)) {
    await copyFile(cachedMp3, mp3Path);
    if (existsSync(cachedAlign)) {
      const json = await readFile(cachedAlign, 'utf8');
      await writeFile(alignmentPath, json);
      return JSON.parse(json) as ElevenLabsAlignment;
    }
    // Old cache entry without alignment — re-fetch from API to get it.
  }

  const res = await fetch(`${ELEVENLABS_URL}/${voiceId}/with-timestamps`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      text,
      model_id: modelId,
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    }),
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => '');
    throw new Error(`ElevenLabs ${res.status} ${res.statusText}: ${msg.slice(0, 200)}`);
  }
  const body = (await res.json()) as ElevenLabsWithTimestamps;
  if (!body.audio_base64) throw new Error('ElevenLabs response missing audio_base64');
  const audio = Buffer.from(body.audio_base64, 'base64');
  await writeFile(cachedMp3, audio);
  await copyFile(cachedMp3, mp3Path);
  // The normalized alignment is usually preferable for rendering — it collapses
  // contractions like "don't" into a single word span. Fall back to the raw
  // alignment if the normalized variant is absent.
  const alignment = body.normalized_alignment ?? body.alignment ?? null;
  if (alignment) {
    const json = JSON.stringify(alignment);
    await writeFile(cachedAlign, json);
    await writeFile(alignmentPath, json);
  }
  return alignment;
}

export async function narrate(args: NarrateArgs): Promise<NarrateResult> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    console.warn('narrate: ELEVENLABS_API_KEY not set — rendering silent');
    return { narrationPath: null, beats: args.beats, transcript: null };
  }
  const voiceId = args.voiceId ?? process.env.ELEVENLABS_VOICE_ID ?? '';
  if (!voiceId) {
    console.warn('narrate: no voiceId (set ELEVENLABS_VOICE_ID) — rendering silent');
    return { narrationPath: null, beats: args.beats, transcript: null };
  }
  if (args.beats.length === 0) {
    return { narrationPath: null, beats: args.beats, transcript: null };
  }

  const beatsDir = join(args.workDir, 'beats');
  await mkdir(beatsDir, { recursive: true });

  const beatOutputs: BeatOutput[] = [];
  const rewritten: NarrationBeat[] = [];
  let cursor = 0;

  for (let i = 0; i < args.beats.length; i++) {
    const beat = args.beats[i];
    if (!beat) continue;
    const mp3Path = join(beatsDir, `beat-${String(i).padStart(3, '0')}.mp3`);
    const alignPath = join(beatsDir, `beat-${String(i).padStart(3, '0')}.alignment.json`);
    try {
      const alignment = await synthesizeOne(
        voiceId,
        DEFAULT_MODEL_ID,
        beat.text,
        mp3Path,
        alignPath,
        apiKey,
      );
      const dur = await ffprobeDuration(mp3Path);
      beatOutputs.push({ mp3Path, duration: dur, alignment });
      rewritten.push({ text: beat.text, startSec: cursor, endSec: cursor + dur });
      cursor += dur;
    } catch (err) {
      console.warn(`narrate: beat ${i} failed: ${(err as Error).message}`);
      const estDur = beat.endSec - beat.startSec;
      rewritten.push({ text: beat.text, startSec: cursor, endSec: cursor + estDur });
      cursor += estDur;
    }
  }

  const successfulBeats = beatOutputs.length;
  if (successfulBeats === 0) {
    console.warn('narrate: all beats failed — rendering silent');
    return { narrationPath: null, beats: args.beats, transcript: null };
  }

  // Concatenate successful beat mp3s.
  const listPath = join(args.workDir, 'beats.txt');
  const listContent = beatOutputs
    .map((b) => `file '${b.mp3Path.replace(/'/g, "'\\''")}'`)
    .join('\n');
  await writeFile(listPath, listContent);
  const narrationPath = join(args.workDir, 'narration.mp3');
  await runFfmpegConcat(listPath, narrationPath);

  // Build the global narration transcript by offsetting each beat's per-
  // word alignment by the running cumulative duration. Beats whose
  // alignment is null contribute no words; the caption layer will simply
  // go silent during those segments.
  const allWords: Word[] = [];
  let offset = 0;
  for (let i = 0; i < args.beats.length; i++) {
    const beat = args.beats[i];
    if (!beat) continue;
    const out = beatOutputs.find((b, idx) =>
      // match by beat index — we iterate both arrays in the same order but
      // a failed beat is absent from beatOutputs. Use position-independent
      // linear scan but break early on length.
      idx >= 0 ? b.mp3Path.includes(`beat-${String(i).padStart(3, '0')}`) : false,
    );
    if (!out) continue;
    if (out.alignment) {
      const words = alignmentToWords(out.alignment);
      for (const w of words) {
        allWords.push({
          word: w.word,
          start: w.start + offset,
          end: w.end + offset,
          confidence: w.confidence,
        });
      }
    }
    offset += out.duration;
  }

  const transcript: Transcript | null =
    allWords.length > 0
      ? {
          language: 'en',
          duration: cursor,
          words: allWords,
        }
      : null;

  console.log(
    `narrate: ${successfulBeats}/${args.beats.length} beats, total ~${cursor.toFixed(1)}s, ${allWords.length} words -> ${narrationPath}`,
  );
  return { narrationPath, beats: rewritten, transcript };
}
