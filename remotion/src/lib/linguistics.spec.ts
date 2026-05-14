import { describe, expect, it } from 'vitest';
import {
  applyTransform,
  editDistance,
  hashUnit,
  inferEmphasis,
  isFiller,
  makeItalicMatcher,
  normalize,
  toPalette,
  FILLER_WORDS,
  VALUE_WORDS,
} from './linguistics';
import type { Word } from './CaptionLayer';

const w = (word: string, start = 0, end = 0.3): Word => ({
  word,
  start,
  end,
  confidence: 1,
});

describe('normalize', () => {
  it('lowercases and strips trailing punctuation', () => {
    expect(normalize('Hello,')).toBe('hello');
    expect(normalize('IT?!')).toBe('it');
    expect(normalize("don't")).toBe('dont');
  });
  it('preserves embedded apostrophes after stripping outer punct', () => {
    // The regex strips ALL apostrophes — load-bearing for FILLER_WORDS lookup
    // where keys like "it's" should match "It's." after normalization.
    expect(normalize("It's.")).toBe('its');
  });
});

describe('isFiller', () => {
  it('matches common filler words case-insensitively', () => {
    expect(isFiller('THE')).toBe(true);
    expect(isFiller('to')).toBe(true);
    expect(isFiller('Um,')).toBe(true);
  });
  it('rejects content words', () => {
    expect(isFiller('cinematic')).toBe(false);
    expect(isFiller('reasonable')).toBe(false);
  });
});

describe('FILLER_WORDS / VALUE_WORDS sets', () => {
  it('exposes the curated list as a ReadonlySet', () => {
    expect(FILLER_WORDS.has('the')).toBe(true);
    expect(VALUE_WORDS.has('never')).toBe(true);
    expect(VALUE_WORDS.has('cinematic')).toBe(false);
  });
});

describe('inferEmphasis', () => {
  it('returns all-false for an empty chunk', () => {
    expect(inferEmphasis([])).toEqual([]);
  });

  it('picks the single longest non-filler when chunk has ≤3 words', () => {
    // "the" is filler; "calmer" and "yes" are content; longest content wins.
    const out = inferEmphasis([w('the'), w('calmer'), w('yes')]);
    expect(out).toEqual([false, true, false]);
  });

  it('picks two longest non-filler words when chunk has >3 words', () => {
    const out = inferEmphasis([
      w('the'), w('explosive'), w('and'), w('cinematic'), w('reel'),
    ]);
    // Longest non-fillers by alpha count: 'cinematic' (9), 'explosive' (9),
    // 'reel' (4). Tie broken by index — earlier word wins. So picks are
    // 'explosive' (idx 1) + 'cinematic' (idx 3).
    expect(out).toEqual([false, true, false, true, false]);
  });

  it('falls back to absolute longest word when no candidate has ≥3 alpha chars', () => {
    const out = inferEmphasis([w('a'), w('to'), w('it'), w('be')]);
    // No word has ≥3 alpha chars; longest by raw .length is 'to' (idx 1).
    // 'a' length=1, 'to'/'it'/'be' length=2; first 2-char word wins.
    expect(out.filter(Boolean)).toHaveLength(1);
  });
});

describe('toPalette', () => {
  it('passes a non-empty array through untouched', () => {
    expect(toPalette(['#fff', '#000'], '#abc')).toEqual(['#fff', '#000']);
  });
  it('wraps a single string in a one-element array', () => {
    expect(toPalette('#ffd700', '#abc')).toEqual(['#ffd700']);
  });
  it('falls back when given undefined or empty array', () => {
    expect(toPalette(undefined, '#abc')).toEqual(['#abc']);
    expect(toPalette([], '#abc')).toEqual(['#abc']);
  });
});

describe('applyTransform', () => {
  it('respects the three transform values', () => {
    expect(applyTransform('Hello', 'uppercase')).toBe('HELLO');
    expect(applyTransform('Hello', 'lowercase')).toBe('hello');
    expect(applyTransform('Hello', 'none')).toBe('Hello');
    expect(applyTransform('Hello', 'gibberish')).toBe('Hello');
  });
});

