import { bundle } from '@remotion/bundler';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const REMOTION_ROOT = resolve(process.env.REMOTION_PROJECT ?? './remotion');
const ENTRY = join(REMOTION_ROOT, 'src/index.ts');

export type RemotionBundle = {
  /** Serve URL or path passed to selectComposition / renderMedia. */
  serveUrl: string;
  /** Filesystem path of the bundle's `public/` dir. Files written here
   *  are served by the render's static handler — used for staging input
   *  videos. */
  publicDir: string;
};

// Bundle the Remotion site once and reuse the resulting serve URL across
// every render. The webpack bundle step is the slow part of a render — about
// 20 seconds — and it produces the same output as long as the composition
// code is unchanged. Caching it at the worker level turns "20s/job" into
// "20s once at startup, then nothing".
let cached: Promise<RemotionBundle> | null = null;

export function getRemotionBundle(): Promise<RemotionBundle> {
  if (!cached) {
    const start = Date.now();
    console.log(`bundling remotion project: ${ENTRY}`);
    cached = bundle({ entryPoint: ENTRY })
      .then(async (serveUrl) => {
        // bundle() returns a filesystem path to a webpack output dir. The
        // bundled site exposes a `public/` subdir from which the render
        // static handler serves assets.
        const publicDir = join(serveUrl, 'public');
        await mkdir(publicDir, { recursive: true });
        console.log(`bundle ready in ${((Date.now() - start) / 1000).toFixed(1)}s`);
        return { serveUrl, publicDir };
      })
      .catch((err) => {
        // Reset on failure so the next render retries instead of returning
        // a forever-failing cached promise.
        cached = null;
        throw err;
      });
  }
  return cached;
}
