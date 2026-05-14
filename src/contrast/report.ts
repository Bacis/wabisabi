// Contrast pass — Day 14 of the Director feature.
//
// Stitches Days 11-13 together: given a DirectorScript and a map of
// per-group sampled background colors (from Day 12 browser preview or
// Day 15 render-side ffmpeg+sharp pass), run the remediation cascade
// for each group and write the resulting fill / stroke / shadow /
// backplate values back into the group's overrides. Return both:
//   * the annotated script (renderer-ready)
//   * an array of ContrastReport per group (agent-surfaced rationale)
//
// The pass is a PURE FUNCTION: input script + bg samples → output script
// + reports. No I/O, no clocks, no API calls. The frame-sampling drive
// lives next to its source — browser-side Web Worker for the editor
// preview, Node-side ffmpeg+sharp for the render path.

import type { DirectorScript, SceneGroup } from '../shared/director/schema.js';
import { remediateContrast, type ContrastReport, type RemediationKind } from './remediate.js';

export type { ContrastReport, RemediationKind } from './remediate.js';

export type ContrastGroupReport = ContrastReport & {
  groupId: string;
};

export type ContrastPassInput = {
  script: DirectorScript;
  /** Map of groupId → sampled dominant background hex for that group's frame range. */
  backgroundByGroup: Record<string, string>;
  /**
   * Optional alternate emphasis palette. Used by remediateContrast's
   * 'palette-swap' stage. Defaults to [project.fill, project.emphasisFill]
   * so the cascade can swap brand-yellow for white or vice versa.
   */
  palette?: string[];
  /** Acceptable contrast ratio target — defaults to 4.5 (WCAG AA normal-text). */
  targetRatio?: number;
};

export type ContrastPassResult = {
  /** Script with `overrides.fill` / `overrides.emphasisFill` updated where remediation needed it. */
  script: DirectorScript;
  /** Per-group remediation report — agent surfaces this in its reply. */
  reports: ContrastGroupReport[];
};

// ---------------------------------------------------------------------------
// Effective fill for a group — walks the same cascade resolveWordContext
// will once Day 5's stub is filled in: project.emphasisFill → ROLE_DEFAULTS
// (omitted here, no remediation knob) → group.overrides.emphasisFill.

function effectiveEmphasisFill(group: SceneGroup, projectFill: string): string {
  return group.overrides?.emphasisFill ?? projectFill;
}

function withRemediation(group: SceneGroup, r: ContrastReport): SceneGroup {
  // Write the remediated emphasisFill back into the group's overrides so
  // the resolver picks it up. Stroke/shadow/backplate values stay on the
  // ContrastReport — the renderer reads those alongside the script.
  if (r.appliedRemediation === 'none' || r.appliedRemediation === 'stroke' || r.appliedRemediation === 'shadow') {
    // These remediations don't change the fill; the renderer applies the
    // stroke/shadow from the report directly.
    return group;
  }
  if (r.finalFillHex === effectiveEmphasisFill(group, '#ffffff')) {
    // No actual fill change — keep group untouched.
    return group;
  }
  return {
    ...group,
    overrides: {
      ...(group.overrides ?? {}),
      emphasisFill: r.finalFillHex,
    },
  };
}

// ---------------------------------------------------------------------------
// Public entry point.

export function runContrastPass(input: ContrastPassInput): ContrastPassResult {
  const { script, backgroundByGroup, targetRatio } = input;
  const projectFill = script.project.emphasisFill;
  const palette =
    input.palette ??
    Array.from(new Set([script.project.emphasisFill, script.project.fill]));

  const reports: ContrastGroupReport[] = [];
  const groups: SceneGroup[] = script.groups.map((g) => {
    const bg = backgroundByGroup[g.id];
    if (!bg) {
      // No sample for this group — skip; renderer falls back to brand fill.
      // We still emit a noop report so the agent UI can show "no sample".
      const fill = effectiveEmphasisFill(g, projectFill);
      reports.push({
        groupId: g.id,
        fillHex: fill,
        bgHex: '#unknown',
        appliedRemediation: 'none',
        finalFillHex: fill,
        originalContrast: NaN,
        finalContrast: NaN,
        notes: 'No background sample available — left fill unchanged.',
      });
      return g;
    }
    const fill = effectiveEmphasisFill(g, projectFill);
    const r = remediateContrast(fill, bg, { palette, targetRatio });
    reports.push({ groupId: g.id, ...r });
    return withRemediation(g, r);
  });

  return {
    script: { ...script, groups },
    reports,
  };
}

// Convenience: roll up the reports into a one-line agent reply addendum.
// The agent uses this when its "build me a reel" turn includes the
// contrast pass — "Yellow worked everywhere except group 3 (used the
// white fallback for readability)".
export function summarizeContrastReports(reports: ContrastGroupReport[]): string {
  const interesting = reports.filter(
    (r) => r.appliedRemediation !== 'none' && r.appliedRemediation !== 'stroke',
  );
  if (interesting.length === 0) return '';
  const lines = interesting.map((r) => {
    const id = r.groupId;
    switch (r.appliedRemediation) {
      case 'shadow':
        return `group ${id}: added stroke + shadow`;
      case 'backplate':
        return `group ${id}: placed a backplate`;
      case 'palette-swap':
        return `group ${id}: swapped fill to ${r.finalFillHex}`;
      case 'safe-fallback':
        return `group ${id}: fell back to safe ${r.finalFillHex}`;
      default:
        return `group ${id}: ${r.appliedRemediation}`;
    }
  });
  return `Contrast adjustments — ${lines.join('; ')}.`;
}
