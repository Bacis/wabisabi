// S3 output helpers for the caption + producer pipelines.
//
// In lambda render mode, finished mp4s live in S3 rather than on local
// disk. These helpers (1) parse + presign an `s3://` URI when the API
// needs to hand a URL to a downstream (Telegram bot, browser redirect),
// and (2) install lifecycle rules on the bucket so our prefixes are
// garbage-collected automatically — the Railway container must never grow
// unbounded storage, and S3 must never accumulate stale renders.
//
// Prefix inventory (all in the Remotion-managed bucket):
//   jobs/              — single-video caption outputs    (1d expiry)
//   caption-inputs/    — staged inputs for single jobs   (1d expiry)
//   producer-clip-*/   — staged cuts for producer jobs   (1d expiry)
//   producer-narration/— staged narration mp3s           (1d expiry)
//   productions/       — finished producer outputs       (7d expiry)
//   user-videos/       — persistent user uploads         (90d safety net)

import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  PutBucketLifecycleConfigurationCommand,
  GetBucketLifecycleConfigurationCommand,
  PutBucketCorsCommand,
  GetBucketCorsCommand,
  type LifecycleRule,
  type CORSRule,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REGION = process.env.AWS_REGION ?? 'us-east-1';
// Prefix under which rendered productions live. Matches the key we pass to
// renderMediaOnLambda's `outName` in renderProductionLambda.ts — if you
// change one, change the other.
export const OUTPUTS_PREFIX = 'productions/';

// All prefixes we install lifecycle rules for. Each entry is (rule id,
// prefix, expiry in days). Rule ids are stable so `ensureBucketLifecycle`
// is idempotent — we replace only our own rules and preserve any others
// the operator or Remotion added.
const OWNED_RULES: Array<{ id: string; prefix: string; days: number }> = [
  { id: 'captions-jobs-1d-expiry', prefix: 'jobs/', days: 1 },
  { id: 'captions-inputs-1d-expiry', prefix: 'caption-inputs/', days: 1 },
  { id: 'producer-clips-1d-expiry', prefix: 'producer-clip-', days: 1 },
  { id: 'producer-narration-1d-expiry', prefix: 'producer-narration/', days: 1 },
  { id: 'producer-outputs-7d-expiry', prefix: OUTPUTS_PREFIX, days: 7 },
  // user-videos: persistent user uploads. The user_videos row controls
  // intended retention; this 90d rule is a safety net so abandoned objects
  // (init'd but never finalized, or rows deleted from DB without an S3
  // delete) eventually GC themselves.
  { id: 'user-videos-90d-expiry', prefix: 'user-videos/', days: 90 },
];
const OWNED_RULE_IDS = new Set(OWNED_RULES.map((r) => r.id));

let cachedClient: S3Client | null = null;
function getClient(): S3Client {
  if (!cachedClient) cachedClient = new S3Client({ region: REGION });
  return cachedClient;
}

export type ParsedS3Uri = { bucket: string; key: string };

/**
 * Returns the parsed { bucket, key } if `value` is an s3:// URI, otherwise
 * null. A null return means "this is a local path, handle it as a file".
 */
export function parseS3Uri(value: string): ParsedS3Uri | null {
  if (!value.startsWith('s3://')) return null;
  const rest = value.slice('s3://'.length);
  const slash = rest.indexOf('/');
  if (slash <= 0) return null;
  const bucket = rest.slice(0, slash);
  const key = rest.slice(slash + 1);
  if (!bucket || !key) return null;
  return { bucket, key };
}

/**
 * Stream an S3 object body. The API's /jobs/:id/output endpoint uses this
 * to relay the rendered mp4 through the server (rather than 302-redirecting
 * the browser to a presigned URL) when the caller wants a silent download
 * — that keeps the response same-origin and avoids the brief navigation
 * flash the redirect path introduces.
 */
export async function fetchOutputStream(
  uri: string,
): Promise<{ body: NodeJS.ReadableStream; contentLength?: number }> {
  const parsed = parseS3Uri(uri);
  if (!parsed) throw new Error(`fetchOutputStream: not an s3:// uri: ${uri}`);
  const obj = await getClient().send(
    new GetObjectCommand({ Bucket: parsed.bucket, Key: parsed.key }),
  );
  const body = obj.Body;
  if (!body || typeof (body as NodeJS.ReadableStream).pipe !== 'function') {
    throw new Error('S3 GetObject returned no streamable body');
  }
  return {
    body: body as NodeJS.ReadableStream,
    contentLength: typeof obj.ContentLength === 'number' ? obj.ContentLength : undefined,
  };
}

/**
 * Sign a time-limited GET URL for a rendered output. One hour is plenty —
 * the API hands this URL to a browser redirect or the Telegram bot which
 * fetches it immediately.
 *
 * `downloadFilename` (optional) bakes a `Content-Disposition: attachment`
 * response-header override into the signed URL so the browser saves the
 * file instead of navigating to it. This matters for the editor's
 * "Export render" flow: a plain redirect to S3 would render the mp4
 * inline; with the disposition set, the same redirect triggers a save.
 */
