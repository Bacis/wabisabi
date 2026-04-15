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

import {
  S3Client,
  GetObjectCommand,
  PutBucketLifecycleConfigurationCommand,
  GetBucketLifecycleConfigurationCommand,
  type LifecycleRule,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

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
 * Sign a time-limited GET URL for a rendered output. One hour is plenty —
 * the API hands this URL to a browser redirect or the Telegram bot which
 * fetches it immediately.
 */
export async function presignOutputUrl(uri: string, expiresInSec = 3600): Promise<string> {
  const parsed = parseS3Uri(uri);
  if (!parsed) throw new Error(`presignOutputUrl: not an s3:// uri: ${uri}`);
  return getSignedUrl(
    getClient(),
    new GetObjectCommand({ Bucket: parsed.bucket, Key: parsed.key }),
    { expiresIn: expiresInSec },
  );
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
