import { Easing, interpolate } from 'remotion';

// Caption entry animations are described by portable specs ported from the
// pixel-point `animate-text` catalog. Each spec declares a keyframe pair
// (from → to) over a duration with a cubic-bezier easing, optionally
// staggered across animated units (words or characters). The renderer
// (CaptionLayer / SingleWord / CaptionDesigner) calls `evalEnter` per unit
// at frame time and applies the returned RenderFrame to its span.

export type AnimPreset =
  | 'spring-scale-in'
  | 'soft-blur-in'
  | 'per-character-rise'
  | 'per-word-crossfade'
  | 'shimmer-sweep'
  | 'bottom-up-letters'
  | 'focus-blur-resolve';

export const ALL_PRESETS: readonly AnimPreset[] = [
  'spring-scale-in',
  'soft-blur-in',
  'per-character-rise',
  'per-word-crossfade',
  'shimmer-sweep',
  'bottom-up-letters',
  'focus-blur-resolve',
] as const;

export const DEFAULT_PRESET: AnimPreset = 'per-word-crossfade';

export type AnimTarget = 'whole' | 'per-word' | 'per-character' | 'per-line';

type Frame = Partial<{
  opacity: number;
  x_px: number;
  y_px: number;
  scale: number;
  blur_px: number;
  rotate_deg: number;
}>;

type Phase = {
  duration_ms: number;
  stagger_ms: number;
  easing: string;
  from: Frame;
  to: Frame;
};

export type AnimSpec = {
  id: AnimPreset;
  display_name: string;
  description: string;
  target: AnimTarget;
  signature_easing: string;
  enter: Phase;
  exit: Phase;
};

