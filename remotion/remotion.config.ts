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
