// Pure linguistics helpers shared across caption renderers. Extracted
// verbatim from ReelClone.tsx (Phase 1 of the pipeline refactor) so future
// templates and the agent's stage-scoped tools have a single, testable home
// for word classification + chunking utilities.
//
// Nothing in this module depends on React, Remotion, or styleSpec — every
// function takes its inputs explicitly. The two effective closures (italic
// accent rate + vocabulary) are surfaced as a factory so callers can build a
// matcher once per render and reuse it inside their loops.

import type { Word } from './CaptionLayer';

// Words treated as filler — exempt from emphasis inference and rendered at
// filler styling. The list is intentionally conservative: function words
// + first-/second-person pronouns + common contractions + speech disfluencies.
export const FILLER_WORDS: ReadonlySet<string> = new Set([
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
export const VALUE_WORDS: ReadonlySet<string> = new Set([
  'never', 'always', 'no', 'not', 'only', 'every', 'all', 'none',
  'best', 'worst', 'better', 'worse',
  'most', 'more', 'less', 'least',
  'big', 'huge', 'tiny', 'small',
  'first', 'last', 'one',
  'really', 'very', 'truly',
  'so',
]);

export function normalize(word: string): string {
  return word.toLowerCase().replace(/[.,!?;:"'()—-]/g, '');
}

export function isFiller(word: string): boolean {
  return FILLER_WORDS.has(normalize(word));
}

// Heuristic emphasis inference for chunks where the LLM caption plan has no
// flags. Picks 1-2 longest non-filler words by alpha-character count; falls
// back to the longest word if no candidate has ≥3 alpha chars.
export function inferEmphasis(words: Word[]): boolean[] {
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

// Coerce a single hex / hex array / undefined into a normalized palette.
// Empty arrays collapse to the fallback so downstream `palette[i % N]` is
// always safe.
export function toPalette(ef: string | string[] | undefined, fallback: string): string[] {
  if (Array.isArray(ef)) return ef.length > 0 ? ef : [fallback];
  if (typeof ef === 'string') return [ef];
  return [fallback];
}

export function applyTransform(word: string, transform: string): string {
  if (transform === 'uppercase') return word.toUpperCase();
  if (transform === 'lowercase') return word.toLowerCase();
  return word;
}

// Levenshtein distance — used by the italic-vocabulary fuzzy-match path so
// hand-tuned vocab lists tolerate minor punctuation/inflection variants
// (e.g. "reasonable" matches "reasonable," within 34% of length).
export function editDistance(a: string, b: string): number {
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
}

// Stable string hash — FNV-1a 32-bit. Better distribution on short words
// than polynomial 31-shift, so the italic-rate selection actually reaches
// its target fraction even on small word sets (~30-50 unique words).
// Returns a deterministic value in [0, 1).
export function hashUnit(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 0x100000000;
}

export type ItalicMatcherOptions = {
  // Fraction of qualifying long words to italicize. Clamped to [0, 1] before
  // use; the matcher floors the *effective* rate at 0.08 and caps at 0.30 so
  // small targets still produce visible accents and large targets don't
  // drown the rest of the chunk.
  italicAccentRate?: number;
  // Optional explicit vocabulary list (lowercase). Hand-tuned presets may
  // still set this; the matcher fuzzy-matches words within ~34% of length.
  italicVocabulary?: string[];
};

// Builds a deterministic per-word italic predicate. Splitting this from
// hashUnit/editDistance lets the renderer create the matcher once per render
// and reuse it inside the per-word loop, while leaving the underlying
// numeric helpers pure and testable.
export function makeItalicMatcher(opts: ItalicMatcherOptions): (key: string) => boolean {
  const rateRaw = typeof opts.italicAccentRate === 'number' ? opts.italicAccentRate : 0;
  const italicAccentRate = Math.max(0, Math.min(1, rateRaw));
  const italicVocabulary = (opts.italicVocabulary ?? []).map((s) => String(s).toLowerCase());

  return function isItalicWord(key: string): boolean {
    if (key.length < 5) return false;
    if (italicVocabulary.length > 0) {
      for (const v of italicVocabulary) {
        if (v === key) return true;
        const longer = Math.max(v.length, key.length);
        if (editDistance(v, key) / longer <= 0.34) return true;
      }
    }
    if (italicAccentRate > 0) {
      const effective = Math.max(0.08, Math.min(0.3, italicAccentRate));
      if (hashUnit(key) < effective) return true;
    }
    return false;
  };
}
