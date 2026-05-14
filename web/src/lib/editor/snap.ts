// Frame-aligned time snapping. All timeline edits round to 1/30s so they
// round-trip cleanly with Remotion frames.
export const FPS = 30;

export function snapFrame(seconds: number, fps = FPS): number {
  return Math.round(seconds * fps) / fps;
}

export function clampNonNegative(seconds: number): number {
  return Math.max(0, seconds);
}