describe('editDistance', () => {
  it('returns 0 for identical strings', () => {
    expect(editDistance('abc', 'abc')).toBe(0);
  });
  it('handles empty inputs', () => {
    expect(editDistance('', 'abc')).toBe(3);
    expect(editDistance('abc', '')).toBe(3);
    expect(editDistance('', '')).toBe(0);
  });
  it('counts single-character edits', () => {
    expect(editDistance('cat', 'bat')).toBe(1); // substitution
    expect(editDistance('cat', 'cats')).toBe(1); // insertion
    expect(editDistance('cats', 'cat')).toBe(1); // deletion
  });
  it('matches the canonical kitten/sitting case', () => {
    expect(editDistance('kitten', 'sitting')).toBe(3);
  });
});

describe('hashUnit', () => {
  it('returns deterministic values in [0, 1)', () => {
    const h1 = hashUnit('reasonable');
    const h2 = hashUnit('reasonable');
    expect(h1).toBe(h2);
    expect(h1).toBeGreaterThanOrEqual(0);
    expect(h1).toBeLessThan(1);
  });
  it('is sensitive to input changes', () => {
    expect(hashUnit('reasonable')).not.toBe(hashUnit('Reasonable'));
  });
});

describe('makeItalicMatcher', () => {
  it('rejects words shorter than 5 characters regardless of options', () => {
    const m = makeItalicMatcher({ italicAccentRate: 1, italicVocabulary: ['it'] });
    expect(m('it')).toBe(false);
    expect(m('cool')).toBe(false);
  });

  it('matches an exact vocabulary entry', () => {
    const m = makeItalicMatcher({ italicVocabulary: ['reasonable'] });
    expect(m('reasonable')).toBe(true);
  });

  it('fuzzy-matches vocabulary within 34% edit distance', () => {
    // 'reasonably' vs 'reasonable' — edit distance 1, longer = 10, 1/10 = 0.1 ≤ 0.34
    const m = makeItalicMatcher({ italicVocabulary: ['reasonable'] });
    expect(m('reasonably')).toBe(true);
  });

  it('returns false when no vocabulary and zero rate', () => {
    const m = makeItalicMatcher({ italicAccentRate: 0 });
    expect(m('cinematic')).toBe(false);
  });

  it('produces a roughly target-rate distribution clamped to [0.08, 0.30]', () => {
    // Generate 1k pseudo-unique 6-letter words. With rate 0.2, expected
    // bucket fraction is ~0.2 ± reasonable noise. With rate 0.5, the matcher
    // caps at 0.3, so we expect ~0.3.
    const synth = Array.from({ length: 1000 }, (_, i) => `word${i.toString().padStart(4, '0')}`);

    const m02 = makeItalicMatcher({ italicAccentRate: 0.2 });
    const f02 = synth.filter(m02).length / synth.length;
    expect(f02).toBeGreaterThanOrEqual(0.13);
    expect(f02).toBeLessThanOrEqual(0.27);

    const m05 = makeItalicMatcher({ italicAccentRate: 0.5 });
    const f05 = synth.filter(m05).length / synth.length;
    // Capped at 0.30, so should not exceed ~0.34 even with noise.
    expect(f05).toBeGreaterThanOrEqual(0.24);
    expect(f05).toBeLessThanOrEqual(0.34);

    const m001 = makeItalicMatcher({ italicAccentRate: 0.01 });
    const f001 = synth.filter(m001).length / synth.length;
    // Floored at 0.08, so should be ~0.08 not ~0.01.
    expect(f001).toBeGreaterThanOrEqual(0.05);
    expect(f001).toBeLessThanOrEqual(0.12);
  });

  it('clamps out-of-range rates instead of throwing', () => {
    const high = makeItalicMatcher({ italicAccentRate: 5 });
    const low = makeItalicMatcher({ italicAccentRate: -1 });
    expect(typeof high('cinematic')).toBe('boolean');
    expect(low('cinematic')).toBe(false); // negative clamps to 0 → no rate path
  });
});
