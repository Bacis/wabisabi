import type { CaptionPlan, FaceData, RenderProgress, Transcript } from '../shared/types.js';
import type { StyleSpec } from '../shared/styleSpec.js';

export type RenderArgs = {
  inputVideo: string;
  transcript: Transcript;
  captionPlan: CaptionPlan | null;
  faces: FaceData | null;
  styleSpec: StyleSpec;
  templateId: string;
  // Hint for where to place the rendered output. Local mode writes the mp4
  // at this path; Lambda mode uses basename(outputPath) as the S3 key under
  // jobs/ and ignores the directory — the return value is the authoritative
  // location.
  outputPath: string;
  // Optional progress callback. The pipeline wires this to the database so
  // the viewer can show live render progress. Both local and lambda modes
  // call it; the shape is unified.
  onProgress?: (progress: RenderProgress) => void;
};

export type RenderResult = {
  // The canonical location of the finished render. Either a local filesystem
  // path (local mode) or an `s3://bucket/key` URI (lambda mode). Callers
  // store this in `jobs.outputPath`; the API endpoint parses it to decide
  // whether to stream from disk or redirect to a presigned URL.
  outputPath: string;
};

const MODE = (process.env.RENDER_MODE ?? 'local').toLowerCase();

// Dispatcher between the local Remotion render and the AWS Lambda render
// path. Each implementation lives in its own file so a local-mode worker
// never imports `@remotion/lambda` (and the AWS SDK it brings along), and a
// lambda-mode worker doesn't need a local Chromium for previews.
//
// Switch via the RENDER_MODE env var:
//   RENDER_MODE=local   (default)  use the local Remotion bundle
//   RENDER_MODE=lambda             render via AWS Lambda
export async function renderCaptions(args: RenderArgs): Promise<RenderResult> {
  if (MODE === 'lambda') {
    const { renderCaptionsLambda } = await import('./renderLambda.js');
    return renderCaptionsLambda(args);
  }
  const { renderCaptionsLocal } = await import('./renderLocal.js');
  return renderCaptionsLocal(args);
}
