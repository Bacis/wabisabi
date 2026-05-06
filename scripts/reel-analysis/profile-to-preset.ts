#!/usr/bin/env tsx
/**
 * Convert an auto-extracted style profile into a complete drop-in preset
 * (refined_preset.json) that can be used directly with the reel-clone
 * renderer or registered in src/shared/presets.ts.
 *
 * This is the closing-the-loop step: OCR analysis → styleSpec.
 *
 * Usage:
 *   tsx scripts/reel-analysis/profile-to-preset.ts --slug DXhn5HNhTxy
 *   tsx scripts/reel-analysis/profile-to-preset.ts --slug DXhn5HNhTxy --out runs/DXhn5HNhTxy/auto_preset.json
 */
try { process.loadEnvFile(); } catch {}

import { readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import type { StyleProfile } from './lib/feature-extract.js';

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

const slug = arg('slug');
if (!slug) { console.error('--slug required'); process.exit(1); }
const runDir = resolve('scripts/reel-analysis/runs', slug);
const outPath = arg('out', join(runDir, 'auto_preset.json'))!;
const profile: StyleProfile = JSON.parse(
  readFileSync(join(runDir, 'style-profile.json'), 'utf-8'),
);

// ----------------------------------------------------------------------------
// Mapping helpers
// ----------------------------------------------------------------------------
const NAMED_HEX: Record<string, string> = {
  white: '#ffffff',
  black: '#000000',
  red: '#ff2a2a',
  yellow: '#ffd700',
  green: '#3cd456',
  blue: '#3c64e6',
  purple: '#b450dc',
  orange: '#f08228',
  gray: '#808080',
};

function hexFor(name: string): string {
  return NAMED_HEX[name] ?? '#ffffff';
}

// ----------------------------------------------------------------------------
// Derive each styleSpec field from profile metrics with sensible fallbacks.
// ----------------------------------------------------------------------------

// 1. Default fill color
const fillHex = hexFor(profile.dominant_color);

// 2. Emphasis palette — convert each detected emphasis color to its hex.
//    If multiple emphasis colors detected, enable multi-color cycling.
const emphasisHex = profile.emphasis_colors.map(hexFor);
const useMultiColor = emphasisHex.length >= 2;
// Fallback: if no emphasis colors detected, keep red as a sensible default
// (no harm — emphasis flags simply won't fire if the captionPlan has none).
const emphasisFill = emphasisHex.length > 0 ? emphasisHex : ['#ff2a2a'];

// 3. Cascade ratios. p25 / p95 of font heights gives a robust top/bottom
//    ratio — top-line size vs anchor size. Clamp to a sensible range.
const cascadeTopRatio = profile.cascade_detected
  ? Math.max(0.4, Math.min(0.9,
      profile.font_heights.p95 > 0
        ? profile.font_heights.p25 / profile.font_heights.p95
        : 0.55))
  : 1.0;
const cascadeBottomRatio = 1.0;

// 4. Anchor font size — use measured anchor (p95) height as the nominal
//    size. ReelClone scales by frameWidth/1080. The width-fit code path
//    inflates anchor words to fill the line, so base size is the cascade
//    *bottom* size. We use p95 directly — that IS the anchor height.
//    For non-anchor cascade words, the renderer multiplies by cascadeTopRatio.
const fontSize = Math.round(profile.font_heights.p95);

// 4b. emphasisFillRatio — derived from how much of the line anchor words
//     actually occupy in the source. anchor_width_pct is median (anchor word
//     bbox width) / (frame width). The renderer's fillRatio is a fraction of
//     usable_width = frame_width * maxWidthPercent/100. Convert.
const maxWidthPercent = 80;
const fillRatio = profile.anchor_width_pct > 0
  ? Math.max(0.5, Math.min(0.98,
      profile.anchor_width_pct / (maxWidthPercent / 100)))
  : 0.85;

// 5. Position
const position = profile.pos_y_band;
//   safeMargin: heuristic — closer to edge for top/bottom bands, neutral
//   for middle. 0.18 was the v7 default and matches typical reels.
const safeMargin = position === 'middle' ? 0.10 : 0.18;

// 6. Word reveal mode
const wordReveal: 'progressive' | 'all' =
  profile.progressive_reveal_score > 0.2 ? 'progressive' : 'all';

// 7. Emphasis case behavior. We always set emphasisStyle:'block' when there
//    is any emphasis usage — the renderer's position-aware logic decides at
//    runtime whether to apply uppercase (anchor lines) or keep lowercase
//    (mid-stack inline emphasis).
const upperCount = profile.emphasis_case?.upper ?? 0;
const lowerCount = profile.emphasis_case?.lower ?? 0;
const hasUpperEmphasis = upperCount > 0;
const emphasisStyle: 'block' | 'inline-color' = hasUpperEmphasis ? 'block' : 'inline-color';

// 8. Italic accent rate — fraction of long content-emphasis words in the
//    source that were rendered italic. Generic style attribute that
//    transfers to ANY input video: at render time, the renderer picks
//    a deterministic subset of qualifying words to italicize at this rate.
//    Replaces the older reel-specific `italicVocabulary` (which only worked
//    on videos whose transcript happened to contain the same words).
const italicAccentRate: number = profile.italic_rate ?? 0;

// ----------------------------------------------------------------------------
// Assemble the preset
// ----------------------------------------------------------------------------
const preset = {
  id: `reel-${slug}-auto`,
  name: `Reel ${slug} (Auto-extracted v1)`,
  description:
    `Auto-derived from OCR analysis of source reel. Extracted style: ` +
    `${profile.dominant_color} default, emphasis=${profile.emphasis_colors.join('+') || 'none'}, ` +
    `${profile.cascade_detected ? `cascade(${cascadeTopRatio.toFixed(2)}→1.0)` : 'no cascade'}, ` +
    `${wordReveal} reveal, position=${position}.`,
  templateId: 'reel-clone',
  styleSpec: {
    font: {
      family: 'Inter',
      weight: 900,
      size: fontSize,
      letterSpacing: -2,
      textTransform: 'lowercase',
    },
    color: {
      fill: fillHex,
      strokeWidth: 0,
      emphasisFill: emphasisFill.length === 1 ? emphasisFill[0] : emphasisFill,
    },
    layout: {
      position,
      safeMargin,
      maxWordsPerLine: 3,
      align: 'left',
    },
    // Empirical char-advance for the source's font/letterSpacing combo.
    // Used by the renderer's maxSizeForWord(len) to convert font-size to
    // expected glyph-width without under-shooting (default 0.58 was too
    // conservative for Inter Black with tight tracking).
    charAdvance: profile.char_advance ?? 0.58,
    animation: {
      preset: 'karaoke',
      tailMs: 200,
      scaleFrom: wordReveal === 'progressive' ? 0.7 : 1.0,
      durationMs: 140,
    },
    reel: {
      emphasisStyle,
      emphasisFillRatio: Number(fillRatio.toFixed(2)),
      emphasisMaxHeightRatio: 0.16,
      fillerSizeMultiplier: 1,
      emphasisTextTransform: emphasisStyle === 'block' ? 'uppercase' : 'lowercase',
      fillerTextTransform: 'lowercase',
      mediumTextTransform: 'lowercase',
      emphasisWeight: 900,
      wordReveal,
      inferEmphasis: false,
      columnGapRatio: 0.18,
      rowGapRatio: 0.04,
      maxWidthPercent: 80,
      paddingPercent: 6,
      cascadeTopRatio,
      cascadeBottomRatio,
      multiColorEmphasis: useMultiColor,
      italicAccentRate,
    },
  },
};

writeFileSync(outPath, JSON.stringify(preset, null, 2));

console.log(`\n=== auto-extracted preset: ${slug} ===\n`);
console.log(`source profile inputs:`);
console.log(`  dominant color:          ${profile.dominant_color}`);
console.log(`  emphasis colors:         ${profile.emphasis_colors.join(', ') || '(none)'}`);
console.log(`  font heights p25/p50/p95: ${profile.font_heights.p25}/${profile.font_heights.p50}/${profile.font_heights.p95}`);
console.log(`  cascade detected:        ${profile.cascade_detected} (top=${cascadeTopRatio.toFixed(2)})`);
console.log(`  position band:           ${profile.pos_y_band}`);
console.log(`  reveal score:            ${profile.progressive_reveal_score}`);
console.log(`\nderived spec:`);
console.log(`  font.size:               ${fontSize}`);
console.log(`  color.fill:              ${fillHex}`);
console.log(`  color.emphasisFill:      ${JSON.stringify(emphasisFill)}`);
console.log(`  layout.position:         ${position}`);
console.log(`  layout.safeMargin:       ${safeMargin}`);
console.log(`  reel.cascadeTopRatio:    ${cascadeTopRatio.toFixed(2)}`);
console.log(`  reel.emphasisFillRatio:  ${fillRatio.toFixed(2)} (anchor_width_pct=${profile.anchor_width_pct})`);
console.log(`  charAdvance:             ${(profile.char_advance ?? 0.58).toFixed(2)}`);
console.log(`  reel.wordReveal:         ${wordReveal}`);
console.log(`  reel.emphasisStyle:      ${emphasisStyle}`);
console.log(`  reel.multiColorEmphasis: ${useMultiColor}`);
console.log(`  italicAccentRate:        ${italicAccentRate} (${(italicAccentRate*100).toFixed(0)}% of qualifying emphasis words)`);
console.log(`  italic_words sample:     ${(profile.italic_words ?? []).join(', ') || '(none)'}`);
console.log(`\nwritten to: ${outPath}`);
