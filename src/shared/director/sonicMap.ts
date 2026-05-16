// Sonic gesture → motion params. Day 6 of the Director feature.
//
// Each sonic gesture (a felt-impact descriptor like "thud" or "shimmer")
// maps to a concrete motion configuration the renderer can apply. The
// planner reaches for the gesture vocabulary because it's physical-intuitive;
// the renderer reads the motion params because those are what springs and
// effects accept. This table is the bridge.
//
// Audio sample resolution is a separate lookup (`SAMPLE_LIBRARY` once Week 4
// audio FX work lands). Audio + motion both keyed off the same gesture id.

import type { SonicGesture } from './vocabularies.js';
import { SONIC_GESTURES } from './vocabularies.js';

export type MotionParams = {
  effect: string;          // mirrors EFFECT_IDS; broad-typed here to avoid coupling
  intensity: number;       // 0..1
  spring: {
    damping: number;
    stiffness: number;
    mass: number;
  };
};

export const SONIC_MOTION_MAP = {
  thud:    { effect: 'shockwave', intensity: 0.85, spring: { damping: 8,  stiffness: 320, mass: 0.7 } },
  slam:    { effect: 'shockwave', intensity: 1.00, spring: { damping: 6,  stiffness: 360, mass: 0.8 } },
  pop:     { effect: 'none',      intensity: 0.0,  spring: { damping: 14, stiffness: 280, mass: 0.4 } },
  click:   { effect: 'none',      intensity: 0.0,  spring: { damping: 20, stiffness: 320, mass: 0.3 } },
  whoosh:  { effect: 'breathe',   intensity: 0.6,  spring: { damping: 12, stiffness: 200, mass: 0.5 } },
  swipe:   { effect: 'none',      intensity: 0.0,  spring: { damping: 14, stiffness: 220, mass: 0.5 } },
  rise:    { effect: 'inflation', intensity: 0.7,  spring: { damping: 10, stiffness: 180, mass: 0.6 } },
  drop:    { effect: 'shockwave', intensity: 0.6,  spring: { damping: 9,  stiffness: 260, mass: 0.7 } },
  shimmer: { effect: 'flare',     intensity: 0.75, spring: { damping: 16, stiffness: 240, mass: 0.4 } },
  rumble:  { effect: 'resonance', intensity: 0.5,  spring: { damping: 8,  stiffness: 200, mass: 0.8 } },
  sizzle:  { effect: 'flare',     intensity: 0.7,  spring: { damping: 14, stiffness: 240, mass: 0.5 } },
  flutter: { effect: 'samba',     intensity: 0.4,  spring: { damping: 18, stiffness: 220, mass: 0.4 } },
  snap:    { effect: 'magnetic',  intensity: 0.8,  spring: { damping: 6,  stiffness: 380, mass: 0.3 } },
  sigh:    { effect: 'breathe',   intensity: 0.4,  spring: { damping: 18, stiffness: 160, mass: 0.6 } },
  whisper: { effect: 'breathe',   intensity: 0.25, spring: { damping: 20, stiffness: 180, mass: 0.5 } },
  tick:    { effect: 'none',      intensity: 0.0,  spring: { damping: 22, stiffness: 340, mass: 0.3 } },
} as const satisfies Record<SonicGesture, MotionParams>;

// Runtime sanity (mirror of roleDefaults.ts).
for (const gesture of SONIC_GESTURES) {
  if (!(gesture in SONIC_MOTION_MAP)) {
    throw new Error(`SONIC_MOTION_MAP missing entry for gesture "${gesture}"`);
  }
}
