import React from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';
import { effectivePosition, type FaceData } from './positioning';
import {
  evalEnter,
  getSpec,
  peakScale,
  type AnimPreset,
  type RenderFrame,
} from './animationPresets';
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
  // Top-level visibility. 'hidden' suppresses the whole layer for this
  // chunk after chunkOverrides merge — set globally + override 'visible'
  // on key chunks for the hide-everything-except-X pattern.
  visibility?: 'visible' | 'hidden';
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
    preset?: AnimPreset;
    // Legacy tunables. The new spec-driven runtime ignores these; reel-clone
    // and stylepack code still reads them for bespoke spring animations.
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
    preset: 'per-word-crossfade' as AnimPreset,
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
  const { fps, width: frameWidth, height: frameHeight } = useVideoConfig();
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

  // Caption visibility (post chunk-override merge). When 'hidden', this
  // chunk renders nothing — the global hide + per-chunk visible override
  // pattern lets users say "hide everything except these three groups".
  if (chunkSpec.visibility === 'hidden') return null;

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

  // Fast-speech adaptive clamp: cap the per-word entry animation at ~35% of
  // the active chunk's on-screen time. Matches the clamp in ReelClone so
  // PopWords / SingleWord / CaptionDesigner all respect the same fast-speech
  // budget. Preset durations are a CEILING, never extended.
  const chunkOnScreenSec =
    activeChunk.words.length > 0
      ? activeChunk.words[activeChunk.words.length - 1]!.end +
        tailSec -
        activeChunk.words[0]!.start
      : 0;
  const maxEntryDurSec = Math.max(0.04, chunkOnScreenSec * 0.35);

  // Optional editor-controlled bounding box. When set, position the
  // caption container at this transform instead of using positionStyle's
  // top/bottom anchor.
  const captionTransform: { x: number; y: number; w: number; h: number; rot: number } | null =
    (styleSpec as Record<string, any>).captionTransform ?? null;

  return (
    <div
      data-caption-container
      style={
        captionTransform
          ? {
              position: 'absolute',
              // Frame dims come from useVideoConfig (set by
              // calculateMetadata from props.videoMeta) so horizontal
              // sources position captions against the actual canvas
              // instead of the legacy 1080×1920 baseline.
              left: `${(captionTransform.x / frameWidth) * 100}%`,
              top: `${(captionTransform.y / frameHeight) * 100}%`,
              width: `${(captionTransform.w / frameWidth) * 100}%`,
              height: `${(captionTransform.h / frameHeight) * 100}%`,
              transform: `rotate(${captionTransform.rot}deg)`,
              transformOrigin: 'center',
              display: 'flex',
              alignItems: 'center',
              justifyContent: justify,
              padding: '0 5%',
            }
          : {
              position: 'absolute',
              left: 0,
              right: 0,
              display: 'flex',
              justifyContent: justify,
              padding: '0 5%',
              ...positionStyle,
            }
      }
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
        {(() => {
          const spec = getSpec(r.anim.preset);
          const peak = peakScale(spec);
          const usesScale = peak > 1.001;
          const isPerChar = spec.target === 'per-character';
          const isWhole = spec.target === 'whole' || spec.target === 'per-line';
          const wholeAnchor = activeChunk.words[0]!.start;
          const charStaggerSec = spec.enter.stagger_ms / 1000;

          return activeChunk.words.map((w, i) => {
            const isEmphasis = activeChunk.emphasis[i] ?? false;
            const color = isEmphasis ? chunkEmphasisColor : r.color.fill;

            // Overshoot reservation — only relevant for scale-using specs.
            // Approximate rendered word width as length × fontSize × 0.55
            // (sans-serif avg char advance); reserve half the overshoot
            // as marginInline on each side so flex neighbors stay out of
            // the way independent of font metrics.
            const estWordWidth = w.word.length * r.font.size * 0.55;
            const overshootMarginPx = usesScale
              ? Math.max(0, (peak - 1) * estWordWidth) / 2
              : 0;

            const useGradient = !!r.gradientImage && color === r.color.fill;
            const colorStyle: React.CSSProperties = useGradient
              ? {
                  backgroundImage: r.gradientImage,
                  backgroundClip: 'text',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  color: 'transparent',
                }
              : { color };

            const leafFontStyle: React.CSSProperties = {
              fontFamily: r.font.family,
              fontWeight: r.font.weight,
              fontSize: r.font.size,
              letterSpacing: r.font.letterSpacing,
              textTransform: r.font.textTransform,
              ...colorStyle,
              WebkitTextStroke: `${r.color.strokeWidth}px ${r.color.stroke}`,
              paintOrder: 'stroke fill',
              lineHeight: 1,
              textShadow: r.textShadow,
              fontVariationSettings: r.variationSettings,
              transition: 'color 80ms linear',
            };

            if (isPerChar) {
              const chars = [...w.word];
              return (
                <span
                  key={i}
                  style={{
                    display: 'inline-flex',
                    whiteSpace: 'nowrap',
                    lineHeight: 1,
                    marginInline: overshootMarginPx,
                  }}
                >
                  {chars.map((ch, ci) => {
                    const anchor = w.start + ci * charStaggerSec;
                    const f: RenderFrame = evalEnter(spec, t, anchor, maxEntryDurSec);
                    return (
                      <span
                        key={ci}
                        style={{
                          ...leafFontStyle,
                          display: 'inline-block',
                          transform: f.transform,
                          opacity: f.opacity,
                          filter: f.filter,
                        }}
                      >
                        {ch === ' ' ? ' ' : ch}
                      </span>
                    );
                  })}
                </span>
              );
            }

            const anchor = isWhole ? wholeAnchor : w.start;
            const f: RenderFrame = evalEnter(spec, t, anchor, maxEntryDurSec);
            return (
              <span
                key={i}
                style={{
                  ...leafFontStyle,
                  display: 'inline-block',
                  transform: f.transform,
                  opacity: f.opacity,
                  filter: f.filter,
                  marginInline: overshootMarginPx,
                }}
              >
                {w.word}
              </span>
            );
          });
        })()}
      </div>
    </div>
  );
};
