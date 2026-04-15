import React from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';
import { effectivePosition, type FaceData } from './positioning';
import { animateWord } from './animationPresets';
import { resolveChunkStyle, type ChunkOverride } from './styleMerge';

// Caption-only overlay. Exactly the same logic as the body of PopWords —
// extracted so the producer's StoryComposition can stack captions on top
// of arbitrary <OffthreadVideo> or <Img> clips without duplicating the
// resolveStyle / chunk activation / animation machinery.
//
// Assumes the parent handles `useCurrentFrame` rebasing via <Series.Sequence>
// — inside a Sequence, frame=0 at the sequence start, so `transcript` and
// `captionPlan` should already be expressed in clip-local time.

export type Word = { word: string; start: number; end: number; confidence: number };
export type Transcript = { language: string; duration: number; words: Word[] };
export type CaptionChunk = { words: Word[]; emphasis: boolean[] };
export type CaptionPlan = { chunks: CaptionChunk[] };

type GradientStop = { pos: number; color: string };
type FillGradient = { type?: 'linear'; angle?: number; stops: GradientStop[] };
type Shadow = { color?: string; blurPx?: number; offsetX?: number; offsetY?: number };

export type StyleSpec = {
  font?: {
    family?: string;
    weight?: number;
    size?: number;
    letterSpacing?: number;
    textTransform?: 'none' | 'uppercase' | 'lowercase';
    variableAxes?: Record<string, number>;
  };
  color?: {
    fill?: string;
    stroke?: string;
    strokeWidth?: number;
    emphasisFill?: string | string[];
    background?: string;
    shadow?: Shadow;
    fillGradient?: FillGradient;
  };
  layout?: {
    position?: 'top' | 'middle' | 'bottom';
    safeMargin?: number;
    maxWordsPerLine?: number;
    align?: 'left' | 'center' | 'right';
    padding?: { x?: number; y?: number };
    borderRadius?: number;
    gapRatio?: number;
    singleWord?: {
      sizeMultiplier?: number;
      fitMargin?: number;
      charAdvanceEst?: number;
    };
  };
  animation?: {
    preset?: 'pop' | 'fade' | 'karaoke' | 'typewriter' | 'slide';
    durationMs?: number;
    emphasisScale?: number;
    scaleFrom?: number;
    activeBoost?: number;
    tailMs?: number;
    spring?: { damping?: number; stiffness?: number; mass?: number };
  };
  chunkOverrides?: ChunkOverride[];
};

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

function buildGradientImage(g: FillGradient): string {
  const angle = g.angle ?? 90;
  const stops = g.stops.map((s) => `${s.color} ${(s.pos * 100).toFixed(1)}%`).join(', ');
  return `linear-gradient(${angle}deg, ${stops})`;
}

function buildVariationSettings(axes: Record<string, number> | undefined): string | undefined {
  if (!axes) return undefined;
  const entries = Object.entries(axes);
  if (entries.length === 0) return undefined;
  return entries.map(([axis, val]) => `"${axis}" ${val}`).join(', ');
}

function buildTextShadow(s: Shadow | undefined): string | undefined {
  if (!s) return undefined;
  const c = s.color ?? '#000000cc';
  const blur = s.blurPx ?? 0;
  const x = s.offsetX ?? 0;
  const y = s.offsetY ?? 0;
  return `${x}px ${y}px ${blur}px ${c}`;
}

export function resolveStyle(spec: StyleSpec) {
  const font = {
    family: 'Inter',
    weight: 800,
    size: 72,
    letterSpacing: 0,
    textTransform: 'uppercase' as const,
    ...spec.font,
  };
  const color = {
    fill: '#ffffff',
    stroke: '#000000',
    strokeWidth: 8,
    emphasisFill: '#ffe14b' as string | string[],
    ...spec.color,
  };
  const layout = {
    position: 'bottom' as const,
    safeMargin: 0.15,
    maxWordsPerLine: 4,
    align: 'center' as const,
    borderRadius: 16,
    gapRatio: 0.25,
    ...spec.layout,
  };
  const padding = { x: 24, y: 12, ...spec.layout?.padding };
  const anim = {
    preset: 'pop' as const,
    durationMs: 120,
    emphasisScale: 1.15,
    scaleFrom: 0.6,
    activeBoost: 1.06,
    tailMs: 200,
    ...spec.animation,
  };
  const springCfg = {
    damping: 12,
    stiffness: 200,
    mass: 0.6,
    ...spec.animation?.spring,
  };
  return {
    font,
    color,
    layout,
    padding,
    anim,
    springCfg,
    emphasisPalette: toPalette(color.emphasisFill, '#ffe14b'),
    gradientImage: color.fillGradient ? buildGradientImage(color.fillGradient) : undefined,
    textShadow: buildTextShadow(color.shadow),
    variationSettings: buildVariationSettings(font.variableAxes),
  };
}

type Props = {
  transcript: Transcript;
  captionPlan: CaptionPlan | null;
  faces: FaceData | null;
  styleSpec: StyleSpec;
};

