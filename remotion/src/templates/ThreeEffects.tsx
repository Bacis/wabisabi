import React from 'react';
import {
  AbsoluteFill,
  OffthreadVideo,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { ThreeCanvas } from '@remotion/three';
import * as THREE from 'three';
import { effectivePosition, type FaceData } from '../lib/positioning';

// ---------------------------------------------------------------------------
// Types — copied inline from PopWords.tsx:19-80 so this experimental template
// is self-contained. We deliberately don't extract a shared module because
// that would require touching the existing templates.
// ---------------------------------------------------------------------------

type Word = { word: string; start: number; end: number; confidence: number };
type Transcript = { language: string; duration: number; words: Word[] };
type CaptionChunk = { words: Word[]; emphasis: boolean[] };
type CaptionPlan = { chunks: CaptionChunk[] };

type StyleSpec = {
  font?: {
    family?: string;
    weight?: number;
    size?: number;
    textTransform?: 'none' | 'uppercase' | 'lowercase';
  };
  color?: {
    fill?: string;
    stroke?: string;
    strokeWidth?: number;
    emphasisFill?: string | string[];
  };
  layout?: {
    position?: 'top' | 'middle' | 'bottom';
    safeMargin?: number;
    maxWordsPerLine?: number;
  };
  animation?: {
    tailMs?: number;
  };
};

type Props = {
  videoFile: string;
  videoMeta: { width: number; height: number; durationInFrames: number; fps: number };
  transcript: Transcript;
  captionPlan: CaptionPlan | null;
  faces: FaceData | null;
  styleSpec: StyleSpec;
};

// ---------------------------------------------------------------------------
// Tunable constants.
// ---------------------------------------------------------------------------

const BURST_DURATION_SEC = 0.7;
const PARTICLES_PER_WORD = 24;
const POP_DURATION_SEC = 0.35;
const GRAVITY = -900; // px/s², negative because +y is up in our ortho camera

// ---------------------------------------------------------------------------
// Determinism helpers. Remotion renders frames in parallel across workers, so
// every pixel must be a pure function of frame + props. No Math.random, no
// useFrame, no useState/useEffect for animation state.
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFor(wordIdx: number, particleIdx: number): number {
  // Cantor pairing — deterministic, collision-free.
  const a = wordIdx + 1;
  const b = particleIdx + 1;
  return ((a + b) * (a + b + 1)) / 2 + b;
}

// Damped cosine pop: overshoots 1 then settles.
function popScale(age: number): number {
  if (age < 0) return 0;
  if (age > POP_DURATION_SEC * 3) return 1;
  return 1 + 0.6 * Math.exp(-6 * age) * Math.cos(14 * age);
}

// Small rotation + z wobble that decays over time.
function zOrbit(age: number, wordIdx: number): { rotZ: number; z: number } {
  const life = Math.max(0, age);
  const decay = Math.exp(-1.5 * life);
  const phase = wordIdx * 0.37;
  return {
    rotZ: 0.15 * decay * Math.sin(8 * life + phase),
    z: 20 * decay * Math.cos(6 * life + phase),
  };
}

// ---------------------------------------------------------------------------
// Chunking fallback — same as PopWords.tsx:82-89.
// ---------------------------------------------------------------------------

function fallbackChunks(words: Word[], maxPerLine: number): CaptionChunk[] {
  const out: CaptionChunk[] = [];
  for (let i = 0; i < words.length; i += maxPerLine) {
    const slice = words.slice(i, i + maxPerLine);
    out.push({ words: slice, emphasis: slice.map(() => false) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// WordMesh — renders a single word as a 3D plane textured with a 2D canvas
// drawing of the word. We deliberately don't use drei's <Text> (troika-three-
// text): its worker-based glyph parsing does not integrate with Remotion's
// delayRender / Suspense model, so CLI renders capture the frame before the
// text mesh is ready and it appears invisible. A CanvasTexture drawn with
// Chromium's built-in fonts is synchronous, deterministic, and needs no
// network or bundled font asset.
// ---------------------------------------------------------------------------

const DEFAULT_FONT_FAMILY = '"Arial Black", "Helvetica Neue", Impact, sans-serif';

function buildFontCss(
  fontSize: number,
  fontWeight: number,
  fontFamily: string,
): string {
  return `${fontWeight} ${fontSize}px ${fontFamily}`;
}

// A single shared offscreen canvas for text measurement. Creating a new
// canvas per measureText() call leaks DOM nodes.
let measureCanvas: HTMLCanvasElement | null = null;
function getMeasureCtx(): CanvasRenderingContext2D {
  if (!measureCanvas) measureCanvas = document.createElement('canvas');
  return measureCanvas.getContext('2d')!;
}

type WordStyle = {
  fontSize: number;
  fontWeight: number;
  fontFamily: string;
  fillColor: string;
  strokeColor: string;
  strokeWidth: number;
};

// Measure the full plane dimensions for a word — text width + padding for
// the outline stroke. Matches the canvas sizing used by drawWordCanvas so
// layout and drawing agree on the plane width.
function measureWordPlane(
  text: string,
  style: WordStyle,
): { width: number; height: number } {
  const ctx = getMeasureCtx();
  ctx.font = buildFontCss(style.fontSize, style.fontWeight, style.fontFamily);
  const metrics = ctx.measureText(text);
  const padX = style.strokeWidth + style.fontSize * 0.1;
  const padY = style.strokeWidth + style.fontSize * 0.25;
  return {
    width: Math.max(4, Math.ceil(metrics.width + padX * 2)),
    height: Math.max(4, Math.ceil(style.fontSize * 1.2 + padY * 2)),
  };
}

function drawWordCanvas(
  text: string,
  style: WordStyle,
): { canvas: HTMLCanvasElement; width: number; height: number } {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  const fontCss = buildFontCss(style.fontSize, style.fontWeight, style.fontFamily);
  const { width, height } = measureWordPlane(text, style);
  canvas.width = width;
  canvas.height = height;
  // Re-apply font after resize (canvas context resets on resize).
  ctx.font = fontCss;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  const cx = width / 2;
  const cy = height / 2;
  if (style.strokeWidth > 0) {
    ctx.strokeStyle = style.strokeColor;
    ctx.lineWidth = style.strokeWidth;
    ctx.strokeText(text, cx, cy);
  }
  ctx.fillStyle = style.fillColor;
  ctx.fillText(text, cx, cy);
  return { canvas, width, height };
}

const WordMesh: React.FC<{
  text: string;
  style: WordStyle;
}> = ({ text, style }) => {
  // Memoize per (text, style). The fill color flashes briefly at word
  // activation then settles — a handful of re-creations per word is trivial
  // and keeps the component deterministic per frame.
  const { texture, width, height } = React.useMemo(() => {
    const drawn = drawWordCanvas(text, style);
    const tex = new THREE.CanvasTexture(drawn.canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return { texture: tex, width: drawn.width, height: drawn.height };
  }, [
    text,
    style.fontSize,
    style.fontWeight,
    style.fontFamily,
    style.fillColor,
    style.strokeColor,
    style.strokeWidth,
  ]);

  return (
    <mesh>
      <planeGeometry args={[width, height]} />
      <meshBasicMaterial map={texture} transparent />
    </mesh>
  );
};

// ---------------------------------------------------------------------------
// Particle burst — deterministic, closed-form ballistic trajectories.
// ---------------------------------------------------------------------------

const ParticleBurst: React.FC<{
  wordIdx: number;
  age: number;
  fontSize: number;
  color: string;
}> = ({ wordIdx, age, fontSize, color }) => {
  if (age < 0 || age > BURST_DURATION_SEC) return null;
  const lifeT = age / BURST_DURATION_SEC;
  const opacity = 1 - lifeT;

  const particles: React.ReactNode[] = [];
  for (let i = 0; i < PARTICLES_PER_WORD; i++) {
    const rng = mulberry32(seedFor(wordIdx, i));
    const angle = rng() * Math.PI * 2;
    const speed = 200 + rng() * 400; // px/s
    const vx = Math.cos(angle) * speed;
    const vy = Math.sin(angle) * speed + 300; // upward bias
    const size = fontSize * (0.05 + rng() * 0.08);

    const px = vx * age;
    const py = vy * age + 0.5 * GRAVITY * age * age;
    const pz = (rng() - 0.5) * 40;

    particles.push(
      <mesh key={i} position={[px, py, pz]}>
        <sphereGeometry args={[size, 8, 8]} />
        <meshBasicMaterial color={color} transparent opacity={opacity} />
      </mesh>,
    );
  }
  return <>{particles}</>;
};

// ---------------------------------------------------------------------------
// Main template.
// ---------------------------------------------------------------------------

export const ThreeEffects: React.FC<Props> = ({
  videoFile,
  transcript,
  captionPlan,
  faces,
  styleSpec,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = frame / fps;

  // Active-chunk detection — identical math to PopWords.tsx:200-207.
  const maxPerLine = styleSpec?.layout?.maxWordsPerLine ?? 4;
  const tailSec = (styleSpec?.animation?.tailMs ?? 200) / 1000;
  const chunks = captionPlan
    ? captionPlan.chunks
    : fallbackChunks(transcript.words, maxPerLine);

  const activeChunkIdx = chunks.findIndex(
    (c) =>
      c.words.length > 0 &&
      t >= c.words[0]!.start &&
      t <= c.words[c.words.length - 1]!.end + tailSec,
  );
  const activeChunk = activeChunkIdx >= 0 ? chunks[activeChunkIdx]! : null;

  // Face-aware vertical placement → pixel y (origin center, +y up).
  const preferred = styleSpec?.layout?.position ?? 'bottom';
  const safeMargin = styleSpec?.layout?.safeMargin ?? 0.15;
  const position = effectivePosition(faces, t, preferred);
  const bandPixelY =
    position === 'top'
      ? height / 2 - safeMargin * height
      : position === 'middle'
        ? 0
        : -height / 2 + safeMargin * height;

  // Resolve all the StyleSpec fields the template honors. Most other
  // StyleSpec knobs (gradient, shadow, padding, animation preset, spring) are
  // intentionally ignored — this template's look is driven by particle
  // bursts + spring-pop, not by CSS-style typography tricks.
  const fontSize = styleSpec?.font?.size ?? 64;
  const fontWeight = styleSpec?.font?.weight ?? 900;
  const fontFamily = styleSpec?.font?.family
    ? `"${styleSpec.font.family}", ${DEFAULT_FONT_FAMILY}`
    : DEFAULT_FONT_FAMILY;
  // CanvasRenderingContext2D ignores CSS textTransform — apply manually.
  const textTransform = styleSpec?.font?.textTransform ?? 'none';
  const transformText = (s: string): string =>
    textTransform === 'uppercase'
      ? s.toUpperCase()
      : textTransform === 'lowercase'
        ? s.toLowerCase()
        : s;
  const fill = styleSpec?.color?.fill ?? '#ffffff';
  const strokeColor = styleSpec?.color?.stroke ?? '#000000';
  // styleSpec.color.strokeWidth is in CSS-stroke pixels which roughly match
  // canvas line width — use it as-is, defaulting to a fontSize-relative value
  // if omitted so the look stays bold without configuration.
  const strokeWidth = styleSpec?.color?.strokeWidth ?? Math.round(fontSize * 0.18);
  const emphasisSrc = styleSpec?.color?.emphasisFill;
  const emphasisPalette: string[] = Array.isArray(emphasisSrc)
    ? emphasisSrc.length > 0
      ? emphasisSrc
      : ['#ffe14b']
    : [(emphasisSrc as string | undefined) ?? '#ffe14b'];
  const chunkEmphasis =
    activeChunkIdx >= 0
      ? emphasisPalette[activeChunkIdx % emphasisPalette.length]!
      : emphasisPalette[0]!;

  // Build a base WordStyle for layout-pass measurement. Per-word fillColor
  // is overridden in the render loop below for the emphasis flash.
  const baseStyle: WordStyle = {
    fontSize,
    fontWeight,
    fontFamily,
    fillColor: fill,
    strokeColor,
    strokeWidth,
  };

  // Horizontal word placement — measure each word's real rendered plane
  // width using the same canvas font used by WordMesh, then center the row.
  // If the natural chunk total exceeds ~90% of the canvas width, shrink the
  // whole chunk uniformly so nothing clips at the edges.
  const gap = fontSize * 0.35;
  const chunkMaxWidth = width * 0.9;

  type Placed = { word: Word; displayText: string; x: number };
  const placed: Placed[] = [];
  let chunkScale = 1;
  if (activeChunk) {
    const widths = activeChunk.words.map(
      (w) => measureWordPlane(transformText(w.word), baseStyle).width,
    );
    const total = widths.reduce((a, b) => a + b + gap, -gap);
    if (total > chunkMaxWidth) {
      chunkScale = chunkMaxWidth / total;
    }
    let cursor = -total / 2;
    for (let i = 0; i < activeChunk.words.length; i++) {
      const w = activeChunk.words[i]!;
      const ww = widths[i]!;
      placed.push({ word: w, displayText: transformText(w.word), x: cursor + ww / 2 });
      cursor += ww + gap;
    }
  }

  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      {videoFile && (
        <OffthreadVideo
          src={videoFile.startsWith('http') ? videoFile : staticFile(videoFile)}
        />
      )}
      <AbsoluteFill>
        <ThreeCanvas
          width={width}
          height={height}
          orthographic
          camera={{ position: [0, 0, 1000], zoom: 1, near: 0.1, far: 5000 }}
          style={{ position: 'absolute', inset: 0, background: 'transparent' }}
          gl={{ alpha: true, antialias: true, preserveDrawingBuffer: true }}
        >
          {/* meshBasicMaterial is unlit — no ambientLight needed. */}
          {activeChunk && (
            <group position={[0, bandPixelY, 0]} scale={chunkScale}>
              {placed.map((p, i) => {
                const age = t - p.word.start;
                const scale = popScale(age);
                const { rotZ, z } = zOrbit(age, i);
                const isEmphasis = activeChunk.emphasis[i] ?? false;
                // Words flagged for emphasis stay in the chunk emphasis
                // color the whole time. Non-emphasis words flash emphasis
                // for the first 0.25s of activation then settle to fill.
                const wordColor = isEmphasis
                  ? chunkEmphasis
                  : age >= 0 && age < 0.25
                    ? chunkEmphasis
                    : fill;
                const wordStyle: WordStyle = {
                  ...baseStyle,
                  fillColor: wordColor,
                };
                return (
                  <group
                    key={`${activeChunkIdx}-${i}`}
                    position={[p.x, 0, z]}
                    rotation={[0, 0, rotZ]}
                    scale={scale}
                  >
                    <WordMesh text={p.displayText} style={wordStyle} />
                    <ParticleBurst
                      wordIdx={activeChunkIdx * 1000 + i}
                      age={age}
                      fontSize={fontSize}
                      color={chunkEmphasis}
                    />
                  </group>
                );
              })}
            </group>
          )}
        </ThreeCanvas>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
