import { renderMedia, selectComposition } from '@remotion/renderer';
import { copyFile, mkdir, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, extname, join } from 'node:path';
import { ffprobe } from './ffprobe.js';
import { getRemotionBundle } from '../worker/remotionBundle.js';
import type { RenderArgs, RenderResult } from './render.js';

const FPS = 30;
const GL = (process.env.REMOTION_GL ?? 'angle') as 'angle' | 'egl' | 'swangle' | 'swiftshader';

// Render the captioned video using Remotion's local Node API. The Remotion
// site is bundled once at worker startup (see remotionBundle.ts) and the
// cached serve URL is reused on every call. The input video is staged into
// the bundle's public/ dir so the render's static handler can serve it via
// staticFile() — Remotion's renderer only fetches http(s) assets, not file://.
export async function renderCaptionsLocal(args: RenderArgs): Promise<RenderResult> {
  const meta = await ffprobe(args.inputVideo);
  const { serveUrl, publicDir } = await getRemotionBundle();

  const ext = extname(args.inputVideo) || '.mp4';
  const stagedName = `${randomUUID()}${ext}`;
  const stagedPath = join(publicDir, stagedName);
  await copyFile(args.inputVideo, stagedPath);

  const totalFrames = Math.max(1, Math.ceil(meta.duration * FPS));

  const props = {
    videoFile: stagedName,
    videoMeta: {
      width: meta.width,
      height: meta.height,
      durationInFrames: totalFrames,
      fps: FPS,
    },
    transcript: args.transcript,
    captionPlan: args.captionPlan,
    faces: args.faces,
    styleSpec: args.styleSpec,
  };

  const startedAt = new Date().toISOString();
  // Throttle progress writes — renderMedia's onProgress fires very rapidly
  // (multiple times per frame) and we don't need every update to hit SQLite.
  let lastWrite = 0;
  const PROGRESS_INTERVAL_MS = 400;

  try {
    const composition = await selectComposition({
      serveUrl,
      id: args.templateId,
      inputProps: props,
    });

    await mkdir(dirname(args.outputPath), { recursive: true });
    await renderMedia({
      composition,
      serveUrl,
      codec: 'h264',
      outputLocation: args.outputPath,
      inputProps: props,
      // ANGLE gives the headless Chromium hardware-accelerated WebGL,
      // required by the three-effects template's react-three-fiber canvas.
      // SwiftShader (the default) cannot create a WebGL context. The
      // setting in remotion.config.ts only applies to the CLI; programmatic
      // renderMedia calls need this explicitly. Harmless for the other
      // templates which don't use WebGL.
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
  } finally {
    await rm(stagedPath, { force: true }).catch(() => undefined);
  }

  return { outputPath: args.outputPath };
}
