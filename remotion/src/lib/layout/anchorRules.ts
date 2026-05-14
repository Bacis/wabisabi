// Shared word-classification predicates used by the cascade-stack layout
// AND the renderer's per-word visual branches. These were duplicated inline
// across ReelClone.tsx (the pre-pass at line ~482 and the render at line
// ~567 computed the same `isAnchorBlock` predicate from the same fields);
// extracting them here is Phase 5a of the layout refactor and the precondition
// for Phase 5b (the full layout-walk extraction).
//
// All functions are pure. They take the relevant fields directly so callers
// can inline them in any walking pattern without forcing a particular shape.

import { VALUE_WORDS } from '../linguistics';

// ---------------------------------------------------------------------------
// Tiny per-word helpers (replace the locally-redefined helpers at lines
// 377-381 and 559-561 of the pre-extraction ReelClone).

export function wordHasDigit(word: string): boolean {
  return /\d/.test(word);
}

export function wordAlphaLen(word: string): number {
  return word.replace(/[^A-Za-z]/g, '').length;
}

// Lowercase + strip outer punctuation so VALUE_WORDS.has() matches.
// Matches the canonical `valueKey` formula from the original inline code.
export function valueKey(word: string): string {
  return word.toLowerCase().replace(/[.,!?;:"'()—\-_]/g, '');
}

export function isValueWord(word: string): boolean {
  return VALUE_WORDS.has(valueKey(word));
}

// Strip everything that isn't alphanumeric. Used by the line-grouping
// anchor-emphasis check (which keys off raw token length, not just alpha).
export function strippedAlphanumeric(word: string): string {
  return word.replace(/[^A-Za-z0-9]/g, '');
}

// ---------------------------------------------------------------------------
// Anchor-block predicate. The "anchor block" is the big cascade-bottom word
// that gets fit-to-line treatment. Both the layout pre-pass and the render
// branch must agree on this — duplicated logic was the load-bearing source
// of the "two computations of the same thing" smell the plan called out.

export type AnchorBlockInput = {
  isEmphasis: boolean;
  isLastLine: boolean;
  isOnOwnLine: boolean;
  sizeRuleIsFit: boolean;       // styleDefaults.sizeRule === 'fit'
  hasEmphasisFillRatio: boolean; // emphasisFillRatio != null
  word: string;
};

export function isAnchorBlock(input: AnchorBlockInput): boolean {
  if (!input.isEmphasis) return false;
  if (!input.isLastLine) return false;
  if (!input.isOnOwnLine) return false;
  if (!input.sizeRuleIsFit) return false;
  if (!input.hasEmphasisFillRatio) return false;
  if (wordHasDigit(input.word)) return false;
  if (isValueWord(input.word)) return false;
  if (wordAlphaLen(input.word) < 5) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Anchor-emphasis predicate (line-grouping pass — different from anchor-block).
// Decides whether an emphasized word should get its own line. Different rules
// from anchor-block: keys off "is this the last word in the chunk?" rather
// than "is this the only word on the last line?", and uses alphanumeric
// length not alpha length.

export type AnchorEmphasisInput = {
  emphasisLineBreakEnabled: boolean;
  isEmphasis: boolean;
  isLastWordInChunk: boolean;
  word: string;
};

export function isAnchorEmphasis(input: AnchorEmphasisInput): boolean {
  if (!input.emphasisLineBreakEnabled) return false;
  if (!input.isEmphasis) return false;
  if (!input.isLastWordInChunk) return false;
  if (wordHasDigit(input.word)) return false;
  if (isValueWord(input.word)) return false;
  if (strippedAlphanumeric(input.word).length < 5) return false;
  return true;
}
