import React from 'react';
import { spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { loadFont } from '@remotion/google-fonts/PlayfairDisplay';
import type {
  CaptionPlan,
  StyleSpec,
  Transcript,
  Word,
  CaptionChunk,
} from './CaptionLayer';

// Editorial / hopecore caption layer. Inspired by ig.mp4 reference:
// serif typography with dramatic per-word size variance (emphasis words
// ~3× the size of filler words), mixed case (emphasis UPPERCASE, filler
// natural), subtle per-chunk rotation, words pop-in sequenced by their
// speech times. Captions fill the full height of the frame, treating the
// text as the hero visual — not a subtitle bar.
//
// Used by StoryComposition when styleSpec.layout.mode === 'editorial'.
// Classic PopWords-style captions still go through CaptionLayer.

loadFont('normal', { weights: ['900'], subsets: ['latin'] });
loadFont('italic', { weights: ['900'], subsets: ['latin'] });

// Chunk-indexed container rotation table. Small angles — enough to feel
// hand-placed, not so much that readability suffers.
const ROTATION_TABLE = [-1.5, 1, -2, 0.5, 2, -1, 1.5, -2.5];

// Words that enrichTranscript typically marks as non-emphasis but which
// should still render as tiny filler (articles, prepositions, pronouns,
// auxiliaries). When a word is non-emphasis AND in this set, it's rendered
// at the smallest tier; gives the ig.mp4 "OUT of SHAPE" contrast.
const FILLER_WORDS = new Set([
  'a', 'an', 'the', 'of', 'to', 'in', 'on', 'at', 'by', 'for', 'with', 'as',
  'is', 'are', 'was', 'were', 'be', 'been', 'am',
  'i', 'me', 'my', 'we', 'us', 'our', 'you', 'your', 'he', 'him', 'his',
  'she', 'her', 'it', 'its', 'they', 'them', 'their',
  'and', 'or', 'but', 'so', 'if', 'then', 'than',
  "it's", "i'm", "we're", "you're", "they're", "that's", "what's",
  'um', 'uh', 'er', 'oh',
]);

function normalize(word: string): string {
  return word.toLowerCase().replace(/[.,!?;:"'()—-]/g, '');
}

function isFiller(word: string): boolean {
  return FILLER_WORDS.has(normalize(word));
}

// Deterministic emphasis inference for chunks the LLM didn't mark.
// Picks the 1–2 longest non-filler words, preferring the one with the most
// alpha characters. Ties broken by original word order so the result is
// stable across renders.
function inferEmphasis(words: Word[]): boolean[] {
  const out = words.map(() => false);
  if (words.length === 0) return out;
  type Candidate = { idx: number; length: number };
  const candidates: Candidate[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    if (isFiller(w.word)) continue;
    const alphaLen = w.word.replace(/[^A-Za-z]/g, '').length;
    if (alphaLen >= 3) candidates.push({ idx: i, length: alphaLen });
  }
  if (candidates.length === 0) {
    // No good candidates — mark the single longest word overall so the
    // chunk still has SOMETHING hero-sized.
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

type Props = {
  transcript: Transcript;
  captionPlan: CaptionPlan | null;
  styleSpec: StyleSpec;
};

export const HopecoreCaptionLayer: React.FC<Props> = ({
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

  const baseSize = font.size ?? 72;
  const baseWeight = font.weight ?? 900;
  const fillColor = color.fill ?? '#ffffff';
  const strokeColor = color.stroke ?? '#000000';
  const strokeWidth = color.strokeWidth ?? 12;
  const maxPerLine = layout.maxWordsPerLine ?? 5;
  const palette = toPalette(color.emphasisFill, '#ff2bd6');

  // Chunks from LLM plan or fallback wrapper.
  const chunks: CaptionChunk[] = captionPlan
    ? captionPlan.chunks
    : fallbackChunks(transcript.words, maxPerLine);

  // Active chunk: the LATEST chunk whose first word has already started.
  // This bridges any gap between chunk N's last word and chunk N+1's first
  // word — chunk N stays on screen until N+1 starts, so narration never
  // plays over a blank frame. Walk backwards so the first hit is the
  // latest-started chunk.
  let activeChunkIdx = -1;
  for (let i = chunks.length - 1; i >= 0; i--) {
    const c = chunks[i];
    if (c && c.words.length > 0 && t >= c.words[0]!.start) {
      activeChunkIdx = i;
      break;
    }
  }
  if (activeChunkIdx < 0) return null;
  const activeChunk = chunks[activeChunkIdx]!;

  const chunkRotation = ROTATION_TABLE[activeChunkIdx % ROTATION_TABLE.length] ?? 0;
  const emphasisColor = palette[activeChunkIdx % palette.length] ?? '#ff2bd6';

  // CRITICAL: this layer's entire visual impact depends on emphasis flags —
  // they drive the huge/uppercase/colored hero words. When enrichTranscript
  // fails (network blip, missing API key), the upstream fallback chunker
  // returns all-false emphasis arrays, which would render as flat medium
  // text with no hero words. To preserve the editorial look in that case,
  // auto-infer emphasis: pick the 1–2 longest NON-filler words in the
  // chunk. This is view-side behavior only; LLM-marked emphasis is used
  // as-is when present.
  const hasAnyEmphasis = activeChunk.emphasis.some((e) => e === true);
  const effectiveEmphasis: boolean[] = hasAnyEmphasis
    ? activeChunk.emphasis
    : inferEmphasis(activeChunk.words);

  // Size tiers. Emphasis words dominate; fillers shrink dramatically.
  const SIZE_EMPHASIS = baseSize * 2.8;
  const SIZE_MEDIUM = baseSize * 1.0;
  const SIZE_FILLER = baseSize * 0.55;

  // Usable width after container padding (6%/2% on edges). Any single
  // emphasis word must fit inside this width, or it'll overflow the frame.
  // Playfair Display weight 900 has wide glyphs — chars like M/W/B run
  // closer to 0.65 em advance than the 0.5 typical of sans-serif. We cap
  // per-word size by dividing the usable width by word length × advance.
  const USABLE_WIDTH = frameWidth * 0.9;
  const PLAYFAIR_BLACK_ADVANCE = 0.62;
  const maxSizeForWord = (len: number) =>
    len > 0 ? USABLE_WIDTH / (len * PLAYFAIR_BLACK_ADVANCE) : Infinity;

  return (
    <AbsoluteFillCentered>
      <div
        style={{
          transform: `rotate(${chunkRotation}deg)`,
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'baseline',
          justifyContent: 'center',
          rowGap: `${baseSize * 0.15}px`,
          columnGap: `${baseSize * 0.25}px`,
          maxWidth: '94%',
          padding: '0 3%',
        }}
      >
        {activeChunk.words.map((w, i) => {
          const isEmphasis = effectiveEmphasis[i] ?? false;
          const filler = !isEmphasis && isFiller(w.word);

          // Per-word pop: starts at the word's own speech time so words
          // reveal in rhythm with the narration.
          const wordStartFrame = Math.floor(w.start * fps);
          const progress = spring({
            frame: frame - wordStartFrame,
            fps,
            durationInFrames: 14,
            config: { damping: 11, stiffness: 220, mass: 0.6 },
          });
          const overshoot = isEmphasis ? 1.08 : 1.0;
          const scale = 0.7 + progress * 0.3 * overshoot;
          const opacity = Math.min(1, Math.max(0, progress * 1.3));

          // Emphasis words get clamped to fit within the frame. Medium
          // and filler words are already small enough to fit several per
          // line, so clamping is unnecessary there.
          const rawSize = isEmphasis ? SIZE_EMPHASIS : filler ? SIZE_FILLER : SIZE_MEDIUM;
          const size = isEmphasis
            ? Math.min(rawSize, maxSizeForWord(w.word.length))
            : rawSize;
          const textColor = isEmphasis ? emphasisColor : fillColor;
          const strokePx = isEmphasis
            ? strokeWidth
            : filler
              ? Math.max(3, Math.round(strokeWidth * 0.45))
              : Math.max(4, Math.round(strokeWidth * 0.6));

          // Mixed case: emphasis always UPPERCASE for impact; filler always
          // lowercase; medium keeps original case (lets proper nouns read
          // naturally).
          const text = isEmphasis
            ? w.word.toUpperCase()
            : filler
              ? w.word.toLowerCase()
              : w.word;

          // Emphasis words are upright serif, filler words italic — the
          // ig.mp4 reference does this to signal "this is the aside".
          const fontStyle: 'normal' | 'italic' = filler ? 'italic' : 'normal';

          return (
            <span
              key={i}
              style={{
                fontFamily: '"Playfair Display", "Times New Roman", serif',
                fontWeight: baseWeight,
                fontStyle,
                fontSize: `${size}px`,
                lineHeight: 0.95,
                letterSpacing: isEmphasis ? '-1px' : '0',
                color: textColor,
                WebkitTextStroke: `${strokePx}px ${strokeColor}`,
                paintOrder: 'stroke fill',
                transform: `scale(${scale})`,
                transformOrigin: 'center center',
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
    </AbsoluteFillCentered>
  );
};

// Centered full-frame wrapper so the flex column sits in the vertical
// middle of the output. Using a tall padding on top/bottom prevents the
// largest emphasis words from clipping.
const AbsoluteFillCentered: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div
    style={{
      position: 'absolute',
      inset: 0,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '6% 2%',
    }}
  >
    {children}
  </div>
);
