import React from 'react';
import {
  AbsoluteFill,
  OffthreadVideo,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { loadFont } from '@remotion/google-fonts/Inter';
import { effectivePosition, type FaceData } from '../lib/positioning';
import { animateWord } from '../lib/animationPresets';
import { resolveChunkStyle, type ChunkOverride } from '../lib/styleMerge';

loadFont('normal', {
  weights: ['900'],
  subsets: ['latin'],
});

type Word = { word: string; start: number; end: number; confidence: number };
type Transcript = { language: string; duration: number; words: Word[] };

type CaptionChunk = { words: Word[]; emphasis: boolean[] };
type CaptionPlan = { chunks: CaptionChunk[] };

type GradientStop = { pos: number; color: string };
type FillGradient = { type?: 'linear'; angle?: number; stops: GradientStop[] };
type Shadow = { color?: string; blurPx?: number; offsetX?: number; offsetY?: number };

type StyleSpec = {
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

type Props = {
  videoFile: string;
  videoMeta: { width: number; height: number; durationInFrames: number; fps: number };
  transcript: Transcript;
  captionPlan: CaptionPlan | null;
  faces: FaceData | null;
  styleSpec: StyleSpec;
};

type WordInfo = { isEmphasis: boolean; chunkIdx: number };
function buildWordInfo(plan: CaptionPlan | null): Map<number, WordInfo> {
  const map = new Map<number, WordInfo>();
  if (!plan) return map;
  for (let ci = 0; ci < plan.chunks.length; ci++) {
    const chunk = plan.chunks[ci]!;
    for (let wi = 0; wi < chunk.words.length; wi++) {
      map.set(chunk.words[wi]!.start, {
        isEmphasis: chunk.emphasis[wi] ?? false,
        chunkIdx: ci,
      });
    }
  }
  return map;
}

function findActiveWord(
  words: Word[],
  t: number,
  tailSec: number,
): Word | null {
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    const next = words[i + 1];
    const visibleUntil = next ? next.start - 0.02 : w.end + tailSec;
    if (t >= w.start && t <= visibleUntil) return w;
  }
  return null;
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

// Mirror of PopWords.resolveStyle, with SingleWord-specific defaults
// (different default weight, fit-clamp tuning, intro tail).
function resolveStyle(spec: StyleSpec) {
  const font = {
    family: 'Inter',
    weight: 900,
    size: 72,
    letterSpacing: -2,
    textTransform: 'uppercase' as const,
    ...spec.font,
  };
  const color = {
    fill: '#ffffff',
    stroke: '#000000',
    strokeWidth: 12,
    emphasisFill: '#ffe14b' as string | string[],
    ...spec.color,
  };
  const layout = {
    position: 'middle' as const,
    safeMargin: 0.2,
    borderRadius: 16,
    ...spec.layout,
  };
  const padding = { x: 24, y: 12, ...spec.layout?.padding };
  const singleWord = {
    sizeMultiplier: 2.4,
    fitMargin: 0.85,
    charAdvanceEst: 0.6,
    ...spec.layout?.singleWord,
  };
  const anim = {
    preset: 'pop' as const,
    durationMs: 150,
    emphasisScale: 1.15,
    scaleFrom: 0.6,
    activeBoost: 1.06,
    tailMs: 500,
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
    singleWord,
    anim,
    springCfg,
    emphasisPalette: toPalette(color.emphasisFill, '#ffe14b'),
    gradientImage: color.fillGradient ? buildGradientImage(color.fillGradient) : undefined,
    textShadow: buildTextShadow(color.shadow),
    variationSettings: buildVariationSettings(font.variableAxes),
  };
}

export const SingleWord: React.FC<Props> = ({
  videoFile,
  transcript,
  captionPlan,
  faces,
  styleSpec,
}) => {
  const frame = useCurrentFrame();
  const { fps, width: frameWidth } = useVideoConfig();
  const t = frame / fps;

  // Base style for chunk-independent concerns (fit-clamp across all
  // words, active-word lookup tail). We also use baseResolved.layout for
  // the face-position fallback since positioning isn't a per-chunk call.
  const baseResolved = resolveStyle(styleSpec);

  const effectivePreset = baseResolved.anim.preset === 'karaoke' ? 'pop' : baseResolved.anim.preset;

  // Fit-clamp uses the *longest word in the whole transcript* so the
  // render size is stable across the video — computed against the base
  // spec, not per-chunk, so a chunk override to font.size won't break
  // it. A more sophisticated implementation could recompute per-chunk
  // if any override touched font.size, but that's deferred.
  const longestWordChars = Math.max(
    1,
    ...transcript.words.map((w) => w.word.length),
  );
  const usableWidth = frameWidth * baseResolved.singleWord.fitMargin;
  const maxFitSize = usableWidth / (longestWordChars * baseResolved.singleWord.charAdvanceEst);

  const wordInfo = React.useMemo(() => buildWordInfo(captionPlan), [captionPlan]);

  const activeWord = findActiveWord(transcript.words, t, baseResolved.anim.tailMs / 1000);
  const wordMeta = activeWord ? wordInfo.get(activeWord.start) : undefined;
  const isEmphasis = wordMeta?.isEmphasis ?? false;
  const chunkIdx = wordMeta?.chunkIdx ?? 0;

  // Apply chunkOverrides matching the active word's chunk, then re-resolve.
  const chunkSpec = activeWord
    ? (resolveChunkStyle(chunkIdx, styleSpec as Record<string, unknown>, styleSpec.chunkOverrides) as StyleSpec)
    : styleSpec;
  const r = resolveStyle(chunkSpec);

  // renderSize uses the chunk's font.size but the transcript-wide fit cap.
  const renderSize = Math.min(r.font.size * r.singleWord.sizeMultiplier, maxFitSize);

  const chunkEmphasisColor = r.emphasisPalette[chunkIdx % r.emphasisPalette.length]!;

  const anim = activeWord
    ? animateWord(effectivePreset, {
        t,
        frame,
        fps,
        word: activeWord,
        isEmphasis,
        chunkStart: activeWord.start,
        fillColor: r.color.fill,
        emphasisColor: chunkEmphasisColor,
        scaleFrom: r.anim.scaleFrom,
        emphasisScale: r.anim.emphasisScale,
        activeBoost: r.anim.activeBoost,
        durationMs: r.anim.durationMs,
        spring: r.springCfg,
      })
    : null;

  const position = effectivePosition(faces, t, r.layout.position);

  const positionStyle: React.CSSProperties =
    position === 'top'
      ? { top: `${r.layout.safeMargin * 100}%` }
      : position === 'bottom'
        ? { bottom: `${r.layout.safeMargin * 100}%` }
        : { top: '50%', transform: 'translateY(-50%)' };

  const hasBackground = Boolean(r.color.background);

  const useGradient = r.gradientImage && anim && anim.color === r.color.fill;
  const fillStyle: React.CSSProperties = useGradient
    ? {
        backgroundImage: r.gradientImage,
        backgroundClip: 'text',
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        color: 'transparent',
      }
    : {
        color: anim?.color ?? r.color.fill,
      };

  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      {videoFile && (
        <OffthreadVideo
          src={videoFile.startsWith('http') ? videoFile : staticFile(videoFile)}
        />
      )}

      {activeWord && anim && (
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            display: 'flex',
            justifyContent: 'center',
            ...positionStyle,
          }}
        >
          <div
            style={{
              display: 'inline-flex',
              backgroundColor: hasBackground ? r.color.background : 'transparent',
              padding: hasBackground ? `${r.padding.y}px ${r.padding.x}px` : 0,
              borderRadius: hasBackground ? r.layout.borderRadius : 0,
            }}
          >
            <span
              style={{
                fontFamily: r.font.family,
                fontWeight: r.font.weight,
                fontSize: renderSize,
                letterSpacing: r.font.letterSpacing,
                textTransform: r.font.textTransform,
                ...fillStyle,
                WebkitTextStroke: `${r.color.strokeWidth}px ${r.color.stroke}`,
                paintOrder: 'stroke fill',
                transform: anim.transform,
                opacity: anim.opacity,
                display: 'inline-block',
                lineHeight: 1,
                textShadow: r.textShadow,
                fontVariationSettings: r.variationSettings,
              }}
            >
              {activeWord.word}
            </span>
          </div>
        </div>
      )}
    </AbsoluteFill>
  );
};