export async function presignOutputUrl(
  uri: string,
  expiresInSec = 3600,
  downloadFilename?: string,
): Promise<string> {
  const parsed = parseS3Uri(uri);
  if (!parsed) throw new Error(`presignOutputUrl: not an s3:// uri: ${uri}`);
  return getSignedUrl(
    getClient(),
    new GetObjectCommand({
      Bucket: parsed.bucket,
      Key: parsed.key,
      ...(downloadFilename
        ? {
            ResponseContentDisposition: `attachment; filename="${downloadFilename.replace(/"/g, '')}"`,
          }
        : {}),
    }),
    { expiresIn: expiresInSec },
  );
}

/**
 * Sign a time-limited PUT URL the browser can use to upload bytes directly
 * to S3, bypassing our Fastify container entirely. Used by the user-videos
 * upload flow: the API mints one of these in /uploads/init and the browser
 * PUTs the file at the returned URL. 15 minutes is enough for a 2 GB upload
 * on a reasonable connection but tight enough that stale URLs aren't useful
 * to an attacker who scraped one out of a log.
 *
 * The `contentType` is signed into the URL — the browser MUST send the same
 * `Content-Type` header on its PUT or S3 rejects the request.
 */
export async function presignPutUrl(
  bucket: string,
  key: string,
  contentType: string,
  expiresInSec = 900,
): Promise<string> {
  return getSignedUrl(
    getClient(),
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: contentType,
    }),
    { expiresIn: expiresInSec },
  );
}

/**
 * HEAD an S3 object. Returns null if the object doesn't exist, the metadata
 * otherwise. Used at /uploads/:id/finalize to verify the client's PUT
 * actually landed before we flip the row to 'ready'.
 */
export async function headObject(
  bucket: string,
  key: string,
): Promise<{ contentLength?: number; contentType?: string } | null> {
  try {
    const res = await getClient().send(
      new HeadObjectCommand({ Bucket: bucket, Key: key }),
    );
    return {
      contentLength: typeof res.ContentLength === 'number' ? res.ContentLength : undefined,
      contentType: typeof res.ContentType === 'string' ? res.ContentType : undefined,
    };
  } catch (err) {
    const name = (err as Error & { name?: string }).name;
    if (name === 'NotFound' || name === 'NoSuchKey') return null;
    throw err;
  }
}

/**
 * Delete an S3 object. Idempotent — if the key is already gone, S3 returns
 * 204 and we return cleanly. Used by /uploads/:id DELETE.
 */
