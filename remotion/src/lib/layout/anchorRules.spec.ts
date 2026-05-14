import { describe, expect, it } from 'vitest';
import {
  isAnchorBlock,
  isAnchorEmphasis,
  isValueWord,
  strippedAlphanumeric,
  valueKey,
  wordAlphaLen,
  wordHasDigit,
} from './anchorRules';

describe('per-word helpers', () => {
  it('wordHasDigit detects any digit', () => {
    expect(wordHasDigit('26')).toBe(true);
    expect(wordHasDigit("I'm 26.")).toBe(true);
    expect(wordHasDigit('twenty-six')).toBe(false);
  });

  it('wordAlphaLen counts only A-Za-z', () => {
    expect(wordAlphaLen('cinematic')).toBe(9);
    expect(wordAlphaLen("don't")).toBe(4);
    expect(wordAlphaLen('26')).toBe(0);
    expect(wordAlphaLen('me!')).toBe(2);
  });

  it('valueKey matches the canonical lowercase+strip formula', () => {
    expect(valueKey('NEVER!')).toBe('never');
    expect(valueKey('Most.')).toBe('most');
    expect(valueKey("I'm")).toBe('im');  // apostrophe IS in the strip set
  });

  it('isValueWord matches against the curated VALUE_WORDS list', () => {
    expect(isValueWord('NEVER')).toBe(true);
    expect(isValueWord('most')).toBe(true);
    expect(isValueWord('cinematic')).toBe(false);
  });

  it('strippedAlphanumeric keeps digits and letters, drops punctuation', () => {
    expect(strippedAlphanumeric("don't")).toBe('dont');
    expect(strippedAlphanumeric('26-year-old')).toBe('26yearold');
  });
});

describe('isAnchorBlock', () => {
  const baseInput = {
    isEmphasis: true,
    isLastLine: true,
    isOnOwnLine: true,
    sizeRuleIsFit: true,
    hasEmphasisFillRatio: true,
    word: 'cinematic',
  };

  it('passes the canonical happy path', () => {
    expect(isAnchorBlock(baseInput)).toBe(true);
  });

  it('rejects when not emphasis', () => {
    expect(isAnchorBlock({ ...baseInput, isEmphasis: false })).toBe(false);
  });

  it('rejects when not on the last line', () => {
    expect(isAnchorBlock({ ...baseInput, isLastLine: false })).toBe(false);
  });

  it('rejects when not the only word on the line', () => {
    expect(isAnchorBlock({ ...baseInput, isOnOwnLine: false })).toBe(false);
  });

  it('rejects when sizeRule is not "fit"', () => {
    expect(isAnchorBlock({ ...baseInput, sizeRuleIsFit: false })).toBe(false);
  });

  it('rejects when emphasisFillRatio is unset', () => {
    expect(isAnchorBlock({ ...baseInput, hasEmphasisFillRatio: false })).toBe(false);
  });

  it('rejects digits (e.g. "26")', () => {
    expect(isAnchorBlock({ ...baseInput, word: '26' })).toBe(false);
  });

  it('rejects value-words (e.g. "never")', () => {
    expect(isAnchorBlock({ ...baseInput, word: 'NEVER' })).toBe(false);
  });

  it('rejects words with fewer than 5 alpha characters', () => {
    expect(isAnchorBlock({ ...baseInput, word: 'hot' })).toBe(false);
    expect(isAnchorBlock({ ...baseInput, word: 'home' })).toBe(false);
  });

  it('accepts exactly 5 alpha characters', () => {
    expect(isAnchorBlock({ ...baseInput, word: 'every' })).toBe(false); // value-word
    expect(isAnchorBlock({ ...baseInput, word: 'birds' })).toBe(true);
  });
});

describe('isAnchorEmphasis', () => {
  const baseInput = {
    emphasisLineBreakEnabled: true,
    isEmphasis: true,
    isLastWordInChunk: true,
    word: 'cinematic',
  };

  it('passes the canonical happy path', () => {
    expect(isAnchorEmphasis(baseInput)).toBe(true);
  });

  it('rejects when emphasisLineBreak is disabled', () => {
    expect(isAnchorEmphasis({ ...baseInput, emphasisLineBreakEnabled: false })).toBe(false);
  });

  it('rejects when not the last word in the chunk', () => {
    expect(isAnchorEmphasis({ ...baseInput, isLastWordInChunk: false })).toBe(false);
  });

  it('uses alphanumeric length (5+ chars), unlike isAnchorBlock', () => {
    // "26-year" has 6 alphanumeric chars, but only 4 alpha; isAnchorBlock
    // rejects (alpha < 5) but isAnchorEmphasis accepts.
    expect(isAnchorEmphasis({ ...baseInput, word: '26year' })).toBe(false); // contains digit
    expect(isAnchorEmphasis({ ...baseInput, word: 'sixyear' })).toBe(true);
  });
});
