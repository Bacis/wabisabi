import { Config } from '@remotion/cli/config';

Config.setVideoImageFormat('jpeg');
Config.setOverwriteOutput(true);
Config.setConcurrency(null); // use all cores
// Required by the three-effects composition (react-three-fiber).
// SwiftShader (the default) cannot create a WebGL context in headless
// Chromium during CLI renders. ANGLE gives us hardware-accelerated WebGL.
// Studio preview in a real browser is unaffected. See:
// https://www.remotion.dev/docs/three
Config.setChromiumOpenGlRenderer('angle');

// Cross-project imports from `../../../src/shared/director/*` use NodeNext
// `.js` extensions on their internal imports (TypeScript ESM convention).
// The Remotion bundler is webpack-based and won't resolve `.js → .ts`
// without explicit extensionAlias. Adding it lets us share the Director
// schema + lookups between Node code and the Remotion composition without
// dual-publishing files. Mirrors what node's `--experimental-specifier-resolution`
// would do.
Config.overrideWebpackConfig((current) => ({
  ...current,
  resolve: {
    ...current.resolve,
    extensionAlias: {
      ...(current.resolve?.extensionAlias ?? {}),
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
    },
  },
}));
