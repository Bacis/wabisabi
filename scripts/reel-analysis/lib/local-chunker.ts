// Deterministic, free local caption chunker. Used as a fallback to
// enrichTranscript when API credits are exhausted, and as a baseline for
// analysis-time iteration. Produces the same CaptionPlan schema:
//   { chunks: [{ words: Word[], emphasis: boolean[] }] }
//
// Rules derived from observation of reference reels (see runs/DXhn5HNhTxy):
//   1. Chunks are 2-4 words, target 3.
//   2. Chunks should END on a content (non-filler) word — that word becomes
//      the visual anchor at the bottom of the cascade stack.
//   3. Break naturally on long inter-word gaps (>=200ms suggests a pause).
//   4. Emphasis is placed on at most one word per chunk:
//      - prefer the last content word (anchor pattern: "the fabric of REALITY")
//      - otherwise the longest content word in the chunk
//      - emphasize only if the chosen word has alpha-length >= 6, OR the chunk
//        has only one content word (one-word chunks like "TIME" / "f*ck")
//      - this avoids the over-eager every-chunk emphasis that hand-rolled
//        random selection produced.

import type { Transcript, CaptionPlan, Word } from '../../../src/shared/types.js';

// Filler words = articles, prepositions, common pronouns, auxiliaries,
// fillers. Anchoring a chunk on these looks bad; cascading with them at the
// bottom looks worse. Keep this list aggressive.
const FILLERS = new Set<string>([
  'a', 'an', 'the',
  'of', 'to', 'in', 'on', 'at', 'by', 'for', 'with', 'as', 'into', 'onto',
  'from', 'up', 'down', 'out', 'off', 'over', 'under', 'about', 'around',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am',
  'will', 'would', 'could', 'should', 'shall', 'may', 'might', 'must',
  'have', 'has', 'had', 'do', 'does', 'did',
  'i', 'me', 'my', 'mine', 'we', 'us', 'our', 'ours',
  'you', 'your', 'yours', 'he', 'him', 'his', 'she', 'her', 'hers',
  'it', 'its', 'they', 'them', 'their', 'theirs',
  'and', 'or', 'but', 'so', 'if', 'then', 'than', 'because', 'while',
  'that', 'this', 'these', 'those', 'such',
  "it's", "i'm", "we're", "you're", "they're", "that's", "what's",
  "don't", "doesn't", "didn't", "isn't", "aren't", "wasn't", "weren't",
  "won't", "wouldn't", "couldn't", "shouldn't", "haven't", "hasn't",
  'um', 'uh', 'er', 'oh', 'ah', 'eh', 'just', 'now',
]);

