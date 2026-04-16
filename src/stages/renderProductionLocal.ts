import { renderMedia, selectComposition } from '@remotion/renderer';
import { copyFile, mkdir, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, extname, join } from 'node:path';
import { getRemotionBundle } from '../worker/remotionBundle.js';
import type { ProductionRenderArgs, ProductionRenderResult } from './renderProduction.js';

const FPS = 30;
const GL = (process.env.REMOTION_GL ?? 'angle') as 'angle' | 'egl' | 'swangle' | 'swiftshader';

type StoryClipProp = {
  fileBasename: string;
  kind: 'video' | 'image';
  durationInFrames: number;
  startFromFrame?: number;
  role: 'speaker' | 'broll' | 'image';
  keepAudio: boolean;
  transcript?: unknown;
  captionPlan?: unknown;
  faces?: unknown;
  caption?: string;
};

// Multi-clip story renderer. Stages every cut mp4 + any still images +
// narration.mp3 into the Remotion bundle's public/ dir, then passes them
// as basenames to the 'story-composition' composition. All staged files
// are deleted in a finally block so the public/ dir doesn't accumulate.
export async function renderProductionLocal(
  args: ProductionRenderArgs,
): Promise<ProductionRenderResult> {
  const { serveUrl, publicDir } = await getRemotionBundle();

  const stagedPaths: string[] = [];

  async function stage(srcPath: string, prefix: string): Promise<string> {
    const ext = extname(srcPath) || '.bin';
    const basename = `${prefix}-${randomUUID()}${ext}`;
    const dest = join(publicDir, basename);
    await copyFile(srcPath, dest);
    stagedPaths.push(dest);
    return basename;
  }

  try {
    const clips: StoryClipProp[] = [];
    for (const [i, entry] of args.timeline.entries()) {
      const basename = await stage(entry.cutPath, `clip-${i}`);
      const durationInFrames = Math.max(1, Math.ceil(entry.cutDurationSec * FPS));
      // Caption text for b-roll title card: prefer the narration beat text
      // (makes the visual match the current sentence), fall back to nothing.
      const caption =
        entry.role !== 'speaker' && entry.narrationIndex !== undefined && args.narrationScript
          ? (args.narrationScript[entry.narrationIndex]?.text ?? undefined)
          : undefined;
      clips.push({
        fileBasename: basename,
        kind: entry.role === 'image' ? 'image' : 'video',
        durationInFrames,
        startFromFrame: 0,
        role: entry.role,
        keepAudio: entry.keepAudio,
        transcript: entry.transcript ?? null,
        captionPlan: entry.captionPlan ?? null,
        faces: entry.faces ?? null,
        caption,
      });
    }

    let narrationBasename: string | null = null;
    if (args.narrationPath) {
      narrationBasename = await stage(args.narrationPath, 'narration');
    }

    // Optional split-screen background clip. The composition Loops this to
    // fill each speaker clip's duration, so we only need to stage it once
    // regardless of how many speaker clips are in the timeline.
    let backgroundVideo: { src: string; durationInFrames: number } | null = null;
    if (args.brainRotClipPath && args.brainRotDurationSec) {
      const brainRotBasename = await stage(args.brainRotClipPath, 'brainrot');
      backgroundVideo = {
        src: brainRotBasename,
        durationInFrames: Math.max(1, Math.ceil(args.brainRotDurationSec * FPS)),
      };
    }

    const totalFrames = Math.max(
      1,
      clips.reduce((s, c) => s + c.durationInFrames, 0),
    );

    // Narration plays after the hook. The pipeline has already shifted
    // narration word times by hookDurationSec so global captions line up;
    // here we just tell the template how many frames to offset the <Audio>.
    const hookDurationInFrames = Math.max(
      0,
      Math.round(args.hookDurationSec * FPS),
    );

    const props = {
      clips,
      narrationFile: narrationBasename,
      // Global narration captions — rendered above all clips when present.
      narrationTranscript: args.narrationTranscript ?? null,
      narrationCaptionPlan: args.narrationCaptionPlan ?? null,
      hookDurationInFrames,
      videoMeta: {
        width: 1080,
        height: 1920,
        durationInFrames: totalFrames,
        fps: FPS,
      },
      styleSpec: args.styleSpec,
      backgroundVideo,
    };

    const startedAt = new Date().toISOString();
    let lastWrite = 0;
    const PROGRESS_INTERVAL_MS = 400;

    const composition = await selectComposition({
      serveUrl,
      id: 'story-composition',
      inputProps: props,
    });

    await mkdir(dirname(args.outputPath), { recursive: true });
    await renderMedia({
      composition,
      serveUrl,
      codec: 'h264',
      outputLocation: args.outputPath,
      inputProps: props,
      chromiumOptions: { gl: GL },
      onProgress: ({ renderedFrames, encodedFrames, progress }) => {
        if (!args.onProgress) return;
        const now = Date.now();
        const isFinal = (progress ?? 0) >= 1;
        if (!isFinal && now - lastWrite < PROGRESS_INTERVAL_MS) return;
        lastWrite = now;
        args.onProgress({
          mode: 'local',
          percent: Math.round((progress ?? 0) * 100),
          framesRendered: renderedFrames,
          framesEncoded: encodedFrames,
          totalFrames: composition.durationInFrames,
          startedAt,
          updatedAt: new Date().toISOString(),
        });
      },
    });
    return { outputPath: args.outputPath };
  } finally {
    for (const p of stagedPaths) {
      await rm(p, { force: true }).catch(() => undefined);
    }
  }
}
