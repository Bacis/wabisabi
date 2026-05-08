import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// API server runs on localhost:3000 by default. In dev, proxy unmatched routes
// to it so the editor can hit /jobs, /presets, /style/generate, etc. without
// CORS or origin gymnastics.
const API_TARGET = process.env.API_URL ?? 'http://localhost:3000';
const API_PATHS = ['/jobs', '/presets', '/productions', '/style', '/health'];

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Vendor-style import to the canonical Zod schema. The TS file works
      // unchanged in the browser since it's just zod + types.
      '@shared/styleSpec': resolve(__dirname, '../src/shared/styleSpec.ts'),
      // Sibling alias for mergeStyleSpec (used by the Theme picker for
      // deep-merging theme patches into the live styleSpec).
      '@shared/presets': resolve(__dirname, '../src/shared/presets.ts'),
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
      API_PATHS.map((p) => [p, { target: API_TARGET, changeOrigin: true }]),
    ),
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },
});
