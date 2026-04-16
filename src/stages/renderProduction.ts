import type { CutTimelineEntry, NarrationBeat } from '../shared/productionTypes.js';
import type { CaptionPlan, RenderProgress, Transcript } from '../shared/types.js';
import type { StyleSpec } from '../shared/styleSpec.js';

export type ProductionRenderArgs = {
  timeline: CutTimelineEntry[];
  narrationPath: string | null;
  narrationScript: NarrationBeat[] | null;
  // Per-word transcript of the narration (in global output-timeline seconds)
  // plus an optional enrichTranscript() chunking. StoryComposition renders
  // these as a global caption overlay above the <Series>. Null when no
  // narration was produced or narration had no word alignment.
  narrationTranscript: Transcript | null;
  narrationCaptionPlan: CaptionPlan | null;
  // Seconds of hook-clip content prepended to the timeline. Narration audio
  // is delayed by this much inside the composition so it starts after the
  // hook ends. Zero when no hook was prepended (empty hooks dir, etc.).
  hookDurationSec: number;
  styleSpec: StyleSpec;
  // Optional split-screen background clip (brain-rot lower half). When null
  // the composition renders every clip full-frame as before. Populated by
  // the producer pipeline after consulting styleSpec.splitScreen.brainRot;
  // if the library folder is empty the pipeline leaves these null and logs
  // a warning so the render still succeeds.
  brainRotClipPath?: string | null;
  brainRotDurationSec?: number | null;
  outputPath: string;
  onProgress?: (progress: RenderProgress) => void;
};

const MODE = (process.env.RENDER_MODE ?? 'local').toLowerCase();

// Final location of the rendered mp4. For local mode this is the absolute
// path on disk (matches args.outputPath). For lambda mode this is the
// durable S3 URI ("s3://<bucket>/productions/<id>.mp4") — lambda renders
// no longer round-trip through local disk, so the S3 URI is authoritative
// and the value callers should persist.
export type ProductionRenderResult = {
  outputPath: string;
};

// Mirror of src/stages/render.ts but for the producer's multi-clip
// composition. Keeps the local/lambda split so a local-mode worker doesn't
// pull in `@remotion/lambda` (and the AWS SDK), and lambda-mode doesn't
// need a local Chromium.
export async function renderProduction(
  args: ProductionRenderArgs,
): Promise<ProductionRenderResult> {
  if (MODE === 'lambda') {
    const { renderProductionLambda } = await import('./renderProductionLambda.js');
    return renderProductionLambda(args);
  }
  const { renderProductionLocal } = await import('./renderProductionLocal.js');
  return renderProductionLocal(args);
}
