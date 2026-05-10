import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// API server runs on localhost:3000 by default. In dev, proxy unmatched routes
// to it so the editor can hit /jobs, /presets, /style/generate, etc. without
// CORS or origin gymnastics.
const API_TARGET = process.env.API_URL ?? 'http://localhost:3000';
const API_PATHS = [
  '/jobs',
  '/presets',
  '/productions',
  '/style',
  '/health',
  '/auth',
  '/themes',
  '/clips',
  '/stock',
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
    proxy: Object.fromEntries(
      API_PATHS.map((p) => [
        p,
        {
          target: API_TARGET,
          changeOrigin: true,
          // The SPA shares URL space with the API (e.g. /jobs/:id is both a
          // React route and a JSON endpoint). Browser navigations send
          // `Accept: text/html`; XHR/fetch from app code does not. Bypass to
          // index.html on HTML requests so reloads/deep-links land on the SPA.
          bypass: (req) => {
            if (req.method === 'GET' && req.headers.accept?.includes('text/html')) {
              return '/index.html';
            }
          },
        },
      ]),
    ),
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },
});
