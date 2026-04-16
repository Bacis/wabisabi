import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { getLambdaState } from '../worker/remotionLambda.js';

// Curated library of short AI "brain-rot" clips. Two sources, tried in
// order:
//
//   1. Local /storage/brain-rot/*.mp4 — convenient for dev renders. Not
//      swept by the retention cron since it's a permanent asset library,
//      not a per-job input.
//
//   2. Remotion Lambda bucket, `brain-rot/` prefix — the production path.
//      Populated once by `scripts/uploadBrainRot.ts`. The pipeline lists
//      this prefix, picks a key, and returns a presigned HTTPS URL that
//      ffprobe + Remotion Lambda both fetch directly — no per-job upload.
//
// Railway's /app/storage volume doesn't need the files in production; S3
// is authoritative once you've run the upload script.
const BRAIN_ROT_DIR = join(
  resolve(process.env.STORAGE_DIR ?? './storage'),
  'brain-rot',
);

export const BRAIN_ROT_S3_PREFIX = 'brain-rot/';

const VIDEO_EXTS = new Set(['.mp4', '.mov', '.webm']);

// Cheap deterministic string hash (djb2). Same seed → same pick so
// reprocess / debug replays reach for the same clip.
function hashSeed(seed: string): number {
  let h = 5381;
  for (let i = 0; i < seed.length; i++) {
    h = ((h << 5) + h + seed.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function isVideo(name: string): boolean {
  const dot = name.lastIndexOf('.');
  if (dot < 0) return false;
  return VIDEO_EXTS.has(name.slice(dot).toLowerCase());
}

async function listLocal(): Promise<string[] | null> {
  try {
    const entries = await readdir(BRAIN_ROT_DIR);
    const videos = entries.filter(isVideo).sort();
    return videos.length > 0 ? videos : null;
  } catch {
    return null;
  }
}

// List the brain-rot/ prefix in the Remotion bucket. Returns null when
// the bucket has no keys under the prefix (i.e. upload script hasn't
// been run yet). Errors bubble up so the caller can log them clearly
// instead of silently degrading.
async function listS3(): Promise<{ bucket: string; region: string; keys: string[] } | null> {
  const state = await getLambdaState();
  const s3 = new S3Client({ region: state.region });
  const res = await s3.send(
    new ListObjectsV2Command({
      Bucket: state.bucketName,
      Prefix: BRAIN_ROT_S3_PREFIX,
    }),
  );
  const keys = (res.Contents ?? [])
    .map((o) => o.Key ?? '')
    .filter((k) => k !== '' && isVideo(k))
    .sort();
  if (keys.length === 0) return null;
  return { bucket: state.bucketName, region: state.region, keys };
}

async function presignS3(bucket: string, region: string, key: string): Promise<string> {
  const s3 = new S3Client({ region });
  return getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: bucket, Key: key }),
    // 1h is plenty — ffprobe happens within seconds of the pick and
    // Lambda finishes the render well before expiry.
    { expiresIn: 3600 },
  );
}

// Returns either an absolute local path or a presigned HTTPS URL. The
// pipeline threads this through `brainRotClipPath` unchanged; ffprobe
// accepts both, and the stagers detect the `http` prefix and pass it to
// the composition directly without re-staging.
//
// Null when neither source has any clips — the caller treats that as
// "effect skipped" with a warning log, so renders don't fail on empty
// libraries.
export async function pickRandomBrainRotClip(seed: string): Promise<string | null> {
  const local = await listLocal();
  if (local) {
    const idx = hashSeed(seed) % local.length;
    return join(BRAIN_ROT_DIR, local[idx]!);
  }
  let s3: Awaited<ReturnType<typeof listS3>> = null;
  try {
    s3 = await listS3();
  } catch (err) {
    console.warn('brainRotPool: failed to list S3 library:', err);
    return null;
  }
  if (!s3) return null;
  const idx = hashSeed(seed) % s3.keys.length;
  const key = s3.keys[idx]!;
  return presignS3(s3.bucket, s3.region, key);
}
