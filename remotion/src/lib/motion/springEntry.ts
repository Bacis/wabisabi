import { spring } from 'remotion';

// Per-word entry spring + scale/opacity ramp. Wraps Remotion's `spring()`
// with the canonical scale formula `scaleFrom + progress * (1 - scaleFrom)`
// and the opacity ramp `min(1, scaleFrom < 1 ? progress * 1.5 : 1)`.
//
// Pure (modulo the call into Remotion's `spring`, which is itself pure).
// The renderer's per-word inline computation collapses into a single call.

export type SpringConfig = {
  damping: number;
  stiffness: number;
  mass: number;
};

export type EntrySpringInput = {
  frame: number;             // current frame
  entryFrame: number;        // first frame at which this word should reveal
  fps: number;
  animDurationMs: number;    // total entry duration
  scaleFrom: number;         // start scale (typically 0.6-0.7)
  spring: SpringConfig;
};

export type EntrySpringState = {
  progress: number;          // 0..1, eased by the spring
  scale: number;             // scaleFrom → 1
  opacity: number;           // 0 → 1, ramps faster than scale when scaleFrom < 1
};

export function computeEntrySpring(input: EntrySpringInput): EntrySpringState {
  const progress = spring({
    frame: Math.max(0, input.frame - input.entryFrame),
    fps: input.fps,
    durationInFrames: Math.max(1, Math.round((input.animDurationMs / 1000) * input.fps)),
    config: { damping: input.spring.damping, stiffness: input.spring.stiffness, mass: input.spring.mass },
  });
  const scale = input.scaleFrom + progress * (1 - input.scaleFrom);
  const opacity = Math.min(1, input.scaleFrom < 1 ? progress * 1.5 : 1);
  return { progress, scale, opacity };
}
