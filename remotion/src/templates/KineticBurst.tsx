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
// KineticBurst — a maximalist showcase template demonstrating what the
// react-three-fiber + Remotion integration can do. Six layered effects:
//
//   1. Bezier entry arcs (quadratic, ease-out cubic, randomized per word)
//   2. Lock wobble (spring overshoot when the word lands)
//   3. Ghost trails (6 fading copies behind the moving word)
//   4. Bloom halo (additive-blended stacked copies for emphasis words)
//   5. Orbital particle rings (16 spheres slowly circling settled words)
//   6. Star field backdrop (80 twinkling spheres at varied depths)
//
// All animation is a pure function of frame for Remotion determinism — no
// useFrame-driven mutation, no useState/useEffect for animation state, no
// unseeded randomness. Particle and star positions come from a mulberry32
// PRNG seeded by stable indices, so every render of frame N is identical.
//
// Self-contained on purpose: types and helpers are inlined rather than
// extracted to a shared module so this template can be deleted or rewritten
// without touching anything else.
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
// Tunable constants. Tweaking these is the safest way to iterate on the
// look — every visual moment in the template falls out of these numbers.
// ---------------------------------------------------------------------------

const ENTRY_DURATION_SEC = 0.45;
const LOCK_DURATION_SEC = 0.15;
const SETTLED_TAIL_SEC = 0.4; // how long after end the word lingers
const TRAIL_GHOST_COUNT = 6;
const TRAIL_GHOST_OFFSET_SEC = 0.04;
const ORBIT_PARTICLE_COUNT = 16;
const ORBIT_RADIUS_RATIO = 0.65; // orbit radius vs half word width
const STAR_COUNT = 80;
const POP_OVERSHOOT = 1.18;
const BLOOM_LAYERS = 3;

// ---------------------------------------------------------------------------
// Determinism helpers — same pattern as ThreeEffects.tsx. Frames may render
// in parallel across workers, so every per-particle / per-star value must be
// derived from a stable seed, never Math.random().
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

function seedFor(a: number, b: number): number {
  // Cantor pairing — collision-free, deterministic.
  const x = a + 1;
  const y = b + 1;
  return ((x + y) * (x + y + 1)) / 2 + y;
}

// ---------------------------------------------------------------------------
// Easing + curves.
// ---------------------------------------------------------------------------

function easeOutCubic(t: number): number {
  const c = 1 - t;
  return 1 - c * c * c;
}

// Quadratic Bezier in 2D.
function bezier2(
  p0x: number,
  p0y: number,
  p1x: number,
  p1y: number,
  p2x: number,
  p2y: number,
  t: number,
): { x: number; y: number } {
  const u = 1 - t;
  return {
    x: u * u * p0x + 2 * u * t * p1x + t * t * p2x,
    y: u * u * p0y + 2 * u * t * p1y + t * t * p2y,
  };
}

// ---------------------------------------------------------------------------
// Per-word entry path. Each word picks a deterministic random start point on
// the edge of a "launch ring" around its final position, plus a perpendicular
// curvature offset for its bezier control point. The seed is just the global
// word index, so adjacent words tend to come from different directions.
// ---------------------------------------------------------------------------

type EntryPath = {
  startX: number;
  startY: number;
  cpX: number;
  cpY: number;
  startRotation: number;
};

function computeEntryPath(
  globalWordIdx: number,
  finalX: number,
  finalY: number,
  screenWidth: number,
  screenHeight: number,
): EntryPath {
  const rng = mulberry32(seedFor(globalWordIdx, 7919));
  const angle = rng() * Math.PI * 2;
  const distance = Math.max(screenWidth, screenHeight) * 0.55;
  const startX = finalX + Math.cos(angle) * distance;
  const startY = finalY + Math.sin(angle) * distance;

  // Control point: midpoint of the line, offset perpendicular by a
  // randomized fraction of the segment length. The perpendicular direction
  // has two valid orientations; the rng sign picks one.
  const midX = (startX + finalX) / 2;
  const midY = (startY + finalY) / 2;
  const dx = finalX - startX;
  const dy = finalY - startY;
  const segLen = Math.hypot(dx, dy) || 1;
  const perpX = -dy / segLen;
  const perpY = dx / segLen;
  const curvature = (rng() - 0.5) * 0.5 * segLen;
  const cpX = midX + perpX * curvature;
  const cpY = midY + perpY * curvature;

  // Random initial rotation in [-π, π], unwound to 0 by lock time.
  const startRotation = (rng() - 0.5) * 2 * Math.PI;

  return { startX, startY, cpX, cpY, startRotation };
}

// ---------------------------------------------------------------------------
// Per-word transform at a given age. Returns world-space (x, y, rotZ, scale,
// opacity). All three phases (entry, lock, settled) flow through here.
// ---------------------------------------------------------------------------