function normalize(w: string): string {
  return w.toLowerCase().replace(/[.,!?;:"'()—\-_]/g, '');
}

// Pre-normalize the filler set so the comparator is symmetric — otherwise
// contractions like "that's" miss because normalize strips apostrophes
// but the source set keeps them.
const NORMALIZED_FILLERS = new Set([...FILLERS].map(normalize));
// Add a few connectives that reference reels rarely anchor on.
['where', 'when', 'why', 'how'].forEach((w) => NORMALIZED_FILLERS.add(w));

function isFiller(w: string): boolean {
  return NORMALIZED_FILLERS.has(normalize(w));
}

function alphaLen(w: string): number {
  return w.replace(/[^A-Za-z0-9]/g, '').length;
}

function hasDigit(w: string): boolean {
  return /\d/.test(w);
}

// Words that warrant a "value" emphasis treatment when they appear earlier
// in a chunk: superlatives, quantifiers, negators, key adjectives. References
// often render these in inline color (red/yellow) above the anchor word.
const VALUE_WORDS = new Set<string>([
  'never', 'always', 'no', 'not', 'only', 'every', 'all', 'none',
  'best', 'worst', 'better', 'worse',
  'most', 'more', 'less', 'least',
  'big', 'huge', 'tiny', 'small',
  'first', 'last', 'one',
  'really', 'very', 'truly',
  'so',
]);

function isValueWord(w: string): boolean {
  return hasDigit(w) || VALUE_WORDS.has(normalize(w));
}

const HARD_CAP = 4;            // never more than 4 words in a chunk
const SOFT_TARGET = 3;         // try to flush around 3 words when content-ending
const PAUSE_GAP_SEC = 0.2;     // break on inter-word gap >= this
const LONG_PAUSE_SEC = 0.4;    // any pause this long forces a break

export function chunkLocally(transcript: Transcript): CaptionPlan {
  const words = transcript.words;
  if (words.length === 0) return { chunks: [] };

  // 1. Find raw chunk index ranges.
  const ranges: Array<{ start: number; end: number }> = [];
  let chunkStart = 0;

  const pushRange = (endIdx: number) => {
    if (endIdx >= chunkStart) {
      ranges.push({ start: chunkStart, end: endIdx });
      chunkStart = endIdx + 1;
    }
  };

  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    const len = i - chunkStart + 1;
    const nextGap = i + 1 < words.length ? words[i + 1]!.start - w.end : Infinity;
    const endsOnContent = !isFiller(w.word);

    // Decide whether to flush at i.
    let shouldBreak = false;
    if (len >= HARD_CAP) {
      shouldBreak = true;
    } else if (len >= 2 && nextGap >= LONG_PAUSE_SEC) {
      shouldBreak = true;
    } else if (len >= SOFT_TARGET && endsOnContent && nextGap >= PAUSE_GAP_SEC) {
      shouldBreak = true;
    } else if (len >= SOFT_TARGET && endsOnContent && i + 1 < words.length && isFiller(words[i + 1]!.word)) {
      // Break if next word is a filler — keeps content at the chunk tail.
      shouldBreak = true;
    } else if (len === HARD_CAP - 1 && endsOnContent) {
      // We're about to hit the cap; if we have content at the end, flush now
      // rather than tacking on a 4th word that might be filler.
      shouldBreak = true;
    }

    if (shouldBreak) pushRange(i);
  }
  if (chunkStart < words.length) pushRange(words.length - 1);

  // 2. For each range, decide emphasis (at most one word).
  return {
    chunks: ranges.map((r) => {
      const slice: Word[] = words.slice(r.start, r.end + 1);
      const emphasis = slice.map(() => false);

      // PASS 1 — pick anchor (block) emphasis: longest content word, prefer
      // later position. The renderer will treat anchor-line emphasis as the
      // big white block at the bottom.
      let anchorIdx = -1;
      let anchorLen = -1;
      for (let i = 0; i < slice.length; i++) {
        if (isFiller(slice[i]!.word)) continue;
        const l = alphaLen(slice[i]!.word);
        if (l > anchorLen || (l === anchorLen && i > anchorIdx)) {
          anchorLen = l;
          anchorIdx = i;
        }
      }
      if (anchorIdx < 0) return { words: slice, emphasis }; // all-filler chunk

      const contentCount = slice.filter((w) => !isFiller(w.word)).length;
      // Emphasize the anchor when:
      //   - it's a meaty word (>= 5 alpha chars), OR
      //   - the chunk has only one content word AND that word has >= 4 chars
      //     (drops weak short anchors like "GET", "YES", "OWN")
      // Single-word chunks (slice.length === 1) always get emphasis as a punchline.
      const shouldAnchorEmph =
        slice.length === 1 ||
        anchorLen >= 5 ||
        (contentCount === 1 && anchorLen >= 4);

      // PASS 2 — find a candidate value word (numbers, "never", "best", etc.).
      let valueIdx = -1;
      for (let i = 0; i < slice.length; i++) {
        if (!isValueWord(slice[i]!.word)) continue;
        if (hasDigit(slice[i]!.word)) { valueIdx = i; break; } // numbers win
        if (valueIdx < 0) valueIdx = i; // first non-digit value-word
      }
      const valueIsDigit = valueIdx >= 0 && hasDigit(slice[valueIdx]!.word);

      // Decide which words to mark. Reference reels follow these patterns:
      //   - When a number is present, it is the SOLE emphasis (red inline).
      //     The anchor word is left alone so the cascade size handles it.
      //   - When a non-digit value-word is present alongside a strong anchor,
      //     both are emphasized (value inline + anchor block).
      //   - Otherwise just the anchor (or just the value if anchor is weak).
      if (valueIsDigit) {
        emphasis[valueIdx] = true; // number-only: red inline, no anchor mark
      } else if (shouldAnchorEmph && valueIdx >= 0 && valueIdx !== anchorIdx) {
        emphasis[valueIdx] = true;
        emphasis[anchorIdx] = true;
      } else if (shouldAnchorEmph) {
        emphasis[anchorIdx] = true;
      } else if (valueIdx >= 0) {
        emphasis[valueIdx] = true;
      }

      return { words: slice, emphasis };
    }),
  };
}
