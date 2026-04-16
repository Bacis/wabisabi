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
import { getLambdaState } from '../worker/remotionLambda.js';
import type { ProductionRenderArgs, ProductionRenderResult } from './renderProduction.js';

const FPS = 30;
const FRAMES_PER_LAMBDA = Number(process.env.LAMBDA_FRAMES ?? 50);

const MIME_FOR_EXT: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.mp3': 'audio/mpeg',
};

// Multi-clip story renderer on Lambda. For every timeline entry we upload
// the cut mp4 (or still image) to the Remotion-managed S3 bucket, presign
// a GET URL Lambda can fetch, and pass an array of URLs into the
// composition props. Narration mp3 is uploaded the same way. Staged input
// clips are cleaned up in the finally block.
//
// The final render stays in S3 at productions/<basename(outputPath)> and
// is returned as an s3:// URI — we no longer download it to local disk.
// An S3 lifecycle rule on the bucket (see ensureOutputLifecycle in s3.ts)
// reclaims the file after a week.
export async function renderProductionLambda(
  args: ProductionRenderArgs,
): Promise<ProductionRenderResult> {
  const state = await getLambdaState();
  // state.region is typed as string but @remotion/lambda wants its narrow
  // AwsRegion union. The state is written by getLambdaState() which already
  // validated it, so the cast is safe.
  const region = state.region as AwsRegion;
  const s3 = new S3Client({ region });

  const stagedKeys: string[] = [];

  async function uploadAndSign(localPath: string, prefix: string): Promise<string> {
    const ext = extname(localPath).toLowerCase();
    const key = `producer-${prefix}/${randomUUID()}${ext || '.bin'}`;
    stagedKeys.push(key);
    await s3.send(
      new PutObjectCommand({
        Bucket: state.bucketName,
        Key: key,
        Body: await readFile(localPath),
        ContentType: MIME_FOR_EXT[ext] ?? 'application/octet-stream',
      }),
    );
    return getSignedUrl(
      s3,
      new GetObjectCommand({ Bucket: state.bucketName, Key: key }),
      { expiresIn: 3600 },
    );
  }

  try {
    const clips = [];
    for (const [i, entry] of args.timeline.entries()) {
      const url = await uploadAndSign(entry.cutPath, `clip-${i}`);
      const durationInFrames = Math.max(1, Math.ceil(entry.cutDurationSec * FPS));
      const caption =
        entry.role !== 'speaker' && entry.narrationIndex !== undefined && args.narrationScript
          ? (args.narrationScript[entry.narrationIndex]?.text ?? undefined)
          : undefined;
      clips.push({
        fileBasename: url,
        kind: entry.role === 'image' ? ('image' as const) : ('video' as const),
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

    let narrationUrl: string | null = null;
    if (args.narrationPath) {
      narrationUrl = await uploadAndSign(args.narrationPath, 'narration');
    }

    // Optional split-screen background clip. Two sources:
    //
    //   * HTTPS URL — the pipeline already fetched a presigned link from
    //     the permanent brain-rot/ prefix in our bucket. Pass through
    //     unchanged; no re-upload, no cleanup (those objects are library
    //     assets owned by scripts/uploadBrainRot.ts, not per-render).
    //
    //   * Local path — dev-mode override. Upload-and-sign it like the
    //     clips; stagedKeys pushes the key so the finally block cleans
    //     it up.
    let backgroundVideo: { src: string; durationInFrames: number } | null = null;
    if (args.brainRotClipPath && args.brainRotDurationSec) {
      const src = args.brainRotClipPath.startsWith('http')
        ? args.brainRotClipPath
        : await uploadAndSign(args.brainRotClipPath, 'brainrot');
      backgroundVideo = {
        src,
        durationInFrames: Math.max(1, Math.ceil(args.brainRotDurationSec * FPS)),
      };
    }

    const totalFrames = Math.max(
      1,
      clips.reduce((s, c) => s + c.durationInFrames, 0),
    );
    const totalChunks = Math.max(1, Math.ceil(totalFrames / FRAMES_PER_LAMBDA));

    // Narration plays after the hook — pipeline shifted the transcript word
    // times, here we tell the composition how many frames to delay <Audio>.
    const hookDurationInFrames = Math.max(
      0,
      Math.round(args.hookDurationSec * FPS),
    );

    const props = {
      clips,
      narrationFile: narrationUrl,
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

    // Durable output key — outputPath looks like ".../storage/productions/<id>/output/<id>.mp4";
    // we just want "<id>.mp4" under the productions/ prefix. The S3 lifecycle
    // rule (7-day expiry on this prefix) reclaims space automatically.
    const outputKey = `productions/${basename(args.outputPath)}`;
    const outputS3Uri = `s3://${state.bucketName}/${outputKey}`;

    console.log(
      `lambda: producer render starting (clips=${clips.length}, chunks=${totalChunks}) -> ${outputS3Uri}`,
    );
    const startedAtIso = new Date().toISOString();
    const startedAt = Date.now();
    const { renderId } = await renderMediaOnLambda({
      region,
      functionName: state.functionName,
      serveUrl: state.serveUrl,
      composition: 'story-composition',
      inputProps: props,
      codec: 'h264',
      framesPerLambda: FRAMES_PER_LAMBDA,
      privacy: 'private',
      maxRetries: 1,
      imageFormat: 'jpeg',
      chromiumOptions: { gl: 'angle' },
      // Write the final mp4 directly to our durable key so we don't have to
      // CopyObject after the fact. bucketName matches state.bucketName so
      // the Lambda role already has write perms.
      outName: { bucketName: state.bucketName, key: outputKey },
    });
    console.log(`lambda: renderId ${renderId}`);

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

    let outputUrl: string | null = null;
    let lastPctLogged = -1;
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
        outputUrl = progress.outputFile ?? null;
        break;
      }
      if (percent !== lastPctLogged) {
        console.log(`lambda: producer render ${percent}%`);
        lastPctLogged = percent;
      }
      await new Promise((r) => setTimeout(r, 1500));
    }

    if (!outputUrl) throw new Error('lambda render finished but no outputFile in progress');
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(`lambda: render done in ${elapsed}s — stored at ${outputS3Uri}`);
    return { outputPath: outputS3Uri };
  } finally {
    for (const key of stagedKeys) {
      s3
        .send(new DeleteObjectCommand({ Bucket: state.bucketName, Key: key }))
        .catch((err) => console.warn(`lambda: delete ${key} failed:`, err));
    }
  }
}