type WordTransform = {
  x: number;
  y: number;
  rotZ: number;
  scale: number;
  opacity: number;
};

function computeWordTransform(
  age: number,
  finalX: number,
  finalY: number,
  path: EntryPath,
): WordTransform {
  if (age < 0) {
    return { x: finalX, y: finalY, rotZ: 0, scale: 0, opacity: 0 };
  }

  if (age < ENTRY_DURATION_SEC) {
    // Entry arc: bezier path with eased progress.
    const linearT = age / ENTRY_DURATION_SEC;
    const t = easeOutCubic(linearT);
    const pos = bezier2(path.startX, path.startY, path.cpX, path.cpY, finalX, finalY, t);
    return {
      x: pos.x,
      y: pos.y,
      rotZ: path.startRotation * (1 - t),
      // Scale eases up from 0.4 to 1.0 over the arc — small at the start so
      // ghost trails don't look like a wall of text.
      scale: 0.4 + 0.6 * t,
      opacity: Math.min(1, t * 1.4),
    };
  }

  const lockEnd = ENTRY_DURATION_SEC + LOCK_DURATION_SEC;
  if (age < lockEnd) {
    // Lock wobble: spring overshoot then damp.
    const wobbleT = (age - ENTRY_DURATION_SEC) / LOCK_DURATION_SEC;
    const overshoot =
      1 + (POP_OVERSHOOT - 1) * Math.exp(-6 * wobbleT) * Math.cos(20 * wobbleT);
    return {
      x: finalX,
      y: finalY,
      rotZ: 0,
      scale: overshoot,
      opacity: 1,
    };
  }

  // Settled — gentle bob and sway so the words never look frozen.
  const settledAge = age - lockEnd;
  const bob = Math.sin(settledAge * 1.8 + path.startRotation) * 4;
  const sway = Math.sin(settledAge * 1.2 + path.startRotation * 1.7) * 0.02;
  return {
    x: finalX,
    y: finalY + bob,
    rotZ: sway,
    scale: 1,
    opacity: 1,
  };
}

// ---------------------------------------------------------------------------
// Canvas-drawn word texture. Same approach as ThreeEffects — drei <Text> /
// troika-three-text doesn't render in Remotion's headless Chromium because
// its async glyph parsing doesn't integrate with delayRender. A 2D canvas
// drawn with Chromium's built-in fonts is synchronous, deterministic, and
// needs no font asset.
// ---------------------------------------------------------------------------

const DEFAULT_FONT_FAMILY = '"Arial Black", "Helvetica Neue", Impact, sans-serif';

function buildFontCss(fontSize: number, fontWeight: number, fontFamily: string): string {
  return `${fontWeight} ${fontSize}px ${fontFamily}`;
}

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

