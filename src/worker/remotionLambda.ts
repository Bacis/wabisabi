import {
  deployFunction,
  deploySite,
  getFunctions,
  getOrCreateBucket,
} from '@remotion/lambda';
import type { AwsRegion } from '@remotion/lambda/client';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

// @remotion/lambda wants its narrow AwsRegion union. Casting at the module
// boundary matches the pattern used in renderProductionLambda.ts — any
// garbage in AWS_REGION will be caught by the SDK at request time.
const REGION = (process.env.AWS_REGION ?? 'us-east-1') as AwsRegion;
const REMOTION_PROJECT = resolve(process.env.REMOTION_PROJECT ?? './remotion');
const COMPOSITION_ROOT = join(REMOTION_PROJECT, 'src');
const STATE_DIR = resolve(process.env.STORAGE_DIR ?? './storage');
const STATE_FILE = join(STATE_DIR, 'lambda-state.json');
const SITE_NAME = 'captions-site';

export type LambdaState = {
  region: string;
  functionName: string;
  serveUrl: string;
  bucketName: string;
  // Hash of the bundled composition source tree at the time of last
  // deploy. Used to detect template edits and trigger an automatic
  // site re-deploy.
  compositionHash: string;
};

// Walk the Remotion src/ tree and produce a stable sha256 over the (relative
// path, file content) pairs of every source file that ends up in the bundle.
// We hit .ts/.tsx/.css/.json — anything that could change rendering output.
async function hashCompositionTree(root: string): Promise<string> {
  const files: string[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (/\.(tsx?|jsx?|css|json)$/.test(entry.name)) {
        files.push(full);
      }
    }
  }

  await walk(root);
  files.sort(); // deterministic order

  const hash = createHash('sha256');
  for (const file of files) {
    const rel = file.slice(root.length);
    const content = await readFile(file);
    hash.update(rel);
    hash.update('\0');
    hash.update(content);
    hash.update('\0');
  }
  return hash.digest('hex').slice(0, 16);
}

// Singleton: deploy (or reuse) the Remotion Lambda function, the bundled
// site on S3, and the bucket. Cached in memory keyed on the composition
// hash — if the user edits a template between renders, the next call
// re-hashes, sees the mismatch, and redeploys the site (function and
// bucket are unchanged).
//
// Persistent state lives in `storage/lambda-state.json`. Worker restarts
// re-load it instead of re-deploying.
let cached: { state: LambdaState; hash: string } | null = null;
let inflight: Promise<LambdaState> | null = null;

export async function getLambdaState(): Promise<LambdaState> {
  const currentHash = await hashCompositionTree(COMPOSITION_ROOT);

  if (cached && cached.hash === currentHash) {
    return cached.state;
  }

  if (inflight) {
    // A redeploy is already in progress — wait for it.
    return inflight;
  }

  inflight = (async () => {
    try {
      const state = await ensureState(currentHash);
      cached = { state, hash: currentHash };
      return state;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

async function ensureState(currentHash: string): Promise<LambdaState> {
  // Try the on-disk cached state first.
  let prior: LambdaState | null = null;
  try {
    const raw = await readFile(STATE_FILE, 'utf8');
    prior = JSON.parse(raw) as LambdaState;
    if (prior.compositionHash === currentHash) {
      console.log(`lambda: state cache hit (hash ${currentHash})`);
      console.log(`  region:   ${prior.region}`);
      console.log(`  function: ${prior.functionName}`);
      console.log(`  bucket:   ${prior.bucketName}`);
      return prior;
    }
    console.log(
      `lambda: composition changed (was ${prior.compositionHash}, now ${currentHash}) — redeploying site`,
    );
  } catch {
    console.log('lambda: no cached state — bootstrapping (~60-90s on first run)');
  }

  // Function: reuse if we have one cached and it still exists, otherwise
  // discover an existing compatible function, otherwise deploy fresh.
  let functionName: string;
  if (prior?.functionName) {
    functionName = prior.functionName;
  } else {
    console.log(`lambda: ensuring function in ${REGION}...`);
    const existing = await getFunctions({ region: REGION, compatibleOnly: true });
    if (existing.length > 0) {
      functionName = existing[0]!.functionName;
      console.log(`lambda: reusing function ${functionName}`);
    } else {
      console.log('lambda: deploying function...');
      const result = await deployFunction({
        region: REGION,
        timeoutInSeconds: 240,
        memorySizeInMb: 2048,
        diskSizeInMb: 2048,
        createCloudWatchLogGroup: true,
      });
      functionName = result.functionName;
      console.log(`lambda: deployed function ${functionName}`);
    }
  }

  // Bucket: same idea — reuse the cached name, otherwise discover/create.
  let bucketName: string;
  if (prior?.bucketName) {
    bucketName = prior.bucketName;
  } else {
    console.log('lambda: ensuring bucket...');
    const result = await getOrCreateBucket({ region: REGION });
    bucketName = result.bucketName;
    console.log(`lambda: bucket ${bucketName}`);
  }

  // Site: always (re)deploy if we got here. Either it's the first deploy
  // or the composition hash changed. Site name stays constant so the
  // serveUrl is stable across deploys.
  console.log('lambda: deploying site (bundles + uploads remotion/)...');
  const site = await deploySite({
    entryPoint: join(REMOTION_PROJECT, 'src/index.ts'),
    bucketName,
    siteName: SITE_NAME,
    region: REGION,
  });
  console.log(`lambda: site ${site.serveUrl}`);

  const state: LambdaState = {
    region: REGION,
    functionName,
    serveUrl: site.serveUrl,
    bucketName,
    compositionHash: currentHash,
  };

  await mkdir(dirname(STATE_FILE), { recursive: true });
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2));
  console.log(`lambda: wrote state to ${STATE_FILE}`);
  return state;
}
