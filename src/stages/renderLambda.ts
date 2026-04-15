import {
  renderMediaOnLambda,
  getRenderProgress,
  type AwsRegion,
} from '@remotion/lambda/client';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { ffprobe } from './ffprobe.js';
import { getLambdaState } from '../worker/remotionLambda.js';
import type { RenderArgs, RenderResult } from './render.js';

const FPS = 30;
const FRAMES_PER_LAMBDA = Number(process.env.LAMBDA_FRAMES ?? 50);

// Render via AWS Lambda. Uploads the input video to the Remotion-managed
// bucket under a `caption-inputs/` prefix, presigns a GET URL Lambda can
// fetch, kicks off the render, and writes the output DIRECTLY to a durable
// key under `jobs/` via Remotion's `outName` option. We do NOT download the
// finished mp4 back to local disk — the API endpoint presigns a GET URL on
// demand (see `src/api/server.ts` and `src/lib/s3Outputs.ts`). The
// `jobs/` and `caption-inputs/` prefixes have lifecycle rules that expire
// objects after 1 day, so storage is self-healing.
//
// The composition props mirror the local path exactly, except `videoFile`
// is an https URL instead of a basename — the templates detect the `http`
// prefix and skip `staticFile()` in that case.
export async function renderCaptionsLambda(args: RenderArgs): Promise<RenderResult> {
  const state = await getLambdaState();
  // state.region is typed as string but @remotion/lambda wants its narrow
  // AwsRegion union. The state is written by getLambdaState() which
  // already validated it, so the cast is safe.
  const region = state.region as AwsRegion;
  const s3 = new S3Client({ region });

  const meta = await ffprobe(args.inputVideo);
  const totalFrames = Math.max(1, Math.ceil(meta.duration * FPS));
  const totalChunks = Math.max(1, Math.ceil(totalFrames / FRAMES_PER_LAMBDA));

  // 1. Upload input video to S3 under our prefix.
  const ext = extname(args.inputVideo) || '.mp4';
  const inputKey = `caption-inputs/${randomUUID()}${ext}`;
  console.log(`lambda: uploading input -> s3://${state.bucketName}/${inputKey}`);
  await s3.send(
    new PutObjectCommand({
      Bucket: state.bucketName,
      Key: inputKey,
      Body: await readFile(args.inputVideo),
      ContentType: 'video/mp4',
    }),
  );

  // 2. Presigned GET URL — Lambda fetches the video over HTTPS, no public
  // bucket needed. 1-hour expiry is plenty for any reasonable render.
  const inputUrl = await getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: state.bucketName, Key: inputKey }),
    { expiresIn: 3600 },
  );

  const props = {
    videoFile: inputUrl, // template detects the http prefix and uses it directly
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

  // Durable output key. The pipeline passes outputPath as ".../storage/outputs/<jobId>.mp4";
  // we keep only the basename and stash it under jobs/ in the bucket. The
  // jobs/ lifecycle rule (1-day expiry, see s3Outputs.ts) reclaims space
  // automatically — no local disk involvement.
  const outputKey = `jobs/${basename(args.outputPath)}`;
  const outputS3Uri = `s3://${state.bucketName}/${outputKey}`;

  // 3. Kick off the render. This returns immediately with a renderId; the
  // actual work fans out across multiple Lambda invocations server-side.
  console.log(
    `lambda: render starting (composition=${args.templateId}, framesPerLambda=${FRAMES_PER_LAMBDA}, expectedChunks=${totalChunks}) -> ${outputS3Uri}`,
  );
  const startedAtIso = new Date().toISOString();
  const startedAt = Date.now();
  const { renderId } = await renderMediaOnLambda({
    region,
    functionName: state.functionName,
    serveUrl: state.serveUrl,
    composition: args.templateId,
    inputProps: props,
    codec: 'h264',
    framesPerLambda: FRAMES_PER_LAMBDA,
    privacy: 'private',
    maxRetries: 1,
    imageFormat: 'jpeg',
    // ANGLE WebGL is required by the three-effects template; harmless for
    // the other templates. See renderLocal.ts for the full rationale.
    chromiumOptions: { gl: 'angle' },
    // Write the final mp4 straight to our durable key so we don't have to
    // CopyObject after the fact. Matches the producer-pipeline pattern in
    // renderProductionLambda.ts.
    outName: { bucketName: state.bucketName, key: outputKey },
  });
  console.log(`lambda: renderId ${renderId}`);

  // Initial progress write so the viewer immediately shows "lambda render
  // starting" instead of an empty progress panel.
  args.onProgress?.({
    mode: 'lambda',
    percent: 0,
    framesRendered: 0,
    framesEncoded: 0,
    totalFrames,
    lambdasInvoked: 0,
    totalChunks,
    startedAt: startedAtIso,
    updatedAt: new Date().toISOString(),
  });

  // 4. Poll until done. Remotion returns chunked progress; we surface it as
  // a percent so the user (or `tail -f` on the worker log) can see motion.
  let done = false;
  let lastPctLogged = -1;
  try {
    for (;;) {
      const progress = await getRenderProgress({
        renderId,
        bucketName: state.bucketName,
        functionName: state.functionName,
        region,
      });
      if (progress.fatalErrorEncountered) {
        const msg = progress.errors?.[0]?.message ?? 'unknown error';
        throw new Error(`lambda render failed: ${msg}`);
      }

      const percent = Math.floor((progress.overallProgress ?? 0) * 100);

      // Push progress to the database (via callback) every poll. The poll
      // interval is already 1.5s so we don't need additional throttling.
      args.onProgress?.({
        mode: 'lambda',
        percent,
        framesRendered: progress.framesRendered ?? 0,
        framesEncoded: progress.encodingStatus?.framesEncoded ?? 0,
        totalFrames,
        lambdasInvoked: progress.lambdasInvoked ?? 0,
        totalChunks,
        startedAt: startedAtIso,
        updatedAt: new Date().toISOString(),
      });

      if (progress.done) {
        done = true;
        break;
      }
      if (percent !== lastPctLogged) {
        console.log(`lambda: render ${percent}%`);
        lastPctLogged = percent;
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
  } finally {
    // Best-effort cleanup of the staged input upload, whether we succeeded
    // or not. We leave the rendered output in S3 — the jobs/ lifecycle rule
    // expires it after 1 day.
    s3
      .send(new DeleteObjectCommand({ Bucket: state.bucketName, Key: inputKey }))
      .catch((err) =>
        console.warn(`lambda: failed to delete staged input ${inputKey}:`, err),
      );
  }

  if (!done) throw new Error('lambda render loop exited without completion');

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`lambda: render done in ${elapsed}s — stored at ${outputS3Uri} (not downloaded)`);

  return { outputPath: outputS3Uri };
}