function measureWordPlane(text: string, style: WordStyle): { width: number; height: number } {
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

// useWordTexture creates a CanvasTexture once per (text, style) and returns
// it alongside the plane dimensions. Decoupled from <mesh> rendering so the
// same texture can be reused for the main word, ghost trails, and bloom
// halos without re-drawing the canvas multiple times.
function useWordTexture(text: string, style: WordStyle) {
  return React.useMemo(() => {
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
}

// ---------------------------------------------------------------------------
// Star field backdrop. Deterministic point cloud, twinkling sinusoidally.
// ---------------------------------------------------------------------------

const StarField: React.FC<{ t: number; width: number; height: number }> = ({
  t,
  width,
  height,
}) => {
  const stars = React.useMemo(() => {
    const out: { x: number; y: number; z: number; size: number; phase: number }[] = [];
    const rng = mulberry32(0xfeed);
    for (let i = 0; i < STAR_COUNT; i++) {
      out.push({
        x: (rng() - 0.5) * width * 1.1,
        y: (rng() - 0.5) * height * 1.1,
        z: -200 - rng() * 600, // behind the words
        size: 1 + rng() * 3,
        phase: rng() * Math.PI * 2,
      });
    }
    return out;
  }, [width, height]);

  return (
    <>
      {stars.map((s, i) => {
        const opacity = 0.25 + 0.5 * (0.5 + 0.5 * Math.sin(t * 1.5 + s.phase));
        return (
          <mesh key={i} position={[s.x, s.y, s.z]}>
            <sphereGeometry args={[s.size, 6, 6]} />
            <meshBasicMaterial color="#bdd7ff" transparent opacity={opacity} />
          </mesh>
        );
      })}
    </>
  );
};

// ---------------------------------------------------------------------------
// Orbital particle ring around a settled word.
// ---------------------------------------------------------------------------

const OrbitRing: React.FC<{
  t: number;
  age: number;
  radius: number;
  color: string;
  wordIdx: number;
}> = ({ t, age, radius, color, wordIdx }) => {
  // Don't draw the ring until the word has finished its lock wobble.
  const visibleStart = ENTRY_DURATION_SEC + LOCK_DURATION_SEC;
  if (age < visibleStart) return null;
  const settledAge = age - visibleStart;
  // Fade in over 0.2s.
  const fadeIn = Math.min(1, settledAge / 0.2);

  const particles: React.ReactNode[] = [];
  for (let i = 0; i < ORBIT_PARTICLE_COUNT; i++) {
    const baseAngle = (i / ORBIT_PARTICLE_COUNT) * Math.PI * 2;
    const rotation = settledAge * 1.4; // slow spin
    const angle = baseAngle + rotation + wordIdx * 0.2;
    // Tilt the ring slightly so it reads as 3D rather than flat.
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius * 0.35; // squashed
    const z = Math.sin(angle * 2) * 12;
    // Brighter at the front of the ring.
    const front = (Math.sin(angle * 2) + 1) / 2;
    const opacity = fadeIn * (0.4 + 0.5 * front);
    const size = 2 + 1.5 * front;
    particles.push(
      <mesh key={i} position={[x, y, z]}>
        <sphereGeometry args={[size, 8, 8]} />
        <meshBasicMaterial color={color} transparent opacity={opacity} />
      </mesh>,
    );
  }
  return <>{particles}</>;
};

// ---------------------------------------------------------------------------
// Bloom halo: stacked additively-blended copies of the same word texture at
// slightly larger scales with decreasing opacity. Fakes a postprocessing
// glow without needing the EffectComposer (which is heavier and a pain to
// integrate with Remotion's frame-by-frame render).
// ---------------------------------------------------------------------------

const BloomHalo: React.FC<{
  texture: THREE.Texture;
  width: number;
  height: number;
}> = ({ texture, width, height }) => {
  const layers: React.ReactNode[] = [];
  for (let i = 1; i <= BLOOM_LAYERS; i++) {
    const scale = 1 + i * 0.12;
    const opacity = 0.35 / i;
    layers.push(
      <mesh key={i} position={[0, 0, -1]} scale={[scale, scale, 1]}>
        <planeGeometry args={[width, height]} />
        <meshBasicMaterial
          map={texture}
          transparent
          opacity={opacity}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>,
    );
  }
  return <>{layers}</>;
};

// ---------------------------------------------------------------------------
// Word body: the main word plane plus its ghost trails and (optional) bloom
// halo. The trails sample previous-time positions of the same word so they
// follow the bezier arc behind the leading copy.
// ---------------------------------------------------------------------------

const WordBody: React.FC<{
  text: string;
  style: WordStyle;
  age: number;
  finalX: number;
  finalY: number;
  path: EntryPath;
  isEmphasis: boolean;
}> = ({ text, style, age, finalX, finalY, path, isEmphasis }) => {
  const { texture, width, height } = useWordTexture(text, style);

  const main = computeWordTransform(age, finalX, finalY, path);

  // Ghost trails — render at progressively earlier `age` values so they
  // trace the path the leading copy just took. Skip when the word is not
  // visible at all (age < 0) and once the word has fully locked (age past
  // entry phase) so they don't pile up on the static word.
  const trails: React.ReactNode[] = [];
  if (age >= 0 && age < ENTRY_DURATION_SEC + 0.1) {
    for (let i = 1; i <= TRAIL_GHOST_COUNT; i++) {
      const ghostAge = age - i * TRAIL_GHOST_OFFSET_SEC;
      if (ghostAge < 0) continue;
      const g = computeWordTransform(ghostAge, finalX, finalY, path);
      const ghostFade = (1 - i / (TRAIL_GHOST_COUNT + 1)) * 0.35;
      trails.push(
        <mesh
          key={`trail-${i}`}
          position={[g.x, g.y, -2 * i]}
          rotation={[0, 0, g.rotZ]}
          scale={[g.scale, g.scale, 1]}
        >
          <planeGeometry args={[width, height]} />
          <meshBasicMaterial
            map={texture}
            transparent
            opacity={g.opacity * ghostFade}
            depthWrite={false}
          />
        </mesh>,
      );
    }
  }

  return (
    <>
      {trails}
      <group
        position={[main.x, main.y, 0]}
        rotation={[0, 0, main.rotZ]}
        scale={[main.scale, main.scale, 1]}
      >
        {isEmphasis && <BloomHalo texture={texture} width={width} height={height} />}
        <mesh>
          <planeGeometry args={[width, height]} />
          <meshBasicMaterial map={texture} transparent opacity={main.opacity} />
        </mesh>
      </group>
    </>
  );
};

// ---------------------------------------------------------------------------
// Chunking fallback — same shape as PopWords / ThreeEffects.
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
// Main template.
// ---------------------------------------------------------------------------

export const KineticBurst: React.FC<Props> = ({
  videoFile,
  transcript,
  captionPlan,
  faces,
  styleSpec,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = frame / fps;

  const maxPerLine = styleSpec?.layout?.maxWordsPerLine ?? 4;
  const tailSec = (styleSpec?.animation?.tailMs ?? 250) / 1000 + SETTLED_TAIL_SEC;
  const chunks = captionPlan
    ? captionPlan.chunks
    : fallbackChunks(transcript.words, maxPerLine);

  // Active-chunk detection — same as ThreeEffects, but the visible window
  // is extended by SETTLED_TAIL_SEC so the kinetic settled state has time
  // to read.
  const activeChunkIdx = chunks.findIndex(
    (c) =>
      c.words.length > 0 &&
      t >= c.words[0]!.start &&
      t <= c.words[c.words.length - 1]!.end + tailSec,
  );
  const activeChunk = activeChunkIdx >= 0 ? chunks[activeChunkIdx]! : null;

  // Style fields the template honors. Same set as ThreeEffects so the
  // existing presets and LLM output flow through unchanged.
  const fontSize = styleSpec?.font?.size ?? 64;
  const fontWeight = styleSpec?.font?.weight ?? 900;
  const fontFamily = styleSpec?.font?.family
    ? `"${styleSpec.font.family}", ${DEFAULT_FONT_FAMILY}`
    : DEFAULT_FONT_FAMILY;
  const textTransform = styleSpec?.font?.textTransform ?? 'none';
  const transformText = (s: string): string =>
    textTransform === 'uppercase'
      ? s.toUpperCase()
      : textTransform === 'lowercase'
        ? s.toLowerCase()
        : s;

  const fill = styleSpec?.color?.fill ?? '#ffffff';
  const strokeColor = styleSpec?.color?.stroke ?? '#000000';
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

  const baseStyle: WordStyle = {
    fontSize,
    fontWeight,
    fontFamily,
    fillColor: fill,
    strokeColor,
    strokeWidth,
  };

  // Face-aware vertical band — pixel y, origin at center, +y up.
  const preferred = styleSpec?.layout?.position ?? 'bottom';
  const safeMargin = styleSpec?.layout?.safeMargin ?? 0.2;
  const position = effectivePosition(faces, t, preferred);
  const bandPixelY =
    position === 'top'
      ? height / 2 - safeMargin * height
      : position === 'middle'
        ? 0
        : -height / 2 + safeMargin * height;

  // Layout pass — measure each word's transformed text plane width, lay out
  // a centered row, shrink-to-fit if the row would clip the canvas.
  const gap = fontSize * 0.4;
  const chunkMaxWidth = width * 0.88;

  type Placed = {
    word: Word;
    displayText: string;
    x: number;
    width: number;
    isEmphasis: boolean;
    globalIdx: number;
  };
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
      placed.push({
        word: w,
        displayText: transformText(w.word),
        x: cursor + ww / 2,
        width: ww,
        // Stable global index so the per-word entry path is reproducible
        // across the whole composition (not just within a chunk).
        globalIdx: activeChunkIdx * 1000 + i,
        isEmphasis: activeChunk.emphasis[i] ?? false,
      });
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
          camera={{ position: [0, 0, 1500], zoom: 1, near: 0.1, far: 6000 }}
          style={{ position: 'absolute', inset: 0, background: 'transparent' }}
          gl={{ alpha: true, antialias: true, preserveDrawingBuffer: true }}
        >
          <StarField t={t} width={width} height={height} />
          {activeChunk && (
            <group position={[0, bandPixelY, 0]} scale={chunkScale}>
              {placed.map((p) => {
                const age = t - p.word.start;
                const path = computeEntryPath(p.globalIdx, p.x, 0, width, height);
                // Style with the per-word fill (emphasis-flagged words use
                // the chunk emphasis color throughout; non-emphasis words
                // use the base fill).
                const wordStyle: WordStyle = {
                  ...baseStyle,
                  fillColor: p.isEmphasis ? chunkEmphasis : fill,
                };
                // Orbit ring color: always emphasis so it pops against the
                // word body even on non-emphasis words.
                const orbitRadius = (p.width / 2) * ORBIT_RADIUS_RATIO;
                return (
                  <group key={p.globalIdx}>
                    <WordBody
                      text={p.displayText}
                      style={wordStyle}
                      age={age}
                      finalX={p.x}
                      finalY={0}
                      path={path}
                      isEmphasis={p.isEmphasis}
                    />
                    <group position={[p.x, 0, 0]}>
                      <OrbitRing
                        t={t}
                        age={age}
                        radius={orbitRadius}
                        color={chunkEmphasis}
                        wordIdx={p.globalIdx}
                      />
                    </group>
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
