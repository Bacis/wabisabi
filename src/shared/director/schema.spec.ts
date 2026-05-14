import { describe, expect, it } from 'vitest';
import { directorScriptSchema } from './schema.js';
import { ROLE_DEFAULTS } from './roleDefaults.js';
import { SONIC_MOTION_MAP } from './sonicMap.js';
import {
  AUDIO_PATTERN_TYPES,
  GROUP_ROLES,
  LAYOUT_STRATEGIES,
  RENDERER_READY_STRATEGIES,
  SONIC_GESTURES,
  roleFamily,
} from './vocabularies.js';

// Day 6 — DirectorScript schema, vocabulary, and lookup-table tests.

describe('vocabularies', () => {
  it('groupRole has exactly 10 entries', () => {
    expect(GROUP_ROLES.length).toBe(10);
  });

  it('layoutStrategy mirrors the renderer-side closed set', () => {
    expect(LAYOUT_STRATEGIES.length).toBe(8);
  });

  it('sonicGesture has exactly 16 entries (matches spec vocab)', () => {
    expect(SONIC_GESTURES.length).toBe(16);
  });

  it('audioPatternType has the 4 spec-defined patterns', () => {
    expect([...AUDIO_PATTERN_TYPES]).toEqual([
      'typewriter',
      'tick-per-word',
      'sustained-drone',
      'rise-build',
    ]);
  });

  it('roleFamily covers every group role', () => {
    for (const role of GROUP_ROLES) {
      expect(() => roleFamily(role)).not.toThrow();
    }
  });

  it('RENDERER_READY_STRATEGIES matches the v1 ship set', () => {
    expect([...RENDERER_READY_STRATEGIES].sort()).toEqual(
      ['cascade-stack', 'lower-third', 'single-line-flow'].sort(),
    );
  });
});

describe('lookup tables', () => {
  it('ROLE_DEFAULTS has an entry per group role', () => {
    for (const role of GROUP_ROLES) {
      expect(ROLE_DEFAULTS[role]).toBeDefined();
      expect(LAYOUT_STRATEGIES).toContain(ROLE_DEFAULTS[role].layoutStrategy);
    }
  });

  it('SONIC_MOTION_MAP has an entry per sonic gesture', () => {
    for (const gesture of SONIC_GESTURES) {
      expect(SONIC_MOTION_MAP[gesture]).toBeDefined();
      const m = SONIC_MOTION_MAP[gesture];
      expect(m.intensity).toBeGreaterThanOrEqual(0);
      expect(m.intensity).toBeLessThanOrEqual(1);
      expect(m.spring.damping).toBeGreaterThan(0);
      expect(m.spring.stiffness).toBeGreaterThan(0);
    }
  });
});

describe('directorScriptSchema — happy path', () => {
  it('parses the andrius-canonical 5-group script shape', () => {
    const script = {
      project: {},
      groups: [
        { id: 'g1', role: 'intro-hook',      wordRange: [0, 4] },
        { id: 'g2', role: 'hero-title-card', wordRange: [5, 12] },
        { id: 'g3', role: 'backstory-beat',  wordRange: [13, 25] },
        { id: 'g4', role: 'enumerated-list', wordRange: [26, 40] },
        { id: 'g5', role: 'cta-overlay',     wordRange: [41, 48] },
      ],
      beats: [
        { id: 'b1', groupId: 'g4', wordRange: [27, 28] },
      ],
    };
    const parsed = directorScriptSchema.parse(script);
    expect(parsed.groups.length).toBe(5);
    // project defaults applied
    expect(parsed.project.fill).toBe('#ffffff');
    expect(parsed.project.emphasisFill).toBe('#ffd100');
    // group default relation is a hard cut
    expect(parsed.groups[0]!.relation).toEqual({ kind: 'cut' });
    // beat default relation is isolate
    expect(parsed.beats[0]!.relation).toEqual({ kind: 'isolate' });
  });

  it('accepts a script with no beats', () => {
    const got = directorScriptSchema.parse({
      groups: [{ id: 'g1', role: 'intro-hook', wordRange: [0, 4] }],
    });
    expect(got.beats).toEqual([]);
  });

  it('accepts placement, audioCue, and audioPattern on a group', () => {
    const got = directorScriptSchema.parse({
      groups: [
        {
          id: 'g1',
          role: 'cta-overlay',
          wordRange: [0, 20],
          placement: { anchor: 'bottom', alignment: 'center', offsetY: 0.05 },
          audioCue: { gesture: 'pop', volume: 0.5 },
          audioPattern: { type: 'typewriter', params: { intervalMs: 100 } },
        },
      ],
    });
    expect(got.groups[0]!.placement?.anchor).toBe('bottom');
    expect(got.groups[0]!.audioCue?.gesture).toBe('pop');
    expect(got.groups[0]!.audioPattern?.type).toBe('typewriter');
  });
});

describe('directorScriptSchema — superRefine violations', () => {
  it('rejects overlapping group word ranges', () => {
    const res = directorScriptSchema.safeParse({
      groups: [
        { id: 'g1', role: 'intro-hook', wordRange: [0, 5] },
        { id: 'g2', role: 'hero-title-card', wordRange: [5, 10] }, // overlap on 5
      ],
    });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues[0]!.message).toMatch(/overlaps/);
    }
  });

  it('rejects a beat whose groupId references no group', () => {
    const res = directorScriptSchema.safeParse({
      groups: [{ id: 'g1', role: 'intro-hook', wordRange: [0, 5] }],
      beats: [{ id: 'b1', groupId: 'g-ghost', wordRange: [0, 1] }],
    });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues.some((i) => /unknown group/.test(i.message))).toBe(true);
    }
  });

  it('rejects a beat whose word range exits its parent group', () => {
    const res = directorScriptSchema.safeParse({
      groups: [{ id: 'g1', role: 'intro-hook', wordRange: [0, 5] }],
      beats: [{ id: 'b1', groupId: 'g1', wordRange: [4, 8] }], // 8 > 5
    });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues.some((i) => /not contained/.test(i.message))).toBe(true);
    }
  });

  it('rejects an invalid wordRange where start > end', () => {
    const res = directorScriptSchema.safeParse({
      groups: [{ id: 'g1', role: 'intro-hook', wordRange: [5, 2] }],
    });
    expect(res.success).toBe(false);
  });

  it('rejects an unknown role', () => {
    const res = directorScriptSchema.safeParse({
      groups: [{ id: 'g1', role: 'bogus-role', wordRange: [0, 5] }],
    });
    expect(res.success).toBe(false);
  });

  it('rejects an unknown sonic gesture', () => {
    const res = directorScriptSchema.safeParse({
      groups: [
        {
          id: 'g1',
          role: 'intro-hook',
          wordRange: [0, 5],
          audioCue: { gesture: 'kaboom' },
        },
      ],
    });
    expect(res.success).toBe(false);
  });
});