export const MODE_SPECS: Record<AnimPreset, AnimSpec> = {
  'spring-scale-in': {
    id: 'spring-scale-in',
    display_name: 'Spring Scale In',
    description: 'Words pop in with a soft overshoot scale, like an iOS icon settling.',
    target: 'per-word',
    signature_easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
    enter: {
      duration_ms: 360,
      stagger_ms: 95,
      easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
      from: { opacity: 0, scale: 0.7 },
      to: { opacity: 1, scale: 1 },
    },
    exit: {
      duration_ms: 200,
      stagger_ms: 80,
      easing: 'cubic-bezier(0.7, 0, 0.84, 0)',
      from: { opacity: 1, scale: 1 },
      to: { opacity: 0, scale: 0.8 },
    },
  },
  'soft-blur-in': {
    id: 'soft-blur-in',
    display_name: 'Soft Blur',
    description: "Per-character fade with gentle blur and upward motion. Apple's hero-title reveal.",
    target: 'per-character',
    signature_easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
    enter: {
      duration_ms: 900,
      stagger_ms: 25,
      easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
      from: { opacity: 0, y_px: 16, blur_px: 12 },
      to: { opacity: 1, y_px: 0, blur_px: 0 },
    },
    exit: {
      duration_ms: 600,
      stagger_ms: 15,
      easing: 'cubic-bezier(0.64, 0, 0.78, 0)',
      from: { opacity: 1, y_px: 0, blur_px: 0 },
      to: { opacity: 0, y_px: -16, blur_px: 12 },
    },
  },
  'per-character-rise': {
    id: 'per-character-rise',
    display_name: 'Per-Character Rise',
    description: 'Letters rise from below — crisp, deliberate, kinetic. tvOS-style reveal.',
    target: 'per-character',
    signature_easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
    enter: {
      duration_ms: 700,
      stagger_ms: 24,
      easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
      from: { opacity: 0, y_px: 32 },
      to: { opacity: 1, y_px: 0 },
    },
    exit: {
      duration_ms: 420,
      stagger_ms: 14,
      easing: 'cubic-bezier(0.7, 0, 0.84, 0)',
      from: { opacity: 1, y_px: 0 },
      to: { opacity: 0, y_px: -24 },
    },
  },
  'per-word-crossfade': {
    id: 'per-word-crossfade',
    display_name: 'Per-Word Crossfade',
    description: 'Words fade into place with a short vertical drift. Calm keynote rhythm.',
    target: 'per-word',
    signature_easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
    enter: {
      duration_ms: 700,
      stagger_ms: 70,
      easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
      from: { opacity: 0, y_px: 8 },
      to: { opacity: 1, y_px: 0 },
    },
    exit: {
      duration_ms: 500,
      stagger_ms: 40,
      easing: 'cubic-bezier(0.7, 0, 0.84, 0)',
      from: { opacity: 1, y_px: 0 },
      to: { opacity: 0, y_px: -6 },
    },
  },
  'shimmer-sweep': {
    id: 'shimmer-sweep',
    display_name: 'Shimmer Sweep',
    description: 'Whole headline glides in with a subtle sweep and blur fade.',
    target: 'whole',
    signature_easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
    enter: {
      duration_ms: 850,
      stagger_ms: 0,
      easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
      from: { opacity: 0, x_px: -22, blur_px: 8 },
      to: { opacity: 1, x_px: 0, blur_px: 0 },
    },
    exit: {
      duration_ms: 650,
      stagger_ms: 0,
      easing: 'cubic-bezier(0.7, 0, 0.84, 0)',
      from: { opacity: 1, x_px: 0, blur_px: 0 },
      to: { opacity: 0, x_px: 22, blur_px: 8 },
    },
  },
  'bottom-up-letters': {
    id: 'bottom-up-letters',
    display_name: 'Bottom-Up Letters',
    description: 'Letters rise from below in a pronounced staircase. Apple keynote typography.',
    target: 'per-character',
    signature_easing: 'cubic-bezier(0.18, 1, 0.32, 1)',
    enter: {
      duration_ms: 400,
      stagger_ms: 88,
      easing: 'cubic-bezier(0.18, 1, 0.32, 1)',
      from: { opacity: 0, y_px: 46 },
      to: { opacity: 1, y_px: 0 },
    },
    exit: {
      duration_ms: 280,
      stagger_ms: 28,
      easing: 'cubic-bezier(0.7, 0, 0.84, 0)',
      from: { opacity: 1, y_px: 0 },
      to: { opacity: 0, y_px: -14 },
    },
  },
  'focus-blur-resolve': {
    id: 'focus-blur-resolve',
    display_name: 'Focus Blur Resolve',
    description: 'Cinematic focus pull from heavy blur into crisp text.',
    target: 'whole',
    signature_easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
    enter: {
      duration_ms: 760,
      stagger_ms: 0,
      easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
      from: { opacity: 0, y_px: 14, blur_px: 14, scale: 1.01 },
      to: { opacity: 1, y_px: 0, blur_px: 0, scale: 1 },
    },
    exit: {
      duration_ms: 520,
      stagger_ms: 0,
      easing: 'cubic-bezier(0.64, 0, 0.78, 0)',
      from: { opacity: 1, y_px: 0, blur_px: 0, scale: 1 },
      to: { opacity: 0, y_px: -10, blur_px: 10, scale: 1 },
    },
  },
};

export type RenderFrame = {
  opacity: number;
  transform: string;
  filter: string | undefined;
};

export const IDENTITY_FRAME: RenderFrame = {
  opacity: 1,
  transform: 'none',
  filter: undefined,
};

const BEZIER_RE = /cubic-bezier\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/;

const easingCache = new Map<string, (n: number) => number>();

function parseBezier(s: string): ((n: number) => number) | undefined {
  const cached = easingCache.get(s);
  if (cached) return cached;
  const m = BEZIER_RE.exec(s);
  if (!m) return undefined;
  const fn = Easing.bezier(
    parseFloat(m[1]!),
    parseFloat(m[2]!),
    parseFloat(m[3]!),
    parseFloat(m[4]!),
  );
  easingCache.set(s, fn);
  return fn;
}

