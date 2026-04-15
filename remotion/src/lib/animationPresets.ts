import { interpolate, spring } from 'remotion';

// Shared animation-preset logic for word rendering. Both PopWords and
// SingleWord call `animateWord` for every rendered word. The preset name
// picks a mapping from "where are we in time" to { color, opacity,
// transform } — the caller applies those to its span. All font styling
// (family, weight, size, stroke) stays outside this helper since it's
// preset-independent.

export type WordCtx = {
  t: number;
  frame: number;
  fps: number;
  word: { start: number; end: number };
  isEmphasis: boolean;
  // Used by the `fade` preset which animates whole chunks together.
  chunkStart: number;
  fillColor: string;
  emphasisColor: string;
  // Animation params resolved from styleSpec.animation.
  scaleFrom: number;
  emphasisScale: number;
  activeBoost: number;
  durationMs: number;
  spring: { damping: number; stiffness: number; mass: number };
};

export type WordStyle = {
  color: string;
  opacity: number;
  transform: string;
};

// Spring progress keyed off an absolute time (in seconds) from the start
// of the composition. Returns 0 when frame < origin, ramps up through
// `durationInFrames`.
function springFrom(sec: number, ctx: WordCtx): number {
  const durFrames = Math.max(1, Math.round((ctx.durationMs / 1000) * ctx.fps));
  return spring({
    frame: ctx.frame - Math.round(sec * ctx.fps),
    fps: ctx.fps,
    config: ctx.spring,
    durationInFrames: durFrames,
  });
}

export function animateWord(
  preset: 'pop' | 'fade' | 'karaoke' | 'typewriter' | 'slide',
  ctx: WordCtx,
): WordStyle {
  const isActive = ctx.t >= ctx.word.start && ctx.t <= ctx.word.end;

  switch (preset) {
    case 'fade': {
      // Whole-chunk cross-fade. Every word in the chunk animates together
      // off the chunk start, not its own word.start. No scaling.
      const p = springFrom(ctx.chunkStart, ctx);
      return {
        color: ctx.isEmphasis ? ctx.emphasisColor : ctx.fillColor,
        opacity: interpolate(p, [0, 1], [0, 1]),
        transform: 'none',
      };
    }

    case 'karaoke': {
      // All words in the chunk are visible from its start. Each word
      // transitions from fill to emphasis color as its own timestamp is
      // reached — the classic karaoke sweep. The LLM isEmphasis flag is
      // intentionally ignored in this mode: the "which word is highlighted"
      // signal comes entirely from the time cursor. Use a short ramp (not
      // hard cut) so the color change is less jarring.
      const ramp = Math.min(
        1,
        Math.max(0, (ctx.t - ctx.word.start) / Math.max(0.04, ctx.word.end - ctx.word.start)),
      );
      return {
        color: ramp > 0 ? ctx.emphasisColor : ctx.fillColor,
        opacity: 1,
        transform: 'none',
      };
    }

    case 'typewriter': {
      // Words appear one at a time at their own start timestamp with a
      // quick fade. No scaling, no backward animation on previous words.
      const p = springFrom(ctx.word.start, ctx);
      return {
        color: ctx.isEmphasis ? ctx.emphasisColor : ctx.fillColor,
        opacity: interpolate(p, [0, 1], [0, 1]),
        transform: 'none',
      };
    }

    case 'slide': {
      // Each word slides up 20px with a fade. Uses the same spring as pop
      // so the feel is consistent, but swaps scale for translateY.
      const p = springFrom(ctx.word.start, ctx);
      const ty = interpolate(p, [0, 1], [20, 0]);
      return {
        color: ctx.isEmphasis ? ctx.emphasisColor : ctx.fillColor,
        opacity: interpolate(p, [0, 1], [0, 1]),
        transform: `translateY(${ty}px)`,
      };
    }

    case 'pop':
    default: {
      // Default: spring scale from scaleFrom up to emphasis-adjusted target,
      // with a small extra active-word boost. LLM-emphasis words are
      // persistently colored and pre-scaled.
      const p = springFrom(ctx.word.start, ctx);
      const baseScale = ctx.isEmphasis ? ctx.emphasisScale : 1;
      const target = baseScale * (isActive ? ctx.activeBoost : 1);
      const scale = interpolate(p, [0, 1], [ctx.scaleFrom, target]);
      return {
        color: ctx.isEmphasis ? ctx.emphasisColor : ctx.fillColor,
        opacity: interpolate(p, [0, 1], [0, 1]),
        transform: `scale(${scale})`,
      };
    }
  }
}
