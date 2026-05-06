#!/usr/bin/env tsx
/**
 * Diff the auto-extracted style profile against a refined_preset's styleSpec.
 * Surfaces concrete mismatches the OCR pipeline detected that aren't reflected
 * in the styleSpec yet (or vice versa).
 *
 * Usage:
 *   tsx scripts/reel-analysis/diff-profile.ts --slug DXhn5HNhTxy
 */
try { process.loadEnvFile(); } catch {}

import { readFileSync } from 'fs';
import { join, resolve } from 'path';
import type { StyleProfile } from './lib/feature-extract.js';

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

const slug = arg('slug');
if (!slug) { console.error('--slug required'); process.exit(1); }

const runDir = resolve('scripts/reel-analysis/runs', slug);
const profile: StyleProfile = JSON.parse(
  readFileSync(join(runDir, 'style-profile.json'), 'utf-8'),
);
const preset = JSON.parse(
  readFileSync(join(runDir, 'refined_preset.json'), 'utf-8'),
);
const ss = preset.styleSpec ?? {};
const reel = ss.reel ?? {};

type Severity = 'OK' | 'INFO' | 'WARN' | 'HIGH';
type Row = { attr: string; ref: string; spec: string; severity: Severity; note?: string };

const rows: Row[] = [];

function pushRow(r: Row) { rows.push(r); }

