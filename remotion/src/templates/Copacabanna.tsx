import React from 'react';
import { AbsoluteFill, OffthreadVideo, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { loadFont } from '@remotion/google-fonts/Lobster';
import type { FaceData } from '../lib/positioning';
import type {
  CaptionPlan,
  Transcript,
  Word,
  CaptionChunk,
} from '../lib/CaptionLayer';

// Copacabanna — Brazilian samba-sway caption template.
// Forked from ReelClone's scaffolding (Props/captionPlan walk/active-chunk
// resolution/font loader/width-budget split) but the per-word aesthetic is
// rebuilt: every word — emphasis or not — is colored from a 5-stop tropical
// palette cycled by word-index, every word enters with a rotation tilt that
// settles via a slightly-overshooting spring (the "samba step"), emphasis
// words lock to flag-yellow at 1.25× and keep oscillating ±3° while on
// screen. No cascade, no anchor-block, no italic accent.
//
// StyleSpec fields read by this template:
//   font.family               — 'Lobster' (set by preset).
//   font.weight               — Lobster only ships at 400, so weight is
//                                effectively fixed; included for completeness.
//   font.size                 — nominal at 1080-wide; scaled by frameWidth/1080.
//   font.letterSpacing        — px tracking. 0 default for Lobster.
//   font.textTransform        — 'none' default; Lobster is a script and
//                                shouldn't be uppercased.
//   color.fill                — fallback color when palette is empty.
//   color.emphasisFill        — single hex applied to all emphasis words
//                                regardless of palette position (default flag-yellow).
//   color.palette             — string[] cycled per word in chunk. Required
//                                for the Copacabanna look — at least 1 color.
//                                (Read from styleSpec.color.palette OR
//                                styleSpec.reel.palette.)
//   layout.position           — 'top' | 'middle' | 'bottom'.
//   layout.safeMargin         — fraction (0–0.5) from frame edge.
//   layout.maxWordsPerLine    — logical line capacity.
//   layout.align              — 'left' | 'center' | 'right'.
//   animation.tailMs          — chunk persistence after last word ends.
//   animation.scaleFrom       — entry spring start scale.
//   animation.durationMs      — entry spring duration.
//   animation.spring.{damping,stiffness,mass} — spring physics.
//                                Default damping is intentionally light (8) so
//                                the entry overshoots slightly — the samba kick.
//   charAdvance               — empirical glyph-width / glyph-height ratio.
//                                Lobster runs wide → ~0.62 default.
//   reel.palette              — alias for color.palette (preset shape parity).
//   reel.tiltDegrees          — entry tilt in degrees. -8 = words enter
//                                rotated counter-clockwise, settle to 0°.
//   reel.swayAmplitudeDegrees — emphasis-word rotation amplitude (±N°).
//   reel.swayHz               — emphasis-word oscillation frequency in Hz.
//   reel.fillerOpacity        — opacity for filler words (0–1).
//   reel.emphasisSizeMultiplier — multiplier on baseSize for emphasis words.
//   reel.wordReveal           — 'progressive' | 'all'.
//   reel.inferEmphasis        — auto-mark emphasis if plan has none.
//   reel.columnGapRatio       — inter-word gap as fraction of baseSize.
//   reel.rowGapRatio          — inter-line gap as fraction of baseSize.
//   reel.maxWidthPercent      — usable width as % of frame.
//   reel.paddingPercent       — horizontal padding as % of frame.

loadFont('normal', {
  weights: ['400'],
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

const DEFAULT_PALETTE = [
  '#CA402A', // terracotta
  '#0E694F', // forest
  '#6EB453', // grass
  '#AED953', // lime
  '#FDFF55', // flag yellow
];

function normalize(word: string): string {
  return word.toLowerCase().replace(/[.,!?;:"'()—-]/g, '');
}

function isFiller(word: string): boolean {
  return FILLER_WORDS.has(normalize(word));
}

function inferEmphasisFlags(words: Word[]): boolean[] {
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

type Props = {
  videoFile: string;
  videoMeta: { width: number; height: number; durationInFrames: number; fps: number };
  transcript: Transcript;
  captionPlan: CaptionPlan | null;
  faces: FaceData | null;
  styleSpec: Record<string, any>;
};

export const Copacabanna: React.FC<Props> = ({
  videoFile,
  transcript,
  captionPlan,
  styleSpec,
}) => {
  const frame = useCurrentFrame();
  const { fps, width: frameWidth } = useVideoConfig();
  const t = frame / fps;

  const font = styleSpec.font ?? {};
  const color = styleSpec.color ?? {};
  const layout = styleSpec.layout ?? {};
  const anim = styleSpec.animation ?? {};
  const reel = styleSpec.reel ?? {};

  const fontFamily = font.family ?? 'Lobster';
  const nominalSize = font.size ?? 156;
  const baseSize = nominalSize * (frameWidth / 1080);
  const baseWeight = font.weight ?? 400;
  const baseLetterSpacing = font.letterSpacing ?? 0;
  const baseTextTransform = font.textTransform ?? 'none';

  const fillColor = color.fill ?? '#ffffff';
  const emphasisFill: string =
    typeof color.emphasisFill === 'string' ? color.emphasisFill : '#FDFF55';
  const palette: string[] = Array.isArray(color.palette) && color.palette.length > 0
    ? color.palette
    : Array.isArray(reel.palette) && reel.palette.length > 0
      ? reel.palette
      : DEFAULT_PALETTE;

  const maxPerLine = layout.maxWordsPerLine ?? 4;
  const position = layout.position ?? 'bottom';
  const safeMargin = layout.safeMargin ?? 0.2;
  const align = layout.align ?? 'center';

  const tailMs = anim.tailMs ?? 220;
  const scaleFrom = anim.scaleFrom ?? 0.85;
  // Light damping → spring overshoots a touch — the samba "kick".
  const springDamping = anim.spring?.damping ?? 8;
  const springStiffness = anim.spring?.stiffness ?? 180;
  const springMass = anim.spring?.mass ?? 0.5;
  const animDuration = anim.durationMs ?? 220;

  const tiltDegrees: number = typeof reel.tiltDegrees === 'number' ? reel.tiltDegrees : -8;
  const swayAmplitudeDegrees: number =
    typeof reel.swayAmplitudeDegrees === 'number' ? reel.swayAmplitudeDegrees : 3;
  const swayHz: number = typeof reel.swayHz === 'number' ? reel.swayHz : 0.8;
  const fillerOpacity: number =
    typeof reel.fillerOpacity === 'number' ? reel.fillerOpacity : 0.65;
  const emphasisSizeMultiplier: number =
    typeof reel.emphasisSizeMultiplier === 'number' ? reel.emphasisSizeMultiplier : 1.25;
  const wordReveal = reel.wordReveal ?? 'progressive';
  const doInferEmphasis = reel.inferEmphasis ?? true;
  const columnGapRatio = reel.columnGapRatio ?? 0.22;
  const rowGapRatio = reel.rowGapRatio ?? 0.05;
  const maxWidthPercent = reel.maxWidthPercent ?? 88;
  const paddingPercent = reel.paddingPercent ?? 6;

  const USABLE_WIDTH = frameWidth * (maxWidthPercent / 100);
  const CHAR_ADVANCE = typeof styleSpec.charAdvance === 'number'
    ? styleSpec.charAdvance
    : 0.62;

  const chunks: CaptionChunk[] = captionPlan
    ? captionPlan.chunks
    : fallbackChunks(transcript.words, maxPerLine);

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

  const hasAnyEmphasis = activeChunk.emphasis.some((e) => e === true);
  const effectiveEmphasis: boolean[] =
    hasAnyEmphasis ? activeChunk.emphasis
    : doInferEmphasis ? inferEmphasisFlags(activeChunk.words)
    : activeChunk.emphasis;

  const positionStyle: React.CSSProperties =
    position === 'top'
      ? { top: `${safeMargin * 100}%` }
      : position === 'middle'
        ? { top: '50%', transform: 'translateY(-50%)' }
        : { bottom: `${safeMargin * 100}%` };

  const justifyContent =
    align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center';
  const alignItems =
    align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center';

  // Group active words into lines using maxPerLine, then width-budget split
  // so long words can't spill beyond the usable area.
  type LineEntry = { wordIdx: number };
  const lines: LineEntry[][] = [];
  {
    let cur: LineEntry[] = [];
    for (let i = 0; i < activeChunk.words.length; i++) {
      cur.push({ wordIdx: i });
      if (cur.length >= maxPerLine) {
        lines.push(cur);
        cur = [];
      }
    }
    if (cur.length > 0) lines.push(cur);
  }
  // Width-budget split: re-walk each line, break when cumulative pixel width
  // (with emphasis multiplier) would exceed USABLE_WIDTH.
  {
    const split: LineEntry[][] = [];
    for (const line of lines) {
      if (line.length <= 1) {
        split.push(line);
        continue;
      }
      const gap = baseSize * columnGapRatio;
      let bucket: LineEntry[] = [];
      let bucketWidth = 0;
      for (const entry of line) {
        const w = activeChunk.words[entry.wordIdx]!;
        const isEmph = effectiveEmphasis[entry.wordIdx] ?? false;
        const sz = isEmph ? baseSize * emphasisSizeMultiplier : baseSize;
        const wordWidth = sz * Math.max(1, w.word.length) * CHAR_ADVANCE;
        const needsBreak = bucket.length > 0 &&
          bucketWidth + gap + wordWidth > USABLE_WIDTH;
        if (needsBreak) {
          split.push(bucket);
          bucket = [];
          bucketWidth = 0;
        }
        bucket.push(entry);
        bucketWidth += wordWidth + (bucket.length > 1 ? gap : 0);
      }
      if (bucket.length > 0) split.push(bucket);
    }
    lines.length = 0;
    for (const l of split) lines.push(l);
  }

  // Palette starting offset rotates per chunk so back-to-back chunks don't
  // open with the same color.
  const paletteOffset = activeChunkIdx;

  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      {videoFile && (
        <OffthreadVideo src={videoFile.startsWith('http') ? videoFile : staticFile(videoFile)} />
      )}
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
            alignItems,
            rowGap: `${baseSize * rowGapRatio}px`,
            maxWidth: `${maxWidthPercent}%`,
          }}
        >
          {lines.map((line, lineIdx) => (
            <div
              key={lineIdx}
              style={{
                display: 'flex',
                alignItems: 'baseline',
                justifyContent,
                columnGap: `${baseSize * columnGapRatio}px`,
              }}
            >
              {line.map(({ wordIdx: i }) => {
                const w = activeChunk.words[i]!;
                const isEmphasis = effectiveEmphasis[i] ?? false;
                const filler = !isEmphasis && isFiller(w.word);

                const wordStartFrame = Math.floor(w.start * fps);
                if (wordReveal === 'progressive' && frame < wordStartFrame) return null;

                const entryFrame =
                  wordReveal === 'progressive'
                    ? wordStartFrame
                    : Math.floor(activeChunk.words[0]!.start * fps);
                const progress = spring({
                  frame: frame - entryFrame,
                  fps,
                  durationInFrames: Math.max(1, Math.round((animDuration / 1000) * fps)),
                  config: { damping: springDamping, stiffness: springStiffness, mass: springMass },
                });
                const scale = scaleFrom + progress * (1 - scaleFrom);
                const opacity = filler
                  ? Math.min(fillerOpacity, scaleFrom < 1 ? progress * 1.5 * fillerOpacity : fillerOpacity)
                  : Math.min(1, scaleFrom < 1 ? progress * 1.5 : 1);

                // Entry tilt: starts at tiltDegrees, settles to 0° as progress→1.
                const entryTilt = tiltDegrees * (1 - progress);

                // Emphasis sway: continuous sinusoid driven by absolute time
                // since word start, only active after entry settles. Gives
                // emphasis words a permanent samba-step jiggle.
                const tSinceEntry = (frame - entryFrame) / fps;
                const swayTilt = isEmphasis
                  ? swayAmplitudeDegrees * Math.sin(tSinceEntry * 2 * Math.PI * swayHz) * progress
                  : 0;
                const totalRotation = entryTilt + swayTilt;

                // Color: emphasis locks to flag-yellow (or whatever
                // emphasisFill is), regular words cycle the palette.
                const paletteIdx = (i + paletteOffset) % palette.length;
                const cyclingColor = palette[paletteIdx] ?? fillColor;
                const finalColor = isEmphasis ? emphasisFill : cyclingColor;

                const sizeMul = isEmphasis ? emphasisSizeMultiplier : 1.0;
                const size = baseSize * sizeMul;

                return (
                  <span
                    key={i}
                    style={{
                      fontFamily: `"${fontFamily}", cursive`,
                      fontWeight: baseWeight,
                      fontSize: `${size}px`,
                      lineHeight: 1.05,
                      letterSpacing: baseLetterSpacing ? `${baseLetterSpacing}px` : undefined,
                      textTransform: baseTextTransform,
                      color: finalColor,
                      transform: `scale(${scale}) rotate(${totalRotation}deg)`,
                      transformOrigin: 'center bottom',
                      opacity,
                      display: 'inline-block',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {w.word}
                  </span>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </AbsoluteFill>
  );
};
