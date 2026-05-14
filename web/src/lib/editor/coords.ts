// Coordinate conversion between screen pixels (DOM events, react-moveable
// callbacks) and canvas pixels (Transform.x/y/w/h stored at 1080×1920
// baseline).
//
// CANVAS_W / CANVAS_H must match the Remotion composition. Don't change them
// here — change the composition first.

import type { Transform } from '@/lib/api';

export const CANVAS_W = 1080;
export const CANVAS_H = 1920;

export type StageRect = {
  width: number;
  height: number;
  top: number;
  left: number;
};

export function scaleFromRect(rect: StageRect): { sx: number; sy: number } {
  return { sx: rect.width / CANVAS_W, sy: rect.height / CANVAS_H };
}

// Screen delta → canvas delta. Use for react-moveable beforeTranslate,
// resize deltas, etc.
export function screenDeltaToCanvas(rect: StageRect, dx: number, dy: number) {
  const { sx, sy } = scaleFromRect(rect);
  return { dx: dx / sx, dy: dy / sy };
}

// Canvas Transform → screen-space rect for the invisible proxy div that
// react-moveable targets. left/top are absolute relative to the stage
// container (which is `position: relative`).
export function canvasToScreenRect(rect: StageRect, t: Transform) {
  const { sx, sy } = scaleFromRect(rect);
  return {
    left: t.x * sx,
    top: t.y * sy,
    width: t.w * sx,
    height: t.h * sy,
    rotate: t.rot,
  };
}