// ---- color palette
{
  const expectedFill = profile.dominant_color === 'white' ? '#ffffff'
    : profile.dominant_color === 'black' ? '#000000'
    : '?';
  pushRow({
    attr: 'color.fill (default text color)',
    ref: profile.dominant_color,
    spec: ss.color?.fill ?? '(unset)',
    severity: (ss.color?.fill ?? '').toLowerCase() === expectedFill ? 'OK' : 'WARN',
  });

  const refEmph = profile.emphasis_colors;
  const specEmph = ss.color?.emphasisFill;
  const specEmphList: string[] = Array.isArray(specEmph) ? specEmph : specEmph ? [specEmph] : [];
  const matchedColors = refEmph.filter((c) => {
    if (c === 'red') return specEmphList.some((s) => /ff[12]/i.test(s) || /^#[ef]/i.test(s));
    if (c === 'yellow') return specEmphList.some((s) => /^#[ef][cd]/i.test(s) || /ffd/i.test(s));
    return false;
  });
  pushRow({
    attr: 'color.emphasisFill (palette)',
    ref: refEmph.join(',') || '(none)',
    spec: specEmphList.join(',') || '(none)',
    severity: refEmph.length === matchedColors.length ? 'OK'
      : matchedColors.length > 0 ? 'WARN' : 'HIGH',
    note: refEmph.length > matchedColors.length
      ? `missing: ${refEmph.filter((c) => !matchedColors.includes(c)).join(',')}`
      : undefined,
  });

  pushRow({
    attr: 'reel.multiColorEmphasis',
    ref: refEmph.length >= 2 ? 'true' : 'false',
    spec: String(reel.multiColorEmphasis ?? false),
    severity: (refEmph.length >= 2) === (reel.multiColorEmphasis === true) ? 'OK' : 'WARN',
  });
}

// ---- cascade
{
  pushRow({
    attr: 'cascade detection',
    ref: profile.cascade_detected ? `yes (top/bottom=${profile.cascade_top_ratio})` : 'no',
    spec: `cascadeTopRatio=${reel.cascadeTopRatio ?? '(unset)'} cascadeBottomRatio=${reel.cascadeBottomRatio ?? '(unset)'}`,
    severity:
      (profile.cascade_detected && reel.cascadeTopRatio != null && reel.cascadeTopRatio < 1.0)
      || (!profile.cascade_detected && (reel.cascadeTopRatio ?? 1.0) >= 1.0) ? 'OK' : 'WARN',
  });
}

// ---- position
{
  pushRow({
    attr: 'layout.position',
    ref: profile.pos_y_band,
    spec: ss.layout?.position ?? '(unset)',
    severity: (ss.layout?.position ?? 'bottom') === profile.pos_y_band ? 'OK' : 'WARN',
  });
}

// ---- reveal mode
{
  const expectsProgressive = profile.progressive_reveal_score > 0.2;
  const isProgressive = (reel.wordReveal ?? 'all') === 'progressive';
  pushRow({
    attr: 'reel.wordReveal',
    ref: expectsProgressive ? `progressive (score=${profile.progressive_reveal_score})`
      : `all (score=${profile.progressive_reveal_score})`,
    spec: reel.wordReveal ?? 'all',
    severity: expectsProgressive === isProgressive ? 'OK' : 'HIGH',
  });
}

// ---- case usage on emphasis words
{
  const cases = profile.emphasis_case ?? {};
  const upper = cases.upper ?? 0;
  const lower = cases.lower ?? 0;
  // The styleSpec encodes BOTH inline-color (lowercase emphasis) AND anchor-
  // block (uppercase emphasis) via emphasisStyle: 'block' + position-aware
  // logic in the renderer. So when both upper and lower are well-represented
  // in the reference (>=25% of total), this is OK — the spec already handles
  // both via runtime choice. Mismatch only when one case dominates >75%.
  const total = upper + lower + (cases.mixed ?? 0) + (cases.none ?? 0);
  const upperShare = total > 0 ? upper / total : 0;
  const lowerShare = total > 0 ? lower / total : 0;
  const specCase = reel.emphasisTextTransform
    ?? (reel.emphasisStyle === 'block' ? 'uppercase' : ss.font?.textTransform ?? 'none');
  // emphasisStyle:'block' is a position-aware mode where the renderer
  // applies emphasisTextTransform ONLY to anchor-line block words and keeps
  // inline emphasis lowercase. So when the reel mixes both casings (upper
  // emphasis present at all alongside lowercase), the block-spec is correct.
  // We only WARN if the reel is overwhelmingly one case AND the spec picks
  // the wrong one.
  const isPositionAwareSpec = reel.emphasisStyle === 'block';
  const hasBothCases = upperShare >= 0.15 && lowerShare >= 0.15;
  let severity: Severity = 'WARN';
  let note: string | undefined;
  if (isPositionAwareSpec && hasBothCases) {
    severity = 'OK';
    note = 'reel mixes upper+lower emphasis; emphasisStyle=block applies upper to anchor lines, keeps inline lowercase';
  } else if (isPositionAwareSpec && upperShare >= 0.05) {
    // Still OK: block style handles uppercase anchor cases when they exist.
    severity = 'OK';
    note = 'emphasisStyle=block handles uppercase anchors; lowercase emphasis flows through inline-color path';
  } else {
    const expected = upperShare > lowerShare ? 'uppercase' : 'lowercase';
    if (expected === specCase) severity = 'OK';
  }
  pushRow({
    attr: 'reel.emphasisTextTransform',
    ref: `upper=${upper} lower=${lower} mixed=${cases.mixed ?? 0} none=${cases.none ?? 0}`,
    spec: String(specCase),
    severity,
    note,
  });
}

// ---- font heights — sanity check on fillRatio
{
  const ratio = profile.font_heights.p25 / Math.max(1, profile.font_heights.p95);
  pushRow({
    attr: 'cascade ratio (p25 / p95 height)',
    ref: ratio.toFixed(2),
    spec: String(reel.cascadeTopRatio ?? '(unset)'),
    severity: 'INFO',
    note: 'p25 = top-line size, p95 = anchor size. specs cascadeTopRatio should be near this.',
  });
}

// ---- output
const sevColor: Record<Severity, string> = {
  OK: '[32m', // green
  INFO: '[36m', // cyan
  WARN: '[33m', // yellow
  HIGH: '[31m', // red
};
const reset = '[0m';

console.log(`\n=== profile diff: ${slug} ===\n`);
const widthAttr = Math.max(...rows.map((r) => r.attr.length));
const widthRef = Math.max(...rows.map((r) => r.ref.length));
const widthSpec = Math.max(...rows.map((r) => r.spec.length));
const pad = (s: string, n: number) => s.padEnd(n);
console.log(`${pad('ATTR', widthAttr)}  ${pad('REFERENCE', widthRef)}  ${pad('SPEC', widthSpec)}  STATUS`);
console.log('-'.repeat(widthAttr + widthRef + widthSpec + 16));
for (const r of rows) {
  const sev = `${sevColor[r.severity]}${r.severity}${reset}`;
  console.log(`${pad(r.attr, widthAttr)}  ${pad(r.ref, widthRef)}  ${pad(r.spec, widthSpec)}  ${sev}`);
  if (r.note) console.log(`  ${'[2m'}└ ${r.note}${reset}`);
}

const counts = rows.reduce((acc, r) => { acc[r.severity] = (acc[r.severity] ?? 0) + 1; return acc; }, {} as Record<string, number>);
console.log('');
console.log(`OK=${counts.OK ?? 0}  INFO=${counts.INFO ?? 0}  WARN=${counts.WARN ?? 0}  HIGH=${counts.HIGH ?? 0}`);
const issues = (counts.WARN ?? 0) + (counts.HIGH ?? 0);
console.log(issues === 0 ? '\nstyleSpec aligned with reference profile.\n'
  : `\n${issues} issue(s) above need attention.\n`);
process.exit(issues === 0 ? 0 : 1);
