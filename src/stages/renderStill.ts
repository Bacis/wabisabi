import { renderStill, selectComposition } from '@remotion/renderer';
import { copyFile, mkdir, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, extname, join } from 'node:path';
import type { CaptionPlan, FaceData, Transcript } from '../shared/types.js';
import type { StyleSpec } from '../shared/styleSpec.js';
import { ffprobe } from './ffprobe.js';
import { getRemotionBundle } from '../worker/remotionBundle.js';

const FPS = 30;
const GL = (process.env.REMOTION_GL ?? 'angle') as 'angle' | 'egl' | 'swangle' | 'swiftshader';

export type RenderStillArgs = {
  inputVideo: string;
  transcript: Transcript;
  captionPlan: CaptionPlan | null;
  faces: FaceData | null;
  styleSpec: StyleSpec;
  templateId: string;
  frameSec: number;
  outputPath: string;
};

// Single-frame render via Remotion's `renderStill`. Way faster than a full
// video render (~1-2s vs 60s+) because there's no frame loop, no encoding,
// no mux. Used by the viewer's live preview: the editor posts a candidate
// styleSpec to /jobs/:id/preview, the server renders one frame from the
// existing job's source + transcript + captionPlan + faces with the new
// styleSpec, and returns a PNG the viewer displays.
//
// Reuses the same cached Remotion bundle and the same public/ staging as
// renderLocal — no second bundle, no second Chromium.
export async function renderStillFrame(args: RenderStillArgs): Promise<void> {
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

  try {
    const composition = await selectComposition({
      serveUrl,
      id: args.templateId,
      inputProps: props,
    });

    const frame = Math.max(
      0,
      Math.min(totalFrames - 1, Math.round(args.frameSec * FPS)),
    );

    await mkdir(dirname(args.outputPath), { recursive: true });
    await renderStill({
      composition,
      serveUrl,
      output: args.outputPath,
      inputProps: props,
      frame,
      imageFormat: 'png',
      // See renderLocal.ts for rationale — three-effects needs ANGLE WebGL,
      // and Config.setChromiumOpenGlRenderer doesn't apply to programmatic
      // renderStill calls.
      chromiumOptions: { gl: GL },
    });
  } finally {
    await rm(stagedPath, { force: true }).catch(() => undefined);
  }
}