export const CaptionLayer: React.FC<Props> = ({ transcript, captionPlan, faces, styleSpec }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;

  const baseResolved = resolveStyle(styleSpec);

  const chunks: CaptionChunk[] = captionPlan
    ? captionPlan.chunks
    : fallbackChunks(transcript.words, baseResolved.layout.maxWordsPerLine);

  const tailSec = baseResolved.anim.tailMs / 1000;
  const activeChunkIdx = chunks.findIndex(
    (c) =>
      c.words.length > 0 &&
      t >= c.words[0]!.start &&
      t <= c.words[c.words.length - 1]!.end + tailSec,
  );
  const activeChunk = activeChunkIdx >= 0 ? chunks[activeChunkIdx]! : null;

  const chunkSpec =
    activeChunkIdx >= 0
      ? (resolveChunkStyle(
          activeChunkIdx,
          styleSpec as Record<string, unknown>,
          styleSpec.chunkOverrides,
        ) as StyleSpec)
      : styleSpec;
  const r = resolveStyle(chunkSpec);

  const chunkEmphasisColor =
    activeChunkIdx >= 0
      ? r.emphasisPalette[activeChunkIdx % r.emphasisPalette.length]!
      : r.color.fill;

  const position = effectivePosition(faces, t, r.layout.position);

  const positionStyle: React.CSSProperties =
    position === 'top'
      ? { top: `${r.layout.safeMargin * 100}%` }
      : position === 'middle'
        ? { top: '50%', transform: 'translateY(-50%)' }
        : { bottom: `${r.layout.safeMargin * 100}%` };

  const justify =
    r.layout.align === 'left'
      ? 'flex-start'
      : r.layout.align === 'right'
        ? 'flex-end'
        : 'center';

  if (!activeChunk) return null;

  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        display: 'flex',
        justifyContent: justify,
        padding: '0 5%',
        ...positionStyle,
      }}
    >
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: `${r.font.size * r.layout.gapRatio}px`,
          justifyContent: 'center',
          maxWidth: '90%',
          backgroundColor: r.color.background ?? 'transparent',
          padding: r.color.background ? `${r.padding.y}px ${r.padding.x}px` : 0,
          borderRadius: r.layout.borderRadius,
        }}
      >
        {activeChunk.words.map((w, i) => {
          const isEmphasis = activeChunk.emphasis[i] ?? false;

          // Reserve flex-layout space for the word's peak transform-scale
          // overshoot. `transform: scale()` is visual-only — the flex row
          // still reserves the word's natural width, so a 1.15x emphasis
          // word visually bleeds ~7.5% of its width into each neighbor.
          // The chunk `gap` alone doesn't cover that for wider words.
          //
          // We approximate the rendered word width as
          //   length * fontSize * charAdvance
          // (sans-serif avg char advance ≈ 0.55). Applying half the
          // overshoot as marginInline on each side guarantees the flex
          // row pushes neighbors out of the way, independent of font
          // metrics specifics. Always size to the *peak* (emphasis +
          // activeBoost) so the reserved slot is stable — no layout
          // shift when the activeBoost kicks in mid-word.
          const peakScale =
            (isEmphasis ? r.anim.emphasisScale : 1) * r.anim.activeBoost;
          const estCharAdvance = 0.55;
          const estWordWidth = w.word.length * r.font.size * estCharAdvance;
          const overshootMarginPx = Math.max(0, (peakScale - 1) * estWordWidth) / 2;

          const anim = animateWord(r.anim.preset, {
            t,
            frame,
            fps,
            word: w,
            isEmphasis,
            chunkStart: activeChunk.words[0]!.start,
            fillColor: r.color.fill,
            emphasisColor: chunkEmphasisColor,
            scaleFrom: r.anim.scaleFrom,
            emphasisScale: r.anim.emphasisScale,
            activeBoost: r.anim.activeBoost,
            durationMs: r.anim.durationMs,
            spring: r.springCfg,
          });

          const useGradient = r.gradientImage && anim.color === r.color.fill;
          const gradientStyle: React.CSSProperties = useGradient
            ? {
                backgroundImage: r.gradientImage,
                backgroundClip: 'text',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                color: 'transparent',
              }
            : {
                color: anim.color,
              };

          return (
            <span
              key={i}
              style={{
                fontFamily: r.font.family,
                fontWeight: r.font.weight,
                fontSize: r.font.size,
                letterSpacing: r.font.letterSpacing,
                textTransform: r.font.textTransform,
                ...gradientStyle,
                WebkitTextStroke: `${r.color.strokeWidth}px ${r.color.stroke}`,
                paintOrder: 'stroke fill',
                transform: anim.transform,
                opacity: anim.opacity,
                display: 'inline-block',
                lineHeight: 1,
                textShadow: r.textShadow,
                fontVariationSettings: r.variationSettings,
                transition: 'color 80ms linear',
                marginInline: overshootMarginPx,
              }}
            >
              {w.word}
            </span>
          );
        })}
      </div>
    </div>
  );
};
