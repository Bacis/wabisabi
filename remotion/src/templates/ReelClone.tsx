import React from 'react';
import { AbsoluteFill, OffthreadVideo, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { loadFont } from '@remotion/google-fonts/Inter';
import type { FaceData } from '../lib/positioning';
import type {
  CaptionPlan,
  Transcript,
  Word,
  CaptionChunk,
} from '../lib/CaptionLayer';

// Fully StyleSpec-driven caption template. Every visual behavior is
// controlled via styleSpec fields — no hardcoded multipliers, transforms,
// or layout decisions. This allows the automated refinement loop to tune
// all parameters without needing template code changes.
//
// Extended StyleSpec fields read by this template (beyond the standard ones):
//   styleSpec.reel.emphasisStyle           — 'inline-color' | 'block' | 'combined' (default 'combined')
//                                              inline-color: emphasisFill color, no case/size change, stays inline
//                                              block: large uppercase on own line at fillColor (no color change)
//                                              combined: red + uppercase + larger + own line (legacy behavior)
//   styleSpec.reel.emphasisFillRatio       — when set, emphasis word size auto-fits to this fraction
//                                              of the usable line width (overrides emphasisSizeMultiplier)
//   styleSpec.reel.emphasisMaxHeightRatio  — caps emphasis font-size to this fraction of canvas height
//                                              (default 0.20). Prevents huge words from clipping the
//                                              caption stack when the chunk has multiple lines.
//   styleSpec.reel.cascadeTopRatio         — top-line size as fraction of bottom (default 1.0 = no cascade)
//   styleSpec.reel.cascadeBottomRatio      — bottom-line (anchor) size factor (default 1.0)
//                                              When cascadeTopRatio < cascadeBottomRatio, lines progressively
//                                              grow from top to bottom, mimicking the reference reel's stack.
//   styleSpec.reel.multiColorEmphasis      — when true, cycle through emphasisFill palette per emphasis word
//                                              within a chunk (default false: one color per chunk).
//   styleSpec.reel.italicVocabulary        — array of lowercase tokens that should render in italic
//                                              when they appear in a chunk (default []). Used to mimic
//                                              the rare italic-script accent words in some reels
//                                              (e.g. "reasonable").
//   styleSpec.reel.emphasisSizeMultiplier  — fixed size ratio for emphasis words (default 1.0)
//   styleSpec.reel.fillerSizeMultiplier    — size ratio for filler words (default 1.0)
//   styleSpec.reel.emphasisTextTransform   — 'uppercase' | 'lowercase' | 'none' (default 'none')
//   styleSpec.reel.fillerTextTransform     — 'uppercase' | 'lowercase' | 'none' (default 'none')
//   styleSpec.reel.mediumTextTransform     — 'uppercase' | 'lowercase' | 'none' (default 'none')
//   styleSpec.reel.emphasisLineBreak       — whether emphasis words force their own line (default false)
//   styleSpec.reel.emphasisWeight          — font weight for emphasis words (default: same as font.weight)
//   styleSpec.reel.wordReveal              — 'all' | 'progressive' (default 'all')
//   styleSpec.reel.inferEmphasis           — auto-infer emphasis if plan has none (default true; opt out with `false`)
//   styleSpec.reel.columnGapRatio          — gap between words as ratio of baseSize (default 0.2)
//   styleSpec.reel.rowGapRatio             — gap between lines as ratio of baseSize (default 0.05)
//   styleSpec.reel.maxWidthPercent         — max width of text container (default 90)
//   styleSpec.reel.paddingPercent          — horizontal padding (default 6)

loadFont('normal', {
  weights: ['400', '700', '800', '900'],
  subsets: ['latin'],
});
loadFont('italic', {
  weights: ['400', '700', '900'],
  subsets: ['latin'],
});

const FILLER_WORDS = new Set([
  'a', 'an', 'the', 'of', 'to', 'in', 'on', 'at', 'by', 'for', 'with', 'as',
  'is', 'are', 'was', 'were', 'be', 'been', 'am',
  'i', 'me', 'my', 'we', 'us', 'our', 'you', 'your', 'he', 'him', 'his',
  'she', 'her', 'it', 'its', 'they', 'them', 'their',
  'and', 'or', 'but', 'so', 'if', 'then', 'than',
  "it's", "i'm", "we're", "you're", "they're", "that's", "what's",
  'um', 'uh', 'er', 'oh',
]);

// Value-words carry inline-color emphasis (red), never block treatment.
// References render these as colored words at base size, not as huge anchor
// blocks — the color does the visual work, not size dramatics.
const VALUE_WORDS = new Set([
  'never', 'always', 'no', 'not', 'only', 'every', 'all', 'none',
  'best', 'worst', 'better', 'worse',
  'most', 'more', 'less', 'least',
  'big', 'huge', 'tiny', 'small',
  'first', 'last', 'one',
  'really', 'very', 'truly',
  'so',
]);

function normalize(word: string): string {
  return word.toLowerCase().replace(/[.,!?;:"'()—-]/g, '');
}

function isFiller(word: string): boolean {
  return FILLER_WORDS.has(normalize(word));
}

function inferEmphasis(words: Word[]): boolean[] {
  const out = words.map(() => false);
  if (words.length === 0) return out;
  const candidates: { idx: number; length: number }[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    if (isFiller(w.word)) continue;
    const alphaLen = w.word.replace(/[^A-Za-z]/g, '').length;
    if (alphaLen >= 3) candidates.push({ idx: i, length: alphaLen });
  }
  if (candidates.length === 0) {
    let best = 0;
    for (let i = 1; i < words.length; i++) {
      if (words[i]!.word.length > words[best]!.word.length) best = i;
    }
    out[best] = true;
    return out;
  }
  candidates.sort((a, b) => b.length - a.length || a.idx - b.idx);
  const picks = words.length <= 3 ? 1 : 2;
  for (let i = 0; i < Math.min(picks, candidates.length); i++) {
    out[candidates[i]!.idx] = true;
  }
  return out;
}

function fallbackChunks(words: Word[], maxPerLine: number): CaptionChunk[] {
  const out: CaptionChunk[] = [];
  for (let i = 0; i < words.length; i += maxPerLine) {
    const slice = words.slice(i, i + maxPerLine);
    out.push({ words: slice, emphasis: slice.map(() => false) });
  }
  return out;
}

function toPalette(ef: string | string[] | undefined, fallback: string): string[] {
  if (Array.isArray(ef)) return ef.length > 0 ? ef : [fallback];
  if (typeof ef === 'string') return [ef];
  return [fallback];
}

function applyTransform(word: string, transform: string): string {
  if (transform === 'uppercase') return word.toUpperCase();
  if (transform === 'lowercase') return word.toLowerCase();
  return word;
}

// Per-letter motion FX adapted from FX Lab Vol.02. Per-letter effects
// (samba/crystal/magnetic) split the word into character spans with their
// own transform; full-word effects (breathe/flare) keep the single span and
// apply CSS filter / text-shadow on top of the existing entry animation.
//
// All math is frame-driven (useCurrentFrame + word.start) so renders are
// deterministic across the Player and headless Lambda render paths.

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const easeOutQuint = (t: number) => 1 - Math.pow(1 - t, 5);

// Deterministic LCG per letter — same seed → same scatter direction every
// frame, so the shatter / magnetic effects don't rejitter on each render.
function seedRand(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s * 1664525 + 1013904223) | 0;
    return ((s >>> 0) % 100000) / 100000;
  };
}

// FX-08 Lens Breathe — entry blur 14→0 over 600ms, then sine breath 0..1.4px
function breatheBlurPx(elapsedMs: number): number {
  const entryT = Math.min(1, elapsedMs / 600);
  const entryE = easeOutQuint(entryT);
  const entryBlur = (1 - entryE) * 14;
  const hold = Math.max(0, elapsedMs - 600);
  const breathPhase = (hold / 1800) * Math.PI * 2;
  const breathBlur = (Math.sin(breathPhase) + 1) * 0.5 * 1.4;
  return entryBlur + breathBlur;
}

// FX-09 Anamorphic Flare — bell curve at t=0.25, decays to a low sustain.
// Approximates the SVG asymmetric blur via CSS text-shadow with horizontal
// spread (the asymmetry — wide on X, sharp on Y — is what reads anamorphic).
function flareTextShadow(elapsedMs: number, color: string): string {
  const t = Math.min(1, elapsedMs / 700);
  const bell = Math.exp(-Math.pow((t - 0.25) * 5, 2));
  const sustain = (1 - t) * 0.15 + 0.05;
  const intensity = Math.max(bell, sustain);
  const spread = (intensity * 80).toFixed(1);
  const blur = (intensity * 24 + 4).toFixed(1);
  return `${spread}px 0 ${blur}px ${color}, -${spread}px 0 ${blur}px ${color}`;
}

// FX-07 Calçadão — partido alto clave. Sustains during hold (loops).
function sambaLetterTransform(
  letterIdx: number,
  elapsedMs: number,
  nowMs: number,
): { transform: string; opacity: number } {
  const entryT = Math.min(1, elapsedMs / 400);
  const entryE = easeOutCubic(entryT);
  const cycleMs = 1200;
  const cycle = ((nowMs % cycleMs) + cycleMs) % cycleMs / cycleMs;
  const hits = [0, 0.25, 0.375, 0.625, 0.75];
  const letterPhase = (cycle + letterIdx * 0.06) % 1;
  let pulse = 0;
  for (const h of hits) {
    const d = Math.abs(letterPhase - h);
    const dm = Math.min(d, 1 - d);
    const k = Math.exp(-dm * 32);
    if (k > pulse) pulse = k;
  }
  const yOff = -pulse * 14 * entryE;
  const sX = (1 + pulse * 0.06) * entryE + (1 - entryE) * 0.7;
  const sY = (1 + pulse * 0.18) * entryE + (1 - entryE) * 0.7;
  const xSway = Math.sin(cycle * Math.PI * 2 + letterIdx * 0.5) * 1.5 * entryE;
  return {
    transform: `translate(${xSway.toFixed(2)}px, ${yOff.toFixed(2)}px) scale(${sX.toFixed(3)}, ${sY.toFixed(3)})`,
    opacity: entryE,
  };
}

// FX-10 Crystalline Shatter — entry-only fracture, snaps with easeOutQuint.
function crystalLetterTransform(
  letterIdx: number,
  elapsedMs: number,
): { transform: string; opacity: number } {
  const t = Math.min(1, elapsedMs / 900);
  const e = easeOutQuint(t);
  const rng = seedRand(letterIdx * 73 + 19);
  const angle = rng() * Math.PI * 2;
  const dist = 60 + rng() * 90;
  const dx = Math.cos(angle) * dist * (1 - e);
  const dy = Math.sin(angle) * dist * (1 - e);
  const rot = (rng() - 0.5) * 60 * (1 - e);
  const sc = 0.4 + e * 0.6;
  return {
    transform: `translate(${dx.toFixed(2)}px, ${dy.toFixed(2)}px) rotate(${rot.toFixed(1)}deg) scale(${sc.toFixed(3)})`,
    opacity: e,
  };
}

// FX-12 Magnetic Pull — damped oscillator e^(-kt) * cos(ωt) snap-back.
function magneticLetterTransform(
  letterIdx: number,
  elapsedMs: number,
): { transform: string; opacity: number } {
  const t = Math.min(1, elapsedMs / 1100);
  const rng = seedRand(letterIdx * 41 + 7);
  const angle = rng() * Math.PI * 2;
  const dist = 80 + rng() * 60;
  const k = 4.5;
  const omega = 9;
  const decay = Math.exp(-k * t);
  const osc = Math.cos(omega * t);
  const factor = decay * osc;
  const dx = Math.cos(angle) * dist * factor;
  const dy = Math.sin(angle) * dist * factor;
  const rotMax = (rng() - 0.5) * 80;
  const rot = rotMax * factor;
  return {
    transform: `translate(${dx.toFixed(2)}px, ${dy.toFixed(2)}px) rotate(${rot.toFixed(1)}deg)`,
    opacity: Math.min(1, t * 2.5),
  };
}

// FX Lab Vol.03 — intensity-driven body motion (resonance / plasma / inflation
// / ferro / shockwave). Each takes a single 0..1 intensity that scales BOTH
// amplitude AND rate; primitive attributes are recomputed per frame from
// useCurrentFrame() inside the React tree, so seeds advance deterministically
// and the same frame always produces the same render (Player + Lambda parity).
//
// Slice glitch lives separately — it's structural (10 stacked clip-path bands)
// not filter-based — and is rendered inline in the per-word branch.

type Vol03Effect = 'resonance' | 'plasma' | 'inflation' | 'ferro' | 'shockwave';

const VOL03_EFFECTS: ReadonlyArray<Vol03Effect> = [
  'resonance', 'plasma', 'inflation', 'ferro', 'shockwave',
];

function isVol03Effect(e: string | undefined): e is Vol03Effect {
  return e === 'resonance' || e === 'plasma' || e === 'inflation'
    || e === 'ferro' || e === 'shockwave';
}

function hexToRgb(hex: string): [number, number, number] {
  let h = hex.trim().replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (h.length === 8) h = h.slice(0, 6);
  const n = parseInt(h, 16);
  if (Number.isNaN(n)) return [255, 255, 255];
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function blendRgbHex(a: [number, number, number], b: [number, number, number], t: number): string {
  const r = Math.round(a[0] + (b[0] - a[0]) * t);
  const g = Math.round(a[1] + (b[1] - a[1]) * t);
  const bl = Math.round(a[2] + (b[2] - a[2]) * t);
  return `rgb(${r}, ${g}, ${bl})`;
}

const FX_FILTER_REGION = { x: '-30%', y: '-50%', width: '160%', height: '200%' };

function FxFilter({
  id,
  effect,
  intensity,
  frameSec,
  tierFillHex,
}: {
  id: string;
  effect: Vol03Effect;
  intensity: number;
  frameSec: number;
  tierFillHex: string;
}) {
  const I = Math.max(0, Math.min(1, intensity));
  const t = frameSec;

  if (effect === 'resonance') {
    const seed1 = Math.floor(t * 6) % 200;
    const seed2 = Math.floor(t * 9) % 200;
    const freqLow = 5 + I * 8;
    const freqHigh = 14 + I * 18;
    const scale1 = I * 18 * Math.sin(t * freqLow);
    const scale2 = I * 10 * Math.sin(t * freqHigh + 1.7);
    return (
      <filter id={id} {...FX_FILTER_REGION}>
        <feTurbulence type="turbulence" baseFrequency="0.018" numOctaves={2} seed={seed1} result="t1" />
        <feDisplacementMap in="SourceGraphic" in2="t1" scale={scale1} result="d1" />
        <feTurbulence type="fractalNoise" baseFrequency="0.06" numOctaves={2} seed={seed2} result="t2" />
        <feDisplacementMap in="d1" in2="t2" scale={scale2} />
      </filter>
    );
  }

  if (effect === 'plasma') {
    const seed = Math.floor(t * (1 + I * 4)) % 100;
    const bf1 = (0.018 + I * 0.012).toFixed(4);
    const bf2 = (0.025 + I * 0.018).toFixed(4);
    const alphaMul = Math.min(1, I * 1.1).toFixed(3);
    return (
      <filter id={id} x="-10%" y="-10%" width="120%" height="120%">
        <feTurbulence type="fractalNoise" baseFrequency={`${bf1} ${bf2}`} numOctaves={2} seed={seed} result="noise" />
        <feComponentTransfer in="noise" result="hot">
          <feFuncR type="table" tableValues="0.05 0.4 0.95 1 0.95" />
          <feFuncG type="table" tableValues="0 0.05 0.5 0.85 0.95" />
          <feFuncB type="table" tableValues="0.2 0 0 0.05 0.4" />
          <feFuncA type="table" tableValues="0 1 1 1 1" />
        </feComponentTransfer>
        <feComposite in="hot" in2="SourceGraphic" operator="in" result="masked" />
        <feColorMatrix
          in="masked"
          type="matrix"
          values={`1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 ${alphaMul} 0`}
          result="opacityCtl"
        />
        <feMerge>
          <feMergeNode in="SourceGraphic" />
          <feMergeNode in="opacityCtl" />
        </feMerge>
      </filter>
    );
  }

  if (effect === 'inflation') {
    const breathRate = 1.6 + I * 3.0;
    const breathPhase = Math.sin(t * breathRate);
    const breathBias = I * 0.4;
    const breathOsc = breathPhase * (0.05 + I * 0.4);
    const radius = Math.max(0, breathBias + breathOsc);
    return (
      <filter id={id} x="-15%" y="-25%" width="130%" height="150%">
        <feMorphology operator="dilate" radius={radius} in="SourceGraphic" />
      </filter>
    );
  }

  if (effect === 'ferro') {
    const radius = 0.5 + I * 7.5;
    const dispScale = I * 28;
    const bf = (0.35 + I * 0.4).toFixed(3);
    const seedRate = 8 + I * 30;
    const seed = Math.floor(t * seedRate) % 250;
    const baseRgb = hexToRgb(tierFillHex);
    const hotRgb: [number, number, number] = [0xff, 0x5b, 0x3c];
    const floodColor = blendRgbHex(baseRgb, hotRgb, I);
    return (
      <filter id={id} {...FX_FILTER_REGION}>
        <feMorphology operator="dilate" radius={radius} in="SourceGraphic" result="dilated" />
        <feComposite operator="out" in="dilated" in2="SourceGraphic" result="halo" />
        <feTurbulence type="fractalNoise" baseFrequency={bf} numOctaves={2} seed={seed} result="spikeNoise" />
        <feDisplacementMap in="halo" in2="spikeNoise" scale={dispScale} result="spikes" />
        <feFlood floodColor={floodColor} result="flood" />
        <feComposite operator="in" in="flood" in2="spikes" result="coloredSpikes" />
        <feMerge>
          <feMergeNode in="coloredSpikes" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    );
  }

  // shockwave
  const omega = 9 + I * 50;
  const pulse = Math.abs(Math.sin(t * omega));
  const dispScale = pulse * I * 32;
  const bf = (0.018 + I * 0.04).toFixed(4);
  const seed = Math.floor(t * 2) % 200;
  return (
    <filter id={id} x="-15%" y="-25%" width="130%" height="150%">
      <feTurbulence type="turbulence" baseFrequency={bf} numOctaves={1} seed={seed} result="wave" />
      <feDisplacementMap in="SourceGraphic" in2="wave" scale={dispScale} />
    </filter>
  );
}

type FxRequest = { id: string; effect: Vol03Effect; intensity: number; tierFillHex: string };

function FxFilterDefs({ requests, frameSec }: { requests: FxRequest[]; frameSec: number }) {
  if (requests.length === 0) return null;
  return (
    <svg
      width="0"
      height="0"
      style={{ position: 'absolute', width: 0, height: 0, pointerEvents: 'none' }}
      aria-hidden="true"
    >
      <defs>
        {requests.map((r) => (
          <FxFilter
            key={r.id}
            id={r.id}
            effect={r.effect}
            intensity={r.intensity}
            frameSec={frameSec}
            tierFillHex={r.tierFillHex}
          />
        ))}
      </defs>
    </svg>
  );
}

// Slice glitch — 10 horizontal-band stacked copies, per-band offsets driven
// by deterministic frame-tick pseudo-random. Bypasses the per-letter render.
function SliceWord({
  text,
  intensity,
  frameSec,
  fontStyles,
  fillStyles,
  baseColor,
  scale,
  opacity,
}: {
  text: string;
  intensity: number;
  frameSec: number;
  fontStyles: React.CSSProperties;
  fillStyles: React.CSSProperties;
  baseColor: string;
  scale: number;
  opacity: number;
}) {
  const I = Math.max(0, Math.min(1, intensity));
  const BANDS = 10;
  const tickMs = Math.max(20, 200 - I * 170);
  const tick = Math.floor((frameSec * 1000) / tickMs);
  const maxOffset = I * 22;

  const bandRand = (i: number, k: number): number => {
    const s = ((i * 9173) ^ (k * 31337)) >>> 0;
    return ((s * 1664525 + 1013904223) >>> 0) / 4294967295;
  };

  const bands: React.ReactNode[] = [];
  for (let i = 0; i < BANDS; i++) {
    const r = bandRand(i, tick);
    let off = (r - 0.5) * 2 * maxOffset;
    const r2 = bandRand(i, tick + 1000);
    if (r2 > 0.4 + I * 0.55) off = 0;

    let bandColor = baseColor;
    if (I > 0.6 && Math.abs(off) > 4) {
      if (i % 3 === 0) bandColor = '#4dd4ff';
      else if (i % 3 === 1) bandColor = '#ff5b3c';
    }

    const topPct = (i / BANDS) * 100;
    const botPct = ((BANDS - i - 1) / BANDS) * 100;

    bands.push(
      <span
        key={i}
        style={{
          ...fontStyles,
          ...fillStyles,
          color: bandColor,
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          clipPath: `inset(${topPct.toFixed(3)}% 0 ${botPct.toFixed(3)}% 0)`,
          WebkitClipPath: `inset(${topPct.toFixed(3)}% 0 ${botPct.toFixed(3)}% 0)`,
          transform: `translateX(${off.toFixed(2)}px)`,
        }}
      >
        {text}
      </span>,
    );
  }

  return (
    <span
      style={{
        position: 'relative',
        display: 'inline-block',
        transform: scale !== 1 ? `scale(${scale})` : undefined,
        transformOrigin: 'left baseline',
        opacity,
      }}
    >
      {/* Layout placeholder so the word reserves correct width — invisible but laid out */}
      <span style={{ ...fontStyles, ...fillStyles, color: 'transparent', visibility: 'hidden' }}>
        {text}
      </span>
      {bands}
    </span>
  );
}

type Props = {
  videoFile: string;
  videoMeta: { width: number; height: number; durationInFrames: number; fps: number };
  transcript: Transcript;
  captionPlan: CaptionPlan | null;
  faces: FaceData | null;
  styleSpec: Record<string, any>;
};

export const ReelClone: React.FC<Props> = ({
  videoFile,
  transcript,
  captionPlan,
  styleSpec,
}) => {
  const frame = useCurrentFrame();
  const { fps, width: frameWidth, height: frameHeight } = useVideoConfig();
  const t = frame / fps;

  // --- Read ALL config from styleSpec ---
  const font = styleSpec.font ?? {};
  const color = styleSpec.color ?? {};
  const layout = styleSpec.layout ?? {};
  const anim = styleSpec.animation ?? {};
  const reel = styleSpec.reel ?? {};

  // Font
  const fontFamily = font.family ?? 'Inter';
  const nominalSize = font.size ?? 64;
  const baseSize = nominalSize * (frameWidth / 1080);
  const baseWeight = font.weight ?? 800;
  const baseLetterSpacing = font.letterSpacing ?? 0;
  const baseTextTransform = font.textTransform ?? 'none';

  // Colors
  const fillColor = color.fill ?? '#ffffff';
  const strokeColor = color.stroke ?? '#000000';
  const strokeWidth = color.strokeWidth ?? 0;
  const palette = toPalette(color.emphasisFill, fillColor);

  // Layout
  const maxPerLine = layout.maxWordsPerLine ?? 4;
  const position = layout.position ?? 'bottom';
  const safeMargin = layout.safeMargin ?? 0.15;
  const align = layout.align ?? 'left';

  // Animation
  const tailMs = anim.tailMs ?? 200;
  const scaleFrom = anim.scaleFrom ?? 1.0;
  const springDamping = anim.spring?.damping ?? 14;
  const springStiffness = anim.spring?.stiffness ?? 240;
  const springMass = anim.spring?.mass ?? 0.5;
  const animDuration = anim.durationMs ?? 150;

  // Reel-specific config (all StyleSpec-driven, all with safe defaults)
  const emphasisStyleRaw = (reel.emphasisStyle ?? 'combined') as
    | 'combined' | 'block' | 'inline-color';
  const emphasisFillRatio: number | null =
    typeof reel.emphasisFillRatio === 'number' ? reel.emphasisFillRatio : null;
  const emphasisMaxHeightRatio: number =
    typeof reel.emphasisMaxHeightRatio === 'number' ? reel.emphasisMaxHeightRatio : 0.2;
  const cascadeTopRatio: number =
    typeof reel.cascadeTopRatio === 'number' ? reel.cascadeTopRatio : 1.0;
  const cascadeBottomRatio: number =
    typeof reel.cascadeBottomRatio === 'number' ? reel.cascadeBottomRatio : 1.0;
  const multiColorEmphasis: boolean = reel.multiColorEmphasis === true;
  // Per-tier styling overrides. Editor surfaces these as "Primary emphasis"
  // (palette index 0), "Secondary emphasis" (palette index 1) and "Italic
  // accent" tabs. Each tier may override fill (solid hex with alpha or a
  // linear gradient {type, angle, stops}), fontFamily, fontWeight,
  // sizeMultiplier, strokeColor, strokeWidth — anything unset falls back
  // to the base (cascade / palette / fill / weight / etc.) so old presets
  // keep rendering identically.
  type GradientFillObj = {
    type?: 'linear';
    angle?: number;
    stops: Array<{ pos: number; color: string }>;
  };
  type TierFill = string | GradientFillObj;
  type EffectId =
    | 'none' | 'samba' | 'breathe' | 'flare' | 'crystal' | 'magnetic'
    | 'resonance' | 'plasma' | 'inflation' | 'slice' | 'ferro' | 'shockwave';
  type TierStyle = {
    fill?: TierFill;
    fontFamily?: string;
    fontWeight?: number;
    sizeMultiplier?: number;
    strokeColor?: string;
    strokeWidth?: number;
    // Motion FX applied to words rendered at this tier. Adapted from FX Lab
    // Vol.02 — see web/src/lib/templateDescriptors/reel-clone.ts for the
    // picker. Per-letter effects (samba/crystal/magnetic) split the word
    // into character spans; full-word effects (breathe/flare) wrap once.
    // Vol.03 effects (resonance/plasma/inflation/slice/ferro/shockwave) are
    // SVG-filter-based body distortions driven by `intensity` (0..1).
    effect?: EffectId;
    // Single 0..1 dial driving both amplitude and rate of the Vol.03
    // intensity-driven effects. Ignored for Vol.02 effects (none/samba/etc).
    intensity?: number;
  };
  const tiers = (reel.tiers ?? {}) as {
    byPaletteIndex?: Record<string, TierStyle>;
    italic?: TierStyle;
  };
  // Italic style is now a generic *rate*, not a specific vocab list. The
  // preset's italicAccentRate (0..1) declares what fraction of qualifying
  // emphasis-style words the source reel rendered italic. We replicate that
  // density deterministically on the input transcript: hash each candidate
  // word and italicize the bottom italicAccentRate fraction. Same word
  // always gets the same treatment, so the result is stable across re-renders
  // but distributed naturally across the video.
  const italicAccentRate: number = typeof reel.italicAccentRate === 'number'
    ? Math.max(0, Math.min(1, reel.italicAccentRate))
    : 0;
  // Backward-compat: respect old italicVocabulary lists if a hand-tuned
  // preset still uses them (e.g. v7).
  const italicVocabulary: string[] = Array.isArray(reel.italicVocabulary)
    ? reel.italicVocabulary.map((s: any) => String(s).toLowerCase())
    : [];
  const editDistance = (a: string, b: string): number => {
    if (a === b) return 0;
    const m = a.length, n = b.length;
    if (m === 0) return n;
    if (n === 0) return m;
    const dp: number[] = new Array(n + 1);
    for (let j = 0; j <= n; j++) dp[j] = j;
    for (let i = 1; i <= m; i++) {
      let prev = dp[0]!;
      dp[0] = i;
      for (let j = 1; j <= n; j++) {
        const tmp = dp[j]!;
        dp[j] = a[i - 1] === b[j - 1]
          ? prev
          : 1 + Math.min(prev, dp[j]!, dp[j - 1]!);
        prev = tmp;
      }
    }
    return dp[n]!;
  };
  // Stable string hash — FNV-1a 32-bit. Better distribution on short words
  // than polynomial 31-shift, so the italic-rate selection actually reaches
  // its target fraction even on small word sets (~30-50 unique words).
  const hashUnit = (s: string): number => {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0) / 0x100000000;
  };
  const isItalicWord = (key: string): boolean => {
    // Eligibility for italic accent treatment: long content word (>= 5 alpha
    // chars) — short words like "is" / "a" wouldn't read as italic anyway.
    if (key.length < 5) return false;
    // Vocabulary path (back-compat with hand-tuned presets)
    if (italicVocabulary.length > 0) {
      for (const v of italicVocabulary) {
        if (v === key) return true;
        const longer = Math.max(v.length, key.length);
        if (editDistance(v, key) / longer <= 0.34) return true;
      }
    }
    // Rate path (auto-extracted presets) — deterministically italicize the
    // hash-bucket fraction that matches the source's measured italic rate.
    // Floor at 0.08 when nonzero to ensure visible italic accents even on
    // short transcripts (~30-50 unique qualifying words) where small target
    // rates would statistically miss everything. Cap at 0.30 so italic
    // doesn't overwhelm.
    if (italicAccentRate > 0) {
      const effective = Math.max(0.08, Math.min(0.3, italicAccentRate));
      if (hashUnit(key) < effective) return true;
    }
    return false;
  };
  const emphasisSizeMultiplier = reel.emphasisSizeMultiplier ?? 1.0;
  const fillerSizeMultiplier = reel.fillerSizeMultiplier ?? 1.0;
  // Resolve emphasis behavior from emphasisStyle. Individual reel.* fields can
  // still override (e.g. user sets emphasisStyle:'block' but explicitly opts
  // out of line break). Switch sets the *defaults* per mode.
  const styleDefaults =
    emphasisStyleRaw === 'inline-color'
      ? { useColor: true, transform: baseTextTransform, lineBreak: false, sizeRule: 'fixed' as const }
      : emphasisStyleRaw === 'block'
        ? { useColor: false, transform: 'uppercase' as const, lineBreak: true, sizeRule: 'fit' as const }
        : { useColor: true, transform: 'uppercase' as const, lineBreak: true, sizeRule: 'fixed' as const };
  const emphasisUsesColor = reel.emphasisUsesColor ?? styleDefaults.useColor;
  const emphasisTextTransform = reel.emphasisTextTransform ?? styleDefaults.transform;
  const fillerTextTransform = reel.fillerTextTransform ?? baseTextTransform;
  const mediumTextTransform = reel.mediumTextTransform ?? baseTextTransform;
  const emphasisLineBreak = reel.emphasisLineBreak ?? styleDefaults.lineBreak;
  const emphasisWeight = reel.emphasisWeight ?? baseWeight;
  const wordReveal = reel.wordReveal ?? 'all';
  // Default ON: when the caption plan has no emphasis flags (LLM enrich
  // failed, plan never ran, or every word is filler), the renderer falls
  // back to a heuristic so themes' primary/secondary tiers still fire.
  // A preset can still opt out with `reel.inferEmphasis: false`.
  const doInferEmphasis = reel.inferEmphasis ?? true;
  const columnGapRatio = reel.columnGapRatio ?? 0.2;
  const rowGapRatio = reel.rowGapRatio ?? 0.05;
  const maxWidthPercent = reel.maxWidthPercent ?? 90;
  const paddingPercent = reel.paddingPercent ?? 6;

  // Computed sizes
  const sizeEmphasis = baseSize * emphasisSizeMultiplier;
  const sizeMedium = baseSize;
  const sizeFiller = baseSize * fillerSizeMultiplier;

  const USABLE_WIDTH = frameWidth * (maxWidthPercent / 100);
  // CHAR_ADVANCE controls how the renderer estimates a word's pixel-width
  // from its font-size. The default 0.58 was a conservative generic value
  // that under-sized text for Inter Black with tight letterSpacing (real
  // measured value ~0.50). Allow the styleSpec to override for fonts/
  // tracking combos where 0.58 doesn't fit.
  const CHAR_ADVANCE = typeof styleSpec.charAdvance === 'number'
    ? styleSpec.charAdvance
    : 0.58;
  const maxSizeForWord = (len: number) =>
    len > 0 ? USABLE_WIDTH / (len * CHAR_ADVANCE) : Infinity;

  // Chunks
  const chunks: CaptionChunk[] = captionPlan
    ? captionPlan.chunks
    : fallbackChunks(transcript.words, maxPerLine);

  // Active chunk selection
  const tailSec = tailMs / 1000;
  let activeChunkIdx = -1;
  for (let i = chunks.length - 1; i >= 0; i--) {
    const c = chunks[i];
    if (c && c.words.length > 0 && t >= c.words[0]!.start) {
      const next = chunks[i + 1];
      if (next && next.words.length > 0 && t >= next.words[0]!.start) continue;
      const lastWord = c.words[c.words.length - 1]!;
      if (t <= lastWord.end + tailSec || !next) {
        activeChunkIdx = i;
        break;
      }
    }
  }

  if (activeChunkIdx < 0) {
    return (
      <AbsoluteFill style={{ backgroundColor: '#000' }}>
        {videoFile && (
          <OffthreadVideo src={videoFile.startsWith('http') ? videoFile : staticFile(videoFile)} />
        )}
      </AbsoluteFill>
    );
  }

  const activeChunk = chunks[activeChunkIdx]!;
  const emphasisColor = palette[activeChunkIdx % palette.length] ?? fillColor;

  // Emphasis flags
  const hasAnyEmphasis = activeChunk.emphasis.some((e) => e === true);
  const effectiveEmphasis: boolean[] =
    hasAnyEmphasis ? activeChunk.emphasis
    : doInferEmphasis ? inferEmphasis(activeChunk.words)
    : activeChunk.emphasis;

  // Position styles
  const positionStyle: React.CSSProperties =
    position === 'top'
      ? { top: `${safeMargin * 100}%` }
      : position === 'middle'
        ? { top: '50%', transform: 'translateY(-50%)' }
        : { bottom: `${safeMargin * 100}%` };

  const justifyContent =
    align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center';

  // Vol.03 filter requests — one filter per (tierKey, effect) pair that's
  // configured. Slice glitch is structural, not filter-based, so it's
  // excluded here. Filter ids are referenced by the per-word render branch.
  const fxRequests: FxRequest[] = [];
  const fxRequestKeys = new Set<string>();
  const pushFxRequest = (tierKey: string, tier: TierStyle | undefined): void => {
    if (!tier) return;
    const eff = tier.effect;
    if (!isVol03Effect(eff)) return;
    const id = `fx-${tierKey}-${eff}`;
    if (fxRequestKeys.has(id)) return;
    fxRequestKeys.add(id);
    const intensity = typeof tier.intensity === 'number' ? tier.intensity : 0.5;
    const tierFillHex = typeof tier.fill === 'string'
      ? tier.fill
      : (palette[0] ?? fillColor);
    fxRequests.push({ id, effect: eff, intensity, tierFillHex });
  };
  if (tiers.byPaletteIndex) {
    for (const [k, v] of Object.entries(tiers.byPaletteIndex)) {
      pushFxRequest(`p${k}`, v);
    }
  }
  pushFxRequest('italic', tiers.italic);

  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      {videoFile && (
        <OffthreadVideo src={videoFile.startsWith('http') ? videoFile : staticFile(videoFile)} />
      )}
      <FxFilterDefs requests={fxRequests} frameSec={t} />
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          display: 'flex',
          justifyContent,
          padding: `0 ${paddingPercent}%`,
          ...positionStyle,
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center',
            rowGap: `${baseSize * rowGapRatio}px`,
            maxWidth: `${maxWidthPercent}%`,
          }}
        >
          {(() => {
            // 1. Group words into explicit logical lines.
            //    Only LAST-WORD emphasis breaks to its own line — that's the
            //    anchor block treatment. Mid-stack emphasis stays inline so
            //    it can carry inline-color treatment instead.
            type LineEntry = { wordIdx: number };
            const lines: LineEntry[][] = [];
            let cur: LineEntry[] = [];
            const flush = () => {
              if (cur.length > 0) {
                lines.push(cur);
                cur = [];
              }
            };
            const lastWordIdx = activeChunk.words.length - 1;
            const isDigitWord = (s: string) => /\d/.test(s);
            const stripped = (s: string) => s.replace(/[^A-Za-z0-9]/g, '');
            const valueKey = (s: string) =>
              s.toLowerCase().replace(/[.,!?;:"'()—\-_]/g, '');
            const isValueLike = (s: string) => VALUE_WORDS.has(valueKey(s));
            for (let i = 0; i < activeChunk.words.length; i++) {
              const isEmph = effectiveEmphasis[i] ?? false;
              const word = activeChunk.words[i]!.word;
              // Anchor break: only meaty alpha emphasis on the FINAL word
              // goes on its own line for block treatment. Numbers, value-
              // words, and short emphasis words stay inline so they can
              // carry inline-color treatment (matches references like
              // "I was *26*" or "are *never*" — same line, just colored).
              const isAnchorEmph =
                emphasisLineBreak &&
                isEmph &&
                i === lastWordIdx &&
                !isDigitWord(word) &&
                !isValueLike(word) &&
                stripped(word).length >= 5;
              if (isAnchorEmph) {
                flush();
                lines.push([{ wordIdx: i }]);
              } else {
                cur.push({ wordIdx: i });
                if (cur.length >= maxPerLine) flush();
              }
            }
            flush();

            // 1b. Width-budget split — re-walk each line and break it whenever
            // the cumulative word-width exceeds USABLE_WIDTH. Same source-of-
            // truth as `maxSizeForWord` so the split decision and the actual
            // rendered size agree. Without this, long inline words like
            // "i don't WANT" can spill past the frame edge in narrow videos.
            const splitLines: LineEntry[][] = [];
            const widthBudget = USABLE_WIDTH;
            for (let li = 0; li < lines.length; li++) {
              const line = lines[li]!;
              if (line.length <= 1) {
                splitLines.push(line);
                continue;
              }
              // Estimate the per-line cascade factor at this index assuming
              // current chunk shape; if splitting adds rows the factor is
              // recalculated later (this estimate is conservative).
              const factor = lines.length <= 1
                ? cascadeBottomRatio
                : cascadeTopRatio +
                  (cascadeBottomRatio - cascadeTopRatio) *
                    (li / (lines.length - 1));
              const wordSize = baseSize * factor;
              const gap = baseSize * factor * columnGapRatio;
              let bucket: LineEntry[] = [];
              let bucketWidth = 0;
              for (const entry of line) {
                const w = activeChunk.words[entry.wordIdx]!;
                const wordWidth = wordSize * Math.max(1, w.word.length) * CHAR_ADVANCE;
                const needsBreak = bucket.length > 0 &&
                  bucketWidth + gap + wordWidth > widthBudget;
                if (needsBreak) {
                  splitLines.push(bucket);
                  bucket = [];
                  bucketWidth = 0;
                }
                bucket.push(entry);
                bucketWidth += wordWidth + (bucket.length > 1 ? gap : 0);
              }
              if (bucket.length > 0) splitLines.push(bucket);
            }
            // Replace `lines` with the width-aware split.
            lines.length = 0;
            for (const l of splitLines) lines.push(l);

            // 2. Track emphasis count for multi-color cycling.
            let emphasisSeen = 0;

            return lines.map((line, lineIdx) => {
              // Per-line size factor: cascade from top (small) to bottom (anchor).
              const lineFactor =
                lines.length <= 1
                  ? cascadeBottomRatio
                  : cascadeTopRatio +
                    (cascadeBottomRatio - cascadeTopRatio) *
                      (lineIdx / (lines.length - 1));

              // Pre-pass: compute each word's intended size and the line's
              // estimated rendered width. The earlier width-budget splitter
              // assumes uniform `baseSize * factor` per word, but the actual
              // render scales emphasis tiers (anchor-block fitSize,
              // emphasisSizeMultiplier, etc.). When that diverges, two words
              // that "fit" by the splitter's count can still overflow the
              // frame. This shrinks the whole line uniformly if it does.
              const isLastLine = lineIdx === lines.length - 1;
              const cascadeBaseLine = baseSize * lineFactor;
              const sizeHints: number[] = [];
              let estLineWidth = 0;
              for (let lci = 0; lci < line.length; lci++) {
                const wi = line[lci]!.wordIdx;
                const ww = activeChunk.words[wi]!;
                const isEmph = effectiveEmphasis[wi] ?? false;
                const onOwn = line.length === 1;
                const hasDigit = /\d/.test(ww.word);
                const alphaLen = ww.word.replace(/[^A-Za-z]/g, '').length;
                const keyLower = ww.word.toLowerCase().replace(/[.,!?;:"'()—\-_]/g, '');
                const isAnchorBlk =
                  isEmph && isLastLine && onOwn &&
                  styleDefaults.sizeRule === 'fit' &&
                  emphasisFillRatio != null &&
                  !hasDigit && !VALUE_WORDS.has(keyLower) && alphaLen >= 5;
                const fitSz = isAnchorBlk
                  ? (USABLE_WIDTH * emphasisFillRatio!) /
                    Math.max(1, ww.word.length * CHAR_ADVANCE)
                  : null;
                const fillerLocal = !isEmph && isFiller(ww.word);
                const tMul = isEmph && !isAnchorBlk
                  ? 1.0
                  : isEmph
                    ? emphasisSizeMultiplier
                    : fillerLocal ? fillerSizeMultiplier : 1.0;
                const rawSz = fitSz != null ? fitSz : cascadeBaseLine * tMul;
                const hCap = isAnchorBlk
                  ? frameHeight * emphasisMaxHeightRatio
                  : frameHeight * 0.4;
                const sz = Math.min(rawSz, maxSizeForWord(ww.word.length), hCap);
                sizeHints.push(sz);
                estLineWidth += sz * Math.max(1, ww.word.length) * CHAR_ADVANCE;
              }
              const lineGap = cascadeBaseLine * columnGapRatio;
              estLineWidth += lineGap * Math.max(0, line.length - 1);
              const lineScale = estLineWidth > USABLE_WIDTH
                ? USABLE_WIDTH / estLineWidth
                : 1;
              return (
                <div
                  key={lineIdx}
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    justifyContent,
                    columnGap: `${cascadeBaseLine * lineScale * columnGapRatio}px`,
                  }}
                >
                  {line.map(({ wordIdx: i }) => {
                    const w = activeChunk.words[i]!;
                    const isEmphasis = effectiveEmphasis[i] ?? false;
                    const filler = !isEmphasis && isFiller(w.word);

                    const wordStartFrame = Math.floor(w.start * fps);
                    // Don't unmount unrevealed words — that would collapse
                    // their flex slot and the visible row would re-center /
                    // re-size as later words arrive ("push" effect). Instead
                    // we leave the element in the DOM so layout reserves the
                    // final slot from the chunk's first frame; opacity/scale
                    // (transform doesn't affect CSS layout) handle the
                    // visual reveal once the word's start time hits.

                    const entryFrame =
                      wordReveal === 'progressive'
                        ? wordStartFrame
                        : Math.floor(activeChunk.words[0]!.start * fps);
                    // Clamp the spring input to >= 0 so unrevealed words
                    // (frame < entryFrame) sit at progress=0 instead of
                    // hitting the spring with negative input. Combined
                    // with the no-null change above, this is what keeps
                    // pre-reveal slots invisible-but-laid-out.
                    const progress = spring({
                      frame: Math.max(0, frame - entryFrame),
                      fps,
                      durationInFrames: Math.max(1, Math.round((animDuration / 1000) * fps)),
                      config: { damping: springDamping, stiffness: springStiffness, mass: springMass },
                    });
                    const scale = scaleFrom + progress * (1 - scaleFrom);
                    const opacity = Math.min(1, scaleFrom < 1 ? progress * 1.5 : 1);

                    // Position-aware emphasis treatment:
                    //   anchor block = emphasis on its own line at the bottom
                    //                  → white, uppercase (per spec), width-fit size
                    //   inline color = emphasis anywhere else → palette color,
                    //                  no case change, no size change
                    const isAnchor = lineIdx === lines.length - 1;
                    const onOwnLine = line.length === 1;
                    const wordHasDigit = /\d/.test(w.word);
                    const wordAlphaLen = w.word.replace(/[^A-Za-z]/g, '').length;
                    const wordKeyEarly = w.word.toLowerCase().replace(/[.,!?;:"'()—\-_]/g, '');
                    const wordIsValue = VALUE_WORDS.has(wordKeyEarly);
                    // Determine anchor-block status FIRST, before italic. An
                    // anchor word should be rendered as a block (white
                    // uppercase huge), never as italic. Italic accents are
                    // reserved for mid-stack secondary emphasis.
                    const isAnchorBlock =
                      isEmphasis && isAnchor && onOwnLine &&
                      styleDefaults.sizeRule === 'fit' &&
                      emphasisFillRatio != null &&
                      !wordHasDigit &&
                      !wordIsValue &&
                      wordAlphaLen >= 5;
                    // Only italicize if NOT an anchor-block candidate. This
                    // prevents big anchor words like REALITY/CHANGES/TIME
                    // from being italicized away from their intended block
                    // treatment via the rate-based italic selection.
                    const wordIsItalic = !isAnchorBlock && isItalicWord(wordKeyEarly);

                    const fitSize = isAnchorBlock
                      ? (USABLE_WIDTH * emphasisFillRatio!) /
                        Math.max(1, w.word.length * CHAR_ADVANCE)
                      : null;

                    const cascadeBase = baseSize * lineFactor;
                    const tierMul = isEmphasis && !isAnchorBlock
                      ? 1.0  // inline emphasis keeps base/cascade size
                      : isEmphasis
                        ? emphasisSizeMultiplier
                        : filler ? fillerSizeMultiplier : 1.0;
                    const rawSize = fitSize != null ? fitSize : cascadeBase * tierMul;

                    const heightCap = isAnchorBlock
                      ? frameHeight * emphasisMaxHeightRatio
                      : frameHeight * 0.4;
                    const sizeUnscaled =
                      Math.min(rawSize, maxSizeForWord(w.word.length), heightCap);
                    // Apply the line-level shrink (computed in the pre-pass
                    // above) so the actual rendered line never overflows
                    // USABLE_WIDTH even when per-word sizing diverges from
                    // the splitter's coarse estimate.
                    const size = sizeUnscaled * lineScale;

                    // Color: anchor block keeps base fill (white), inline
                    // emphasis uses palette (cycles when multiColorEmphasis).
                    // Cycle math: within-chunk counter (emphasisSeen) +
                    // chunk index. Without the chunk-level shift, chunks
                    // with one emphasis word would all land on palette[0]
                    // and the rest of the palette would never appear.
                    let resolvedColor = fillColor;
                    const paletteIdx = isEmphasis && !isAnchorBlock
                      ? (emphasisSeen + activeChunkIdx) % palette.length
                      : -1;
                    if (isEmphasis && !isAnchorBlock) {
                      resolvedColor = multiColorEmphasis
                        ? palette[paletteIdx] ?? emphasisColor
                        : emphasisColor;
                    } else if (isEmphasis && isAnchorBlock && emphasisUsesColor) {
                      // Legacy 'combined' style still wants colored anchor.
                      resolvedColor = emphasisColor;
                    }
                    if (isEmphasis) emphasisSeen++;

                    // Transform: only the anchor block gets the emphasis
                    // transform (uppercase). Inline emphasis keeps lowercase
                    // so it sits naturally in the line ("I was 26", not "I WAS 26").
                    const transform = isAnchorBlock
                      ? emphasisTextTransform
                      : filler ? fillerTextTransform : mediumTextTransform;
                    const text = applyTransform(w.word, transform);
                    const baseWordWeight = isAnchorBlock ? emphasisWeight : baseWeight;
                    // Italic if word is in italicVocabulary (script-style accent).
                    // Italic overrides any color emphasis — reference reels render
                    // italic accent words in plain white, with italic carrying the
                    // visual emphasis instead of color.
                    const fontStyle: 'italic' | 'normal' = wordIsItalic ? 'italic' : 'normal';
                    const baseFinalColor = wordIsItalic ? fillColor : resolvedColor;

                    // Tier override resolution. Italic tier wins over palette
                    // tier (an italic word isn't simultaneously "yellow" or
                    // "red" — italic is its own visual lane).
                    const tier: TierStyle | undefined = wordIsItalic
                      ? tiers.italic
                      : (paletteIdx >= 0
                          ? tiers.byPaletteIndex?.[String(paletteIdx)]
                          : undefined);
                    const tierFontFamily = tier?.fontFamily ?? fontFamily;
                    const tierFontWeight =
                      typeof tier?.fontWeight === 'number' ? tier.fontWeight : baseWordWeight;
                    const tierSizeMul =
                      typeof tier?.sizeMultiplier === 'number' ? tier.sizeMultiplier : 1.0;
                    const tierStrokeColor = tier?.strokeColor ?? strokeColor;
                    const tierStrokeWidth =
                      typeof tier?.strokeWidth === 'number' ? tier.strokeWidth : strokeWidth;
                    const adjustedSize = size * tierSizeMul;
                    // Per-tier motion FX. Full-word effects (none/breathe/
                    // flare) keep the single span and use the existing
                    // entry spring; per-letter effects (samba/crystal/
                    // magnetic) split the word and drive each letter's
                    // transform/opacity from FX-Lab math (the spring
                    // entry is bypassed for per-letter so the effect math
                    // owns the motion). Vol.03 body-distortion effects
                    // (resonance/plasma/inflation/ferro/shockwave) attach
                    // an SVG filter via url(...) and keep the single span;
                    // slice glitch is structural (10 banded copies) and
                    // routes to <SliceWord/>.
                    const tierEffect: EffectId = (tier?.effect as any) ?? 'none';
                    const isPerLetterEffect =
                      tierEffect === 'samba' || tierEffect === 'crystal' || tierEffect === 'magnetic';
                    const isFilterEffect = isVol03Effect(tierEffect);
                    const tierIntensity =
                      typeof tier?.intensity === 'number' ? tier.intensity : 0.5;
                    const tierKey: string | null = wordIsItalic
                      ? 'italic'
                      : (paletteIdx >= 0 ? `p${paletteIdx}` : null);
                    const elapsedMs = ((frame - entryFrame) / fps) * 1000;
                    const nowMs = (frame / fps) * 1000;

                    // Tier fill: solid hex (with optional alpha) or linear
                    // gradient. Gradient gets painted via background-clip:text;
                    // solid sets `color` directly. When tier doesn't override,
                    // fall back to the existing per-word resolved color.
                    const tierFill = tier?.fill;
                    const isGradient =
                      tierFill && typeof tierFill === 'object' && Array.isArray((tierFill as any).stops);
                    const fillStyles: React.CSSProperties = isGradient
                      ? {
                          backgroundImage: (() => {
                            const g = tierFill as GradientFillObj;
                            const sortedStops = g.stops
                              .slice()
                              .sort((a, b) => a.pos - b.pos)
                              .map((s) => `${s.color} ${(s.pos * 100).toFixed(2)}%`)
                              .join(', ');
                            return `linear-gradient(${g.angle ?? 90}deg, ${sortedStops})`;
                          })(),
                          backgroundClip: 'text',
                          WebkitBackgroundClip: 'text',
                          WebkitTextFillColor: 'transparent',
                          color: 'transparent',
                        }
                      : {
                          color: typeof tierFill === 'string' ? tierFill : baseFinalColor,
                        };

                    // Build the per-character outer styles common to both
                    // rendering branches.
                    const fontStyles: React.CSSProperties = {
                      fontFamily: `"${tierFontFamily}", sans-serif`,
                      fontWeight: tierFontWeight,
                      fontStyle,
                      fontSize: `${adjustedSize}px`,
                      lineHeight: 1.0,
                      letterSpacing: baseLetterSpacing ? `${baseLetterSpacing}px` : undefined,
                      WebkitTextStroke: tierStrokeWidth > 0
                        ? `${tierStrokeWidth}px ${tierStrokeColor}`
                        : undefined,
                      paintOrder: tierStrokeWidth > 0 ? 'stroke fill' : undefined,
                      display: 'inline-block',
                      whiteSpace: 'nowrap',
                    };

                    // Slice glitch — structural, not filter-based. Render
                    // 10 stacked clip-banded copies via <SliceWord/>. Bypasses
                    // both the !isPerLetterEffect span path and the per-letter
                    // path (slice is its own rendering universe).
                    if (tierEffect === 'slice' && tierKey != null) {
                      const sliceColor =
                        typeof tierFill === 'string' ? tierFill : baseFinalColor;
                      return (
                        <SliceWord
                          key={i}
                          text={text}
                          intensity={tierIntensity}
                          frameSec={t}
                          fontStyles={fontStyles}
                          fillStyles={fillStyles}
                          baseColor={typeof sliceColor === 'string' ? sliceColor : fillColor}
                          scale={scale}
                          opacity={opacity}
                        />
                      );
                    }

                    // Full-word effects path: keep the single-span render
                    // (preserves entry spring scale + opacity), augment
                    // style with breathe blur, flare text-shadow, or a
                    // Vol.03 filter url() reference.
                    if (!isPerLetterEffect) {
                      const wordExtras: React.CSSProperties = {};
                      let combinedScale = scale;
                      if (tierEffect === 'breathe') {
                        wordExtras.filter = `blur(${breatheBlurPx(elapsedMs).toFixed(2)}px)`;
                      } else if (tierEffect === 'flare') {
                        // Flare color: use solid tier fill if available, else
                        // a cyan default that matches FX Lab Vol.02 demo.
                        const flareColor =
                          typeof tierFill === 'string' ? tierFill
                          : (typeof baseFinalColor === 'string' ? baseFinalColor : '#6ba5ff');
                        wordExtras.textShadow = flareTextShadow(elapsedMs, flareColor);
                      } else if (isFilterEffect && tierKey != null) {
                        // Vol.03 filter — body distortion via SVG filter url().
                        wordExtras.filter = `url(#fx-${tierKey}-${tierEffect})`;
                        // Inflation also gets a subtle whole-word breath scale
                        // on top of the dilate so the body visibly inflates &
                        // contracts (the dilate alone fattens but doesn't sell
                        // the breath rhythm).
                        if (tierEffect === 'inflation') {
                          const I = Math.max(0, Math.min(1, tierIntensity));
                          const breathRate = 1.6 + I * 3.0;
                          const breathPhase = Math.sin(t * breathRate);
                          combinedScale = scale * (1 + breathPhase * I * 0.04);
                        }
                      }
                      return (
                        <span
                          key={i}
                          style={{
                            ...fontStyles,
                            ...fillStyles,
                            ...wordExtras,
                            transform: combinedScale !== 1 ? `scale(${combinedScale})` : undefined,
                            transformOrigin: 'left baseline',
                            opacity,
                          }}
                        >
                          {text}
                        </span>
                      );
                    }

                    // Per-letter effects path: split the word into character
                    // spans, each with its own transform/opacity. Outer span
                    // carries the typography + fill; the spring entry is
                    // intentionally NOT applied here — the effect's own
                    // math (samba clave / crystal shatter / magnetic snap)
                    // is the entry animation.
                    const chars = Array.from(text);
                    return (
                      <span
                        key={i}
                        style={{
                          ...fontStyles,
                          // For gradient fills, propagate to children: each
                          // char gets the same gradient via inherit; with
                          // background-clip:text on the parent, child glyphs
                          // wouldn't paint, so we duplicate the styles per char.
                          color: typeof tierFill === 'string' ? tierFill : (isGradient ? undefined : baseFinalColor),
                        }}
                      >
                        {chars.map((ch, li) => {
                          const result =
                            tierEffect === 'samba' ? sambaLetterTransform(li, elapsedMs, nowMs)
                            : tierEffect === 'crystal' ? crystalLetterTransform(li, elapsedMs)
                            : magneticLetterTransform(li, elapsedMs);
                          return (
                            <span
                              key={li}
                              style={{
                                display: 'inline-block',
                                transform: result.transform,
                                transformOrigin: 'center center',
                                opacity: result.opacity,
                                // Per-letter must re-apply gradient styles
                                // since background-clip:text on parent
                                // doesn't propagate to children's text.
                                ...(isGradient ? fillStyles : null),
                                whiteSpace: 'pre',
                              }}
                            >
                              {ch === ' ' ? ' ' : ch}
                            </span>
                          );
                        })}
                      </span>
                    );
                  })}
                </div>
              );
            });
          })()}
        </div>
      </div>
    </AbsoluteFill>
  );
};