function buildTransform(x: number, y: number, scale: number, rotate: number): string {
  const parts: string[] = [];
  if (Math.abs(x) > 0.01 || Math.abs(y) > 0.01) {
    parts.push(`translate(${x.toFixed(3)}px, ${y.toFixed(3)}px)`);
  }
  if (Math.abs(scale - 1) > 0.001) {
    parts.push(`scale(${scale.toFixed(4)})`);
  }
  if (Math.abs(rotate) > 0.01) {
    parts.push(`rotate(${rotate.toFixed(3)}deg)`);
  }
  return parts.length === 0 ? 'none' : parts.join(' ');
}

// Evaluate the enter phase for a single unit at time `t` (seconds from
// composition start). `anchorSec` is when this unit's animation begins:
// for per-word, the word's `start`; for per-character within a word, the
// word's start plus `charIndex * stagger_ms`. Before the anchor the unit
// holds at `from`; after `anchor + duration` it holds at `to`.
export function evalEnter(
  spec: AnimSpec,
  t: number,
  anchorSec: number,
  maxDurationSec?: number,
): RenderFrame {
  // When `maxDurationSec` is provided the renderer is asking us to compress
  // the entry into a window shorter than the spec's nominal duration —
  // typically the chunk's on-screen time × a fraction (~0.35). Without this
  // clamp, a 700ms / 900ms preset on a fast-speech 500ms chunk visibly cuts
  // off mid-flight as the next chunk takes over. Clamp NEVER extends; only
  // shortens.
  const requested = spec.enter.duration_ms / 1000;
  const dur = Math.max(
    0.001,
    maxDurationSec !== undefined ? Math.min(requested, maxDurationSec) : requested,
  );
  const easing = parseBezier(spec.enter.easing);
  const range: [number, number] = [anchorSec, anchorSec + dur];
  const opts = {
    extrapolateLeft: 'clamp' as const,
    extrapolateRight: 'clamp' as const,
    ...(easing ? { easing } : {}),
  };

  const f = spec.enter.from;
  const to = spec.enter.to;
  const opacity = interpolate(t, range, [f.opacity ?? 1, to.opacity ?? 1], opts);
  const x = interpolate(t, range, [f.x_px ?? 0, to.x_px ?? 0], opts);
  const y = interpolate(t, range, [f.y_px ?? 0, to.y_px ?? 0], opts);
  const scale = interpolate(t, range, [f.scale ?? 1, to.scale ?? 1], opts);
  const rotate = interpolate(t, range, [f.rotate_deg ?? 0, to.rotate_deg ?? 0], opts);
  const blur = interpolate(t, range, [f.blur_px ?? 0, to.blur_px ?? 0], opts);

  return {
    opacity,
    transform: buildTransform(x, y, scale, rotate),
    filter: Math.abs(blur) > 0.01 ? `blur(${blur.toFixed(3)}px)` : undefined,
  };
}

// Peak scale this spec reaches at any point during enter — used by callers
// that need to reserve flex-layout space so overshoot doesn't bleed into
// neighbor words. Bezier curves with control-point y > 1 overshoot above
// the target value during interpolation; we approximate the peak by
// scaling the larger endpoint by 1.2 when the easing contains an
// overshoot indicator.
export function peakScale(spec: AnimSpec): number {
  const a = spec.enter.from.scale ?? 1;
  const b = spec.enter.to.scale ?? 1;
  const max = Math.max(a, b);
  const m = BEZIER_RE.exec(spec.enter.easing);
  if (!m) return max;
  const y1 = parseFloat(m[2]!);
  const y2 = parseFloat(m[4]!);
  const overshoots = y1 > 1 || y2 > 1;
  return overshoots ? max * 1.2 : max;
}

export function getSpec(preset: AnimPreset | undefined): AnimSpec {
  if (!preset) return MODE_SPECS[DEFAULT_PRESET];
  return MODE_SPECS[preset] ?? MODE_SPECS[DEFAULT_PRESET];
}
