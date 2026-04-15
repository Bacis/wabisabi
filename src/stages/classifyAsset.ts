import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';
import { AssetAnalysisSchema, type AssetAnalysis } from '../shared/productionTypes.js';

// Multimodal asset classifier. Sends up to 3 keyframes (videos) or the
// image itself to Claude Haiku and asks for a structured JSON classification
// of the content.
//
// Returns null on any failure (missing API key, network error, malformed
// response) so the orchestrator falls back to geometric heuristics. The
// pipeline never hard-fails on classification — matches the
// enrichTranscript.ts / generateStyle.ts convention.

const SYSTEM_PROMPT = `You classify short-form video clips and images for use as footage in social media edits.

For each input you receive 1-3 images (keyframes of a video, or a single still).

Output ONE JSON object describing the CONTENT you see. No prose, no markdown fences.

Schema:
{
  "subject": string              one-sentence description of what's in frame
  "isPersonOnCamera": boolean    true if a recognizable human face/body is prominently visible
  "sceneTags": string[]          2-5 short tags: setting, action, objects, mood (e.g. "outdoor", "coffee shop", "laptop", "conversation")
  "bRollFriendly": boolean       true if visually engaging without needing audio context (scenery, activity, close-ups)
  "emotionalTone": string        one short phrase: "energetic", "calm", "tense", "playful", etc.
  "caption": string              a concise 5-10 word caption suitable as an on-screen title card
}

Rules:
- Be concrete. Don't guess proper nouns. Describe what you actually see.
- isPersonOnCamera is true only when the person is the clear subject, not a background figure.
- bRollFriendly is about visual interest, not whether speech is happening.
- Output JSON only.`;

type ImageInput = {
  type: 'base64';
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
  data: string;
};

const MIME_BY_EXT: Record<string, ImageInput['mediaType']> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

function mediaTypeForImage(path: string): ImageInput['mediaType'] {
  return MIME_BY_EXT[extname(path).toLowerCase()] ?? 'image/jpeg';
}

// Extract up to 3 keyframes from a video with ffmpeg: first, middle, near
// the end. Sample at 0.05/0.5/0.95 of duration — avoids potentially black
// first/last frames while still covering the clip. The output files are
// jpegs at ~512px to minimize token count. Individual-frame failures are
// tolerated; any successful frame is enough to classify.
async function extractKeyframePaths(
  videoPath: string,
  durationSec: number,
): Promise<{ dir: string; paths: string[] }> {
  const dir = await mkdtemp(join(tmpdir(), 'keyframes-'));
  const times =
    durationSec > 0
      ? [durationSec * 0.05, durationSec * 0.5, durationSec * 0.95]
      : [0];
  const paths: string[] = [];
  for (let i = 0; i < times.length; i++) {
    const out = join(dir, `frame-${i}.jpg`);
    const ok = await runFfmpegExtract(videoPath, times[i] ?? 0, out);
    if (ok) paths.push(out);
  }
  return { dir, paths };
}

function runFfmpegExtract(videoPath: string, atSec: number, outPath: string): Promise<boolean> {
  return new Promise((resolveP) => {
    const proc = spawn(
      'ffmpeg',
      [
        '-y',
        '-ss', String(atSec),
        '-i', videoPath,
        '-frames:v', '1',
        '-vf', 'scale=512:-1',
        '-q:v', '3',
        outPath,
      ],
      { stdio: ['ignore', 'ignore', 'ignore'] },
    );
    proc.on('error', () => resolveP(false));
    proc.on('close', (code) => resolveP(code === 0));
  });
}

async function loadAsBase64(path: string): Promise<ImageInput> {
  const buf = await readFile(path);
  return {
    type: 'base64',
    mediaType: mediaTypeForImage(path),
    data: buf.toString('base64'),
  };
}

export type ClassifyAssetArgs = {
  kind: 'video' | 'image';
  path: string;
  durationSec: number;
};

export async function classifyAsset(args: ClassifyAssetArgs): Promise<AssetAnalysis | null> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log('classifyAsset: ANTHROPIC_API_KEY not set, skipping');
    return null;
  }

  let imageInputs: ImageInput[] = [];
  let cleanup: (() => Promise<void>) | null = null;

  try {
    if (args.kind === 'video') {
      const { dir, paths } = await extractKeyframePaths(args.path, args.durationSec);
      cleanup = async () => rm(dir, { recursive: true, force: true }).catch(() => undefined);
      if (paths.length === 0) {
        console.warn(`classifyAsset: no keyframes extracted for ${args.path}`);
        return null;
      }
      imageInputs = await Promise.all(paths.map(loadAsBase64));
    } else {
      imageInputs = [await loadAsBase64(args.path)];
    }

    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic();

    const content: Array<Record<string, unknown>> = imageInputs.map((img) => ({
      type: 'image',
      source: { type: 'base64', media_type: img.mediaType, data: img.data },
    }));
    content.push({
      type: 'text',
      text: 'Classify this asset. Output JSON only.',
    });

    const start = Date.now();
    const response = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 512,
      system: [
        { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
      ],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      messages: [{ role: 'user', content: content as any }],
    });

    const block = response.content[0];
    const text = block && block.type === 'text' ? block.text : '';
    const cleaned = text
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/, '')
      .trim();

    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      console.warn(`classifyAsset: non-JSON response: ${cleaned.slice(0, 200)}`);
      return null;
    }

    const result = AssetAnalysisSchema.safeParse(parsed);
    if (!result.success) {
      console.warn(
        `classifyAsset: schema mismatch: ${result.error.message.slice(0, 200)}`,
      );
      return null;
    }
    const ms = Date.now() - start;
    console.log(`classifyAsset: ${args.kind} ${ms}ms subject="${result.data.subject.slice(0, 60)}"`);
    return result.data;
  } catch (err) {
    console.warn(`classifyAsset: failed for ${args.path}:`, (err as Error).message);
    return null;
  } finally {
    if (cleanup) await cleanup();
  }
}