export async function deleteObject(bucket: string, key: string): Promise<void> {
  await getClient().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

/**
 * Resolve the bucket we upload user videos into. Reuses the same bucket as
 * rendered outputs (set up by Remotion or the operator) — there's no reason
 * to maintain a separate one. Resolution order:
 *
 *   1. AWS_S3_BUCKET  (explicit operator override)
 *   2. REMOTION_AWS_BUCKET  (parity with @remotion/lambda config)
 *   3. storage/lambda-state.json bucketName  (auto-discovered after a
 *      successful lambda deploy — Remotion caches the auto-created bucket
 *      here on first render)
 *
 * Result is memoized — the lambda-state.json file is small but reading it
 * on every /uploads/* request is wasted syscalls. State changes require a
 * server restart (same as RENDER_MODE flips).
 */
let cachedUploadBucket: string | null = null;
export function getUploadBucket(): string {
  if (cachedUploadBucket) return cachedUploadBucket;
  const envName = process.env.AWS_S3_BUCKET ?? process.env.REMOTION_AWS_BUCKET;
  if (envName) {
    cachedUploadBucket = envName;
    return envName;
  }
  // Fall back to the bucket Remotion's lambda flow created/discovered.
  const stateFile = resolve(
    process.env.STORAGE_DIR ?? './storage',
    'lambda-state.json',
  );
  try {
    const raw = readFileSync(stateFile, 'utf8');
    const parsed = JSON.parse(raw) as { bucketName?: string };
    if (parsed.bucketName) {
      cachedUploadBucket = parsed.bucketName;
      return parsed.bucketName;
    }
  } catch {
    // Falls through to the friendly error below.
  }
  throw new Error(
    'S3 bucket not configured. Set AWS_S3_BUCKET (or REMOTION_AWS_BUCKET), ' +
      'or run a Lambda render first so Remotion auto-creates a bucket and writes ' +
      'storage/lambda-state.json.',
  );
}

/**
 * Browser-side PUTs to S3 are cross-origin from the web app's host. Without
 * a bucket-level CORS policy that allows PUT + the Content-Type header,
 * S3 rejects the preflight and the upload never starts. Idempotently
 * installs a permissive rule for our origins.
 *
 * `extraOrigins` lets the API pass in its production origin in addition
 * to the dev defaults. Failures are non-fatal (logged + continue) — the
 * upload feature will return a clear browser-side error if CORS is wrong,
 * which the operator can then fix manually.
 */
const UPLOAD_CORS_RULE_ID = 'wabisabi-user-uploads-cors';

export async function ensureUploadCors(
  bucketName: string,
  extraOrigins: string[] = [],
): Promise<void> {
  const client = getClient();
  // Origins the browser will use. Include the standard Vite dev port and
  // an http://localhost:3000 fallback (API self-host); operator passes in
  // production origin via extraOrigins.
  const allowedOrigins = Array.from(
    new Set([
      'http://localhost:5173',
      'http://localhost:3000',
      'http://127.0.0.1:5173',
      'http://127.0.0.1:3000',
      ...extraOrigins,
    ]),
  );
  const wantRule: CORSRule = {
    ID: UPLOAD_CORS_RULE_ID,
    AllowedMethods: ['PUT', 'GET', 'HEAD'],
    AllowedOrigins: allowedOrigins,
    AllowedHeaders: ['*'],
    ExposeHeaders: ['ETag'],
    MaxAgeSeconds: 3600,
  };

  try {
    const existing = await client
      .send(new GetBucketCorsCommand({ Bucket: bucketName }))
      .catch((err: Error & { name?: string }) => {
        if (err?.name === 'NoSuchCORSConfiguration') return { CORSRules: [] };
        throw err;
      });
    const rules = (existing?.CORSRules ?? []) as CORSRule[];

    // Idempotency check — bail if our rule already matches the desired set.
    const have = rules.find((r) => r.ID === UPLOAD_CORS_RULE_ID);
    const sameOrigins =
      have &&
      have.AllowedOrigins &&
      allowedOrigins.every((o) => have.AllowedOrigins!.includes(o)) &&
      have.AllowedOrigins.length === allowedOrigins.length;
    const sameMethods =
      have &&
      have.AllowedMethods &&
      ['PUT', 'GET', 'HEAD'].every((m) => have.AllowedMethods!.includes(m));
    if (have && sameOrigins && sameMethods) {
      console.log(`s3: cors already correct on ${bucketName}`);
      return;
    }

    const nextRules: CORSRule[] = [
      ...rules.filter((r) => r.ID !== UPLOAD_CORS_RULE_ID),
      wantRule,
    ];
    await client.send(
      new PutBucketCorsCommand({
        Bucket: bucketName,
        CORSConfiguration: { CORSRules: nextRules },
      }),
    );
    console.log(
      `s3: installed cors on ${bucketName} (PUT/GET/HEAD from ${allowedOrigins.length} origins)`,
    );
  } catch (err) {
    console.warn(
      `s3: could not configure cors on ${bucketName} (continuing):`,
      (err as Error).message,
    );
  }
}

/**
 * Install (or refresh) lifecycle rules covering all our managed prefixes.
 * Idempotent — safe to call every worker startup. We check the existing
 * configuration first so we don't spam AWS audit logs re-writing an
 * identical rule every boot.
 *
 * Any rules the operator (or Remotion) installed under non-owned IDs are
 * preserved as-is. Failures are non-fatal — a missing rule doesn't break
 * renders, it just means the bucket accumulates until we fix it.
 */
export async function ensureOutputLifecycle(bucketName: string): Promise<void> {
  const client = getClient();
  try {
    const existing = await client
      .send(new GetBucketLifecycleConfigurationCommand({ Bucket: bucketName }))
      .catch((err: Error & { name?: string }) => {
        // NoSuchLifecycleConfiguration = S3's "the bucket has no rules yet"
        // signal. Treat it like an empty config and fall through to put.
        if (err?.name === 'NoSuchLifecycleConfiguration') return { Rules: [] };
        throw err;
      });
    const rules = existing?.Rules ?? [];

    // Quick idempotency check: if every owned rule is already present and
    // correct, skip the Put entirely.
    const allMatch = OWNED_RULES.every((want) => {
      const have = rules.find((r) => r.ID === want.id);
      return (
        have &&
        have.Status === 'Enabled' &&
        have.Expiration?.Days === want.days &&
        have.Filter &&
        'Prefix' in have.Filter &&
        have.Filter.Prefix === want.prefix
      );
    });
    if (allMatch) {
      console.log(
        `s3: lifecycle already correct on ${bucketName} (${OWNED_RULES.length} owned rules)`,
      );
      return;
    }

    const nextRules: LifecycleRule[] = [
      // Preserve any rules installed under IDs we don't own.
      ...rules.filter((r) => !OWNED_RULE_IDS.has(r.ID ?? '')),
      ...OWNED_RULES.map((r) => ({
        ID: r.id,
        Status: 'Enabled' as const,
        Filter: { Prefix: r.prefix },
        Expiration: { Days: r.days },
      })),
    ];
    await client.send(
      new PutBucketLifecycleConfigurationCommand({
        Bucket: bucketName,
        LifecycleConfiguration: { Rules: nextRules },
      }),
    );
    console.log(
      `s3: installed ${OWNED_RULES.length} lifecycle rules on ${bucketName}: ` +
        OWNED_RULES.map((r) => `${r.prefix}(${r.days}d)`).join(', '),
    );
  } catch (err) {
    console.warn(
      `s3: could not configure lifecycle on ${bucketName} (continuing):`,
      (err as Error).message,
    );
  }
}
