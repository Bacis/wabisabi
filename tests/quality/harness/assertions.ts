// Reusable assertion helpers. Each takes a SceneGroup + the assertion
// payload and returns { ok, reason } so the grader can collect a
// machine-readable report. Pure functions; no test framework imports.

import type { Assertion, GroupMatcher, SceneGroup } from './types.js';
import type { DirectorScript } from '../../../src/shared/director/schema.js';

export type CheckResult = { ok: true } | { ok: false; reason: string };

export function findGroup(script: DirectorScript, m: GroupMatcher): SceneGroup | null {
  if (m.wordRangeContains !== undefined) {
    const idx = m.wordRangeContains;
    return (
      script.groups.find((g) => idx >= g.wordRange[0] && idx <= g.wordRange[1]) ?? null
    );
  }
  if (m.roleIn && m.roleIn.length > 0) {
    return script.groups.find((g) => m.roleIn!.includes(g.role)) ?? null;
  }
  return null;
}

export function checkAssertion(group: SceneGroup, a: Assertion): CheckResult {
  switch (a.kind) {
    case 'role-in':
      return a.values.includes(group.role)
        ? { ok: true }
        : { ok: false, reason: `role "${group.role}" not in [${a.values.join(', ')}]` };

    case 'placement-anchor': {
      const got = group.placement?.anchor;
      return got === a.equals
        ? { ok: true }
        : { ok: false, reason: `placement.anchor "${got ?? 'unset'}" != "${a.equals}"` };
    }

    case 'placement-alignment': {
      const got = group.placement?.alignment;
      return got === a.equals
        ? { ok: true }
        : { ok: false, reason: `placement.alignment "${got ?? 'unset'}" != "${a.equals}"` };
    }

    case 'max-per-line': {
      const got = group.maxPerLine;
      return got === a.equals
        ? { ok: true }
        : { ok: false, reason: `maxPerLine ${got ?? 'unset'} != ${a.equals}` };
    }

    case 'font-size-min': {
      const got = group.overrides?.fontSize;
      if (got === undefined) {
        return { ok: false, reason: `overrides.fontSize unset (min ${a.min})` };
      }
      return got >= a.min
        ? { ok: true }
        : { ok: false, reason: `overrides.fontSize ${got} < min ${a.min}` };
    }

    case 'casing': {
      const got = group.overrides?.casing;
      return got === a.equals
        ? { ok: true }
        : { ok: false, reason: `casing "${got ?? 'unset'}" != "${a.equals}"` };
    }

    case 'layout-strategy': {
      const got = group.layoutStrategy;
      return got === a.equals
        ? { ok: true }
        : { ok: false, reason: `layoutStrategy "${got ?? 'unset'}" != "${a.equals}"` };
    }

    case 'audio-pattern-type': {
      const got = group.audioPattern?.type;
      return got === a.equals
        ? { ok: true }
        : { ok: false, reason: `audioPattern.type "${got ?? 'unset'}" != "${a.equals}"` };
    }

    case 'audio-cue-present':
      return group.audioCue
        ? { ok: true }
        : { ok: false, reason: 'audioCue unset' };

    case 'motion-preset-equals': {
      // The DirectorScript schema doesn't carry a motion-preset field on
      // groups today. Reading from layoutParams.motion as a forward-compat
      // probe so this assertion can flip green once the field lands.
      const got = (group.layoutParams as { motion?: string } | undefined)?.motion;
      return got === a.equals
        ? { ok: true }
        : { ok: false, reason: `layoutParams.motion "${got ?? 'unset'}" != "${a.equals}"` };
    }

    case 'font-family-override': {
      const got = group.overrides?.font;
      if (got === undefined) {
        return { ok: false, reason: 'overrides.font unset' };
      }
      const lower = got.toLowerCase();
      return a.anyOf.some((needle) => lower.includes(needle.toLowerCase()))
        ? { ok: true }
        : { ok: false, reason: `overrides.font "${got}" doesn't match any of [${a.anyOf.join(', ')}]` };
    }
  }
}

export function checkGlobal(
  script: DirectorScript,
  path: string,
  equals: unknown,
): CheckResult {
  const parts = path.split('.');
  let cur: unknown = script;
  for (const p of parts) {
    if (!cur || typeof cur !== 'object') {
      return { ok: false, reason: `${path}: traversal failed at "${p}"` };
    }
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur === equals
    ? { ok: true }
    : { ok: false, reason: `${path} "${String(cur)}" != "${String(equals)}"` };
}
