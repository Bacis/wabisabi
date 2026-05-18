// Coordinate conversion between screen pixels (DOM events, react-moveable
// callbacks) and canvas pixels (Transform.x/y/w/h).
//
// CANVAS_W / CANVAS_H are the DEFAULT (legacy vertical 9:16) baseline. The
// active canvas dimensions are stored in the editor zustand and may differ
// for horizontal sources (e.g. 1920×1080). Components that need the live
// values should call `useCanvasDims()`; the constants below remain for
// modules that need a static reference (default group transforms,
// fallbacks for legacy callsites).

import { useEditor } from './store';
import type { Transform } from '@/lib/api';

export const CANVAS_W = 1080;
export const CANVAS_H = 1920;

/**
 * Active canvas dimensions for the current source. Components rendering
 * the live preview / coord overlays MUST read from this rather than the
 * default CANVAS_W/H constants so horizontal sources render at the right
 * aspect.
 *
 * IMPORTANT: subscribe to the two primitives separately. Returning a new
 * `{ canvasW, canvasH }` object from a single selector would fail
 * Zustand's referential equality check and trigger an infinite re-render
 * loop (`getSnapshot should be cached` warning → maximum update depth).
 * Two primitive subscriptions are stable.
 */
export function useCanvasDims(): { canvasW: number; canvasH: number } {
  const canvasW = useEditor((s) => s.canvasWidth);
  const canvasH = useEditor((s) => s.canvasHeight);
  return { canvasW, canvasH };
}

export type StageRect = {
  width: number;
  height: number;
  top: number;
  left: number;
};

// Per-source canvas dimensions optionally override the legacy 1080×1920
// baseline. Callers that have access to the editor store should pass the
// active canvasW/H so horizontal sources resolve to the correct scale.
// When omitted (legacy callers, tests), falls back to the constants.
export function scaleFromRect(
  rect: StageRect,
  canvasW: number = CANVAS_W,
  canvasH: number = CANVAS_H,
): { sx: number; sy: number } {
  return { sx: rect.width / canvasW, sy: rect.height / canvasH };
}

// Screen delta → canvas delta. Use for react-moveable beforeTranslate,
// resize deltas, etc.
export function screenDeltaToCanvas(
  rect: StageRect,
  dx: number,
  dy: number,
  canvasW: number = CANVAS_W,
  canvasH: number = CANVAS_H,
) {
  const { sx, sy } = scaleFromRect(rect, canvasW, canvasH);
  return { dx: dx / sx, dy: dy / sy };
}

// Canvas Transform → screen-space rect for the invisible proxy div that
// react-moveable targets. left/top are absolute relative to the stage
// container (which is `position: relative`).
export function canvasToScreenRect(
  rect: StageRect,
  t: Transform,
  canvasW: number = CANVAS_W,
  canvasH: number = CANVAS_H,
) {
  const { sx, sy } = scaleFromRect(rect, canvasW, canvasH);
  return {
    left: t.x * sx,
    top: t.y * sy,
    width: t.w * sx,
    height: t.h * sy,
    rotate: t.rot,
  };
}
