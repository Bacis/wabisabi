import React from 'react';
import { AbsoluteFill, OffthreadVideo, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { loadFont } from '@remotion/google-fonts/PlusJakartaSans';
import type { FaceData } from '../lib/positioning';
import type {
  CaptionPlan,
  Transcript,
  Word,
  CaptionChunk,
} from '../lib/CaptionLayer';

// KineticMontage — cascade-anchor-multi-color-progressive-reveal caption
// template. Forked from ReelClone for the Plus Jakarta Sans ExtraBold
// aesthetic: a heavy friendly-geometric sans with progressive per-word spring
// reveal, 1–3 line cascading size stack, position-aware emphasis (anchor-block
// vs inline-color palette cycling), and a generic FNV-rate italic accent.
//
// StyleSpec fields read by this template:
//   font.family               — Plus Jakarta Sans (set by preset). Renderer uses fontFamily verbatim.
//   font.weight               — base weight; preset uses 800 (ExtraBold) — Plus Jakarta Sans tops out at 800.
//   font.size                 — nominal size at 1080-wide source; scaled by frameWidth/1080.
//   font.letterSpacing        — px tracking; -2 for ExtraBold.
//   font.textTransform        — base case; 'lowercase' by default.
//   color.fill                — default text color (white).
//   color.emphasisFill        — palette (string | string[]); cycled when multiColorEmphasis.
//   color.strokeWidth         — outline thickness; 0 = pure flat type.
//   layout.position           — 'top' | 'middle' | 'bottom'.
//   layout.safeMargin         — fraction (0–0.5) from frame edge.
//   layout.maxWordsPerLine    — logical line capacity.
//   layout.align              — 'left' | 'center' | 'right'.
//   animation.tailMs          — chunk persistence after last word ends.
//   animation.scaleFrom       — spring entry start scale (0.7 = pops up from 70%).
//   animation.durationMs      — spring duration (~140ms).
//   animation.spring.{damping,stiffness,mass} — spring physics.
//   charAdvance               — empirical glyph-width / glyph-height ratio.
//                               Plus Jakarta Sans ExtraBold @ -2 letterSpacing → ~0.560.
//   reel.cascadeTopRatio      — top-line size as fraction of bottom (0.47 default).
//   reel.cascadeBottomRatio   — bottom-line (anchor) size factor (1.0 default).
//   reel.emphasisFillRatio    — anchor-block fit-size as fraction of usable width (0.75).
//   reel.emphasisMaxHeightRatio — cap on anchor font-size as fraction of frame height (0.16).
//   reel.emphasisTextTransform — case for anchor-block ('uppercase' default).
//   reel.emphasisWeight       — weight for anchor-block (900 default).
//   reel.multiColorEmphasis   — cycle palette per emphasis word in chunk (true).
//   reel.italicAccentRate     — fraction of qualifying long content words rendered italic
//                                (0.057 default; 0.08 floor, 0.30 cap, anchor-block excluded).
//   reel.wordReveal           — 'progressive' (per-word at spoken time) | 'all'.
//   reel.inferEmphasis        — auto-mark emphasis if plan has none.
//   reel.columnGapRatio       — inter-word gap as fraction of baseSize.
//   reel.rowGapRatio          — inter-line gap as fraction of baseSize.
//   reel.maxWidthPercent      — usable width as % of frame (80 default).
//   reel.paddingPercent       — horizontal padding as % of frame.

loadFont('normal', {
  weights: ['400', '700', '800'],
  subsets: ['latin'],
});
loadFont('italic', {
  weights: ['400', '700', '800'],
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

// Value-words always render as inline-color emphasis, never as anchor-blocks.
// Color carries the visual weight; size dramatics are reserved for long alpha
// content words like REALITY / CHANGES / BUSINESS.
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

type Props = {
  videoFile: string;
  videoMeta: { width: number; height: number; durationInFrames: number; fps: number };
  transcript: Transcript;
  captionPlan: CaptionPlan | null;
  faces: FaceData | null;
  styleSpec: Record<string, any>;
};

export const KineticMontage: React.FC<Props> = ({
  videoFile,
  transcript,
  captionPlan,
  styleSpec,
}) => {
  const frame = useCurrentFrame();
  const { fps, width: frameWidth, height: frameHeight } = useVideoConfig();
  const t = frame / fps;

  const font = styleSpec.font ?? {};
  const color = styleSpec.color ?? {};
  const layout = styleSpec.layout ?? {};
  const anim = styleSpec.animation ?? {};
  const reel = styleSpec.reel ?? {};

  const fontFamily = font.family ?? 'Plus Jakarta Sans';
  const nominalSize = font.size ?? 234;
  const baseSize = nominalSize * (frameWidth / 1080);
  const baseWeight = font.weight ?? 800;
  const baseLetterSpacing = font.letterSpacing ?? -2;
  const baseTextTransform = font.textTransform ?? 'lowercase';

  const fillColor = color.fill ?? '#ffffff';
  const strokeColor = color.stroke ?? '#000000';
  const strokeWidth = color.strokeWidth ?? 0;
  const palette = toPalette(color.emphasisFill, fillColor);

  const maxPerLine = layout.maxWordsPerLine ?? 3;
  const position = layout.position ?? 'bottom';
  const safeMargin = layout.safeMargin ?? 0.18;
  const align = layout.align ?? 'left';

  const tailMs = anim.tailMs ?? 200;
  const scaleFrom = anim.scaleFrom ?? 0.7;
  const springDamping = anim.spring?.damping ?? 14;
  const springStiffness = anim.spring?.stiffness ?? 240;
  const springMass = anim.spring?.mass ?? 0.5;
  const animDuration = anim.durationMs ?? 140;

  const emphasisFillRatio: number =
    typeof reel.emphasisFillRatio === 'number' ? reel.emphasisFillRatio : 0.75;
  const emphasisMaxHeightRatio: number =
    typeof reel.emphasisMaxHeightRatio === 'number' ? reel.emphasisMaxHeightRatio : 0.16;
  const cascadeTopRatio: number =
    typeof reel.cascadeTopRatio === 'number' ? reel.cascadeTopRatio : 0.47;
  const cascadeBottomRatio: number =
    typeof reel.cascadeBottomRatio === 'number' ? reel.cascadeBottomRatio : 1.0;
  const multiColorEmphasis: boolean = reel.multiColorEmphasis !== false;
  const italicAccentRate: number = typeof reel.italicAccentRate === 'number'
    ? Math.max(0, Math.min(1, reel.italicAccentRate))
    : 0.06;

  // FNV-1a 32-bit. Stable per-word selector for the italic-rate gate.
  const hashUnit = (s: string): number => {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0) / 0x100000000;
  };
  const isItalicWord = (key: string): boolean => {
    if (key.length < 5) return false;
    if (italicAccentRate > 0) {
      const effective = Math.max(0.08, Math.min(0.3, italicAccentRate));
      if (hashUnit(key) < effective) return true;
    }
    return false;
  };

  const emphasisTextTransform = reel.emphasisTextTransform ?? 'uppercase';
  const fillerTextTransform = reel.fillerTextTransform ?? baseTextTransform;
  const mediumTextTransform = reel.mediumTextTransform ?? baseTextTransform;
  const emphasisWeight = reel.emphasisWeight ?? baseWeight;
  const wordReveal = reel.wordReveal ?? 'progressive';
  const doInferEmphasis = reel.inferEmphasis ?? false;
  const columnGapRatio = reel.columnGapRatio ?? 0.18;
  const rowGapRatio = reel.rowGapRatio ?? 0.04;
  const maxWidthPercent = reel.maxWidthPercent ?? 80;
  const paddingPercent = reel.paddingPercent ?? 6;

  const USABLE_WIDTH = frameWidth * (maxWidthPercent / 100);
  const CHAR_ADVANCE = typeof styleSpec.charAdvance === 'number'
    ? styleSpec.charAdvance
    : 0.560;
  const maxSizeForWord = (len: number) =>
    len > 0 ? USABLE_WIDTH / (len * CHAR_ADVANCE) : Infinity;

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
  const fallbackEmphasisColor = palette[activeChunkIdx % palette.length] ?? fillColor;

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
            alignItems: align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center',
            rowGap: `${baseSize * rowGapRatio}px`,
            maxWidth: `${maxWidthPercent}%`,
          }}
        >
          {(() => {
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
              const isAnchorEmph =
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

            // Width-budget split — break a line whenever cumulative pixel
            // width would exceed USABLE_WIDTH. Same source-of-truth as
            // maxSizeForWord so split decisions and rendered sizes agree.
            const splitLines: LineEntry[][] = [];
            const widthBudget = USABLE_WIDTH;
            for (let li = 0; li < lines.length; li++) {
              const line = lines[li]!;
              if (line.length <= 1) {
                splitLines.push(line);
                continue;
              }
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
            lines.length = 0;
            for (const l of splitLines) lines.push(l);

            let emphasisSeen = 0;

            return lines.map((line, lineIdx) => {
              const lineFactor =
                lines.length <= 1
                  ? cascadeBottomRatio
                  : cascadeTopRatio +
                    (cascadeBottomRatio - cascadeTopRatio) *
                      (lineIdx / (lines.length - 1));
              return (
                <div
                  key={lineIdx}
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    justifyContent,
                    columnGap: `${baseSize * lineFactor * columnGapRatio}px`,
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
                    const opacity = Math.min(1, scaleFrom < 1 ? progress * 1.5 : 1);

                    const isAnchor = lineIdx === lines.length - 1;
                    const onOwnLine = line.length === 1;
                    const wordHasDigit = /\d/.test(w.word);
                    const wordAlphaLen = w.word.replace(/[^A-Za-z]/g, '').length;
                    const wordKeyEarly = w.word.toLowerCase().replace(/[.,!?;:"'()—\-_]/g, '');
                    const wordIsValue = VALUE_WORDS.has(wordKeyEarly);
                    // Anchor-block decision precedes italic so big anchor words
                    // (REALITY/CHANGES/BUSINESS) never get italicized away from
                    // their block treatment.
                    const isAnchorBlock =
                      isEmphasis && isAnchor && onOwnLine &&
                      !wordHasDigit &&
                      !wordIsValue &&
                      wordAlphaLen >= 5;
                    const wordIsItalic = !isAnchorBlock && isItalicWord(wordKeyEarly);

                    const fitSize = isAnchorBlock
                      ? (USABLE_WIDTH * emphasisFillRatio) /
                        Math.max(1, w.word.length * CHAR_ADVANCE)
                      : null;

                    const cascadeBase = baseSize * lineFactor;
                    const rawSize = fitSize != null ? fitSize : cascadeBase;

                    const heightCap = isAnchorBlock
                      ? frameHeight * emphasisMaxHeightRatio
                      : frameHeight * 0.4;
                    const size = Math.min(rawSize, maxSizeForWord(w.word.length), heightCap);

                    let resolvedColor = fillColor;
                    if (isEmphasis && !isAnchorBlock) {
                      resolvedColor = multiColorEmphasis
                        ? palette[emphasisSeen % palette.length] ?? fallbackEmphasisColor
                        : fallbackEmphasisColor;
                    }
                    if (isEmphasis) emphasisSeen++;

                    // Only the anchor-block applies the emphasis transform
                    // (uppercase). Inline emphasis stays lowercase to sit
                    // naturally in the cascade ("never" red, not "NEVER" red).
                    const transform = isAnchorBlock
                      ? emphasisTextTransform
                      : filler ? fillerTextTransform : mediumTextTransform;
                    const text = applyTransform(w.word, transform);
                    const weight = isAnchorBlock ? emphasisWeight : baseWeight;
                    // Italic accent renders white (no color), per the spec.
                    const fontStyle: 'italic' | 'normal' = wordIsItalic ? 'italic' : 'normal';
                    const finalColor = wordIsItalic ? fillColor : resolvedColor;

                    return (
                      <span
                        key={i}
                        style={{
                          fontFamily: `"${fontFamily}", sans-serif`,
                          fontWeight: weight,
                          fontStyle,
                          fontSize: `${size}px`,
                          lineHeight: 1.0,
                          letterSpacing: baseLetterSpacing ? `${baseLetterSpacing}px` : undefined,
                          color: finalColor,
                          WebkitTextStroke: strokeWidth > 0 ? `${strokeWidth}px ${strokeColor}` : undefined,
                          paintOrder: strokeWidth > 0 ? 'stroke fill' : undefined,
                          transform: scale !== 1 ? `scale(${scale})` : undefined,
                          transformOrigin: 'left baseline',
                          opacity,
                          display: 'inline-block',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {text}
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
