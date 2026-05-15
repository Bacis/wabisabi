import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// API server runs on localhost:3000 by default. In dev, proxy unmatched routes
// to it so the editor can hit /jobs, /presets, /style/generate, etc. without
// CORS or origin gymnastics.
const API_TARGET = process.env.API_URL ?? 'http://localhost:3000';

// Two flavors of proxied path:
//
//  * API_ONLY_PATHS — the prefix is exclusively an HTTP endpoint. Browser
//    navigations (e.g. clicking the Download button's anchor to
//    /jobs/:id/output?download=...) must reach the API; the SPA does not
//    own these URLs. No bypass.
//
//  * SHARED_PATHS — the prefix is BOTH an API endpoint and a SPA route
//    (e.g. /designer/:id is a React page AND /designer/sessions/:id is a
//    JSON endpoint). XHR/fetch from app code wants the API; a browser
//    navigation wants the SPA. We bypass to /index.html when the request
//    is an HTML navigation (Accept: text/html).
const API_ONLY_PATHS = [
  // /jobs/:id/output, /jobs/:id/input, /jobs (list), POST /jobs (upload)
  // — the SPA's /jobs route was retired when JobsPage was replaced by the
  // curated /library page, so these are API-only now.
  '/jobs',
  '/presets',
  '/productions',
  '/style',
  '/health',
  '/auth',
  '/designs',
  '/clips',
  '/stock',
  // Director audio cue samples (remotion/public/audio/<gesture>/NN.mp3).
  // Served by fastify-static on the API; vite proxies the URL through
  // so the live Player's <Audio> elements can fetch them at the same
  // path Remotion's render-time staticFile() resolves to.
  '/audio',
];
const SHARED_PATHS = [
  // /themes (SPA gallery page) + GET/POST /themes (REST). Browser nav lands
  // on the React page; XHR hits the API.
  '/themes',
  // POST /agent/chat — the agentic editor experiment.
  '/agent',
  // /designer/sessions* — REST for saved agent conversations. Shares prefix
  // with the SPA's /designer/:id and /designer/history routes.
  '/designer',
];

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // shadcn/ui CLI assumes `@/*` resolves to the web src tree. Used by
      // every generated component in src/components/ui/* and by our app
      // code that imports @/lib/utils, @/components/ui/button, etc.
      '@': resolve(__dirname, 'src'),
      // Vendor-style import to the canonical Zod schema. The TS file works
      // unchanged in the browser since it's just zod + types.
      '@shared/styleSpec': resolve(__dirname, '../src/shared/styleSpec.ts'),
      // Sibling alias for mergeStyleSpec (used by the Theme picker for
      // deep-merging theme patches into the live styleSpec).
      '@shared/presets': resolve(__dirname, '../src/shared/presets.ts'),
      // Spread plain text into a uniformly-timed Transcript — used by the
      // editor's transcript-override input on stock clips with no audio.
      '@shared/buildTranscript': resolve(__dirname, '../src/shared/buildTranscript.ts'),
      // The Player runs the same React compositions the headless renderer
      // bundles for Lambda. Pull them in directly from remotion/src so we
      // never drift between server-render and live-preview behaviour.
      '@remotion-templates': resolve(__dirname, '../remotion/src/templates'),
      '@remotion-lib': resolve(__dirname, '../remotion/src/lib'),
    },
    // CRITICAL: dedupe react and remotion. The repo has the legacy /remotion
    // workspace with its own node_modules; without this, Vite resolves the
    // template's `import {...} from 'remotion'` to a different copy than the
    // Player uses, so React contexts don't match and useCurrentFrame() throws
    // "can only be called inside a component that was passed to <Player>".
    dedupe: ['react', 'react-dom', 'remotion'],
  },
  optimizeDeps: {
    include: ['remotion', '@remotion/player', '@remotion/google-fonts'],
  },
  server: {
    port: 5173,
    proxy: {
      // API-only prefixes: always proxy, no SPA bypass.
      ...Object.fromEntries(
        API_ONLY_PATHS.map((p) => [
          p,
          { target: API_TARGET, changeOrigin: true },
        ]),
      ),
      // Shared prefixes: proxy XHR, but on browser navigations
      // (Accept: text/html) bypass to /index.html so reloads/deep-links
      // land on the SPA route.
      ...Object.fromEntries(
        SHARED_PATHS.map((p) => [
          p,
          {
            target: API_TARGET,
            changeOrigin: true,
            bypass: (req: { method?: string; headers: { accept?: string } }) => {
              if (
                req.method === 'GET' &&
                req.headers.accept?.includes('text/html')
              ) {
                return '/index.html';
              }
            },
          },
        ]),
      ),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },
});
