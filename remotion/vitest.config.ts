import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts', 'src/**/*.spec.tsx'],
    environment: 'node',
    // Phase 0 ships the framework before any spec files exist. The first
    // real spec lands in Phase 1 (linguistics). Until then, a green run is
    // a true success signal.
    passWithNoTests: true,
  },
});
