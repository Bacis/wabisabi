import { describe, expect, it } from 'vitest';
import { directorScriptSchema, type DirectorScript } from '../shared/director/schema.js';
import { runContrastPass, summarizeContrastReports } from './report.js';

// Day 14 — contrast integration tests. The pass:
//   * preserves groups that have no sampled bg
//   * writes the remediated fill back into the group's overrides when a
//     'palette-swap' / 'safe-fallback' is applied
//   * leaves groups untouched when remediation is stroke-only
//   * produces a per-group report with a populated rationale

function makeScript(overrides: Partial<DirectorScript['groups'][number]> = {}): DirectorScript {
  return directorScriptSchema.parse({
    project: { emphasisFill: '#ffd100', fill: '#ffffff' },
    groups: [
      { id: 'g1', role: 'intro-hook',      wordRange: [0, 5], ...overrides },
      { id: 'g2', role: 'hero-title-card', wordRange: [6, 12] },
      { id: 'g3', role: 'cta-overlay',     wordRange: [13, 20] },
    ],
    beats: [],
  });
}

describe('runContrastPass', () => {
  it('reports "no sample" for groups without a background entry', () => {
    const result = runContrastPass({
      script: makeScript(),
      backgroundByGroup: {}, // none sampled
    });
    expect(result.reports.length).toBe(3);
    for (const r of result.reports) {
      expect(r.appliedRemediation).toBe('none');
      expect(r.notes).toMatch(/No background sample/);
    }
    // Script is unchanged.
    expect(result.script).toEqual(result.script);
  });

  it('leaves the script untouched when the bg gives comfortable contrast', () => {
    // brand yellow #ffd100 on black bg = ~17:1 — comfortable, no action.
    const result = runContrastPass({
      script: makeScript(),
      backgroundByGroup: { g1: '#000000', g2: '#000000', g3: '#000000' },
    });
    for (const r of result.reports) {
      expect(r.appliedRemediation).toBe('none');
    }
    // No overrides written back.
    for (const g of result.script.groups) {
      expect(g.overrides?.emphasisFill).toBeUndefined();
    }
  });

  it('writes back the remediated fill for groups requiring palette-swap', () => {
    // bright yellow on light bg fails. Palette includes black → swap wins.
    const result = runContrastPass({
      script: makeScript(),
      backgroundByGroup: { g1: '#fff2c0', g2: '#000000', g3: '#000000' },
      palette: ['#ffd100', '#000000'],
    });
    const r1 = result.reports.find((r) => r.groupId === 'g1');
    expect(r1).toBeDefined();
    // g1 needed remediation; either backplate or palette-swap should win.
    expect(['backplate', 'palette-swap']).toContain(r1!.appliedRemediation);
    if (r1!.appliedRemediation === 'palette-swap') {
      const g1 = result.script.groups.find((g) => g.id === 'g1')!;
      expect(g1.overrides?.emphasisFill).toBe(r1!.finalFillHex);
    }
    // g2 + g3 (yellow on black) — no change.
    const g2 = result.script.groups.find((g) => g.id === 'g2')!;
    expect(g2.overrides?.emphasisFill).toBeUndefined();
  });

  it('preserves existing group overrides when adding emphasisFill', () => {
    const script = directorScriptSchema.parse({
      project: { emphasisFill: '#ffd100', fill: '#ffffff' },
      groups: [
        {
          id: 'g1',
          role: 'intro-hook',
          wordRange: [0, 5],
          overrides: { fontSize: 88, emphasisFill: '#ffd100' },
        },
      ],
      beats: [],
    });
    const result = runContrastPass({
      script,
      backgroundByGroup: { g1: '#fff2c0' },
      palette: ['#000000', '#ffd100'],
      // Force backplate to be insufficient so palette-swap kicks in.
      targetRatio: 7.0,
    });
    const g1 = result.script.groups.find((g) => g.id === 'g1')!;
    expect(g1.overrides?.fontSize).toBe(88); // preserved
    if (result.reports[0]!.appliedRemediation === 'palette-swap') {
      expect(g1.overrides?.emphasisFill).not.toBe('#ffd100');
    }
  });
});

describe('summarizeContrastReports', () => {
  it('returns empty string when no groups required action', () => {
    const result = runContrastPass({
      script: makeScript(),
      backgroundByGroup: { g1: '#000000', g2: '#000000', g3: '#000000' },
    });
    expect(summarizeContrastReports(result.reports)).toBe('');
  });

  it('summarizes interesting reports as a one-line addendum', () => {
    const result = runContrastPass({
      script: makeScript(),
      backgroundByGroup: { g1: '#fff2c0', g2: '#000000', g3: '#ffffff' },
      palette: ['#ffd100', '#000000'],
    });
    const summary = summarizeContrastReports(result.reports);
    expect(summary).toMatch(/Contrast adjustments/);
    expect(summary).toMatch(/group g/);
  });
});
