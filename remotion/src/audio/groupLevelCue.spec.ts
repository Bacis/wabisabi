import { describe, expect, it } from 'vitest';
import { directorScriptSchema } from '../../../src/shared/director/schema.js';
import { beatLevelCue, groupLevelCue } from './groupLevelCue';

const fps = 30;
const wordStartTimesSec = [0, 0.5, 1.0, 1.5, 2.0];

describe('groupLevelCue', () => {
  it('returns null when the group has no audioCue', () => {
    const s = directorScriptSchema.parse({
      project: {},
      groups: [{ id: 'g', role: 'intro-hook', wordRange: [0, 2] }],
      beats: [],
    });
    expect(groupLevelCue({ group: s.groups[0]!, wordStartTimesSec, fps })).toBeNull();
  });

  it('emits a cue at the group\'s first word', () => {
    const s = directorScriptSchema.parse({
      project: {},
      groups: [
        {
          id: 'g-cta',
          role: 'cta-overlay',
          wordRange: [2, 4],
          audioCue: { gesture: 'pop' },
        },
      ],
      beats: [],
    });
    const c = groupLevelCue({ group: s.groups[0]!, wordStartTimesSec, fps });
    expect(c).not.toBeNull();
    // wordRange[0] = 2 → wordStartTimesSec[2] = 1.0s → frame 30
    expect(c!.startFrame).toBe(30);
    expect(c!.source).toBe('group');
    expect(c!.volume).toBeCloseTo(0.4, 6);
  });

  it('honors audioCue.offsetMs (negative anticipates, positive delays)', () => {
    const s = directorScriptSchema.parse({
      project: {},
      groups: [
        {
          id: 'g',
          role: 'intro-hook',
          wordRange: [0, 2],
          audioCue: { gesture: 'thud', offsetMs: -100 },
        },
      ],
      beats: [],
    });
    const c = groupLevelCue({ group: s.groups[0]!, wordStartTimesSec, fps });
    // -100ms at 30fps = -3 frames; clamped to 0 by CueLayer's max().
    expect(c!.startFrame).toBe(-3);
  });

  it('honors volume override', () => {
    const s = directorScriptSchema.parse({
      project: {},
      groups: [
        {
          id: 'g',
          role: 'intro-hook',
          wordRange: [0, 2],
          audioCue: { gesture: 'shimmer', volume: 0.9 },
        },
      ],
      beats: [],
    });
    const c = groupLevelCue({ group: s.groups[0]!, wordStartTimesSec, fps });
    expect(c!.volume).toBeCloseTo(0.9, 6);
  });
});

describe('beatLevelCue', () => {
  it('emits a cue at the beat\'s wordRange[0]', () => {
    const s = directorScriptSchema.parse({
      project: {},
      groups: [{ id: 'g', role: 'intro-hook', wordRange: [0, 4] }],
      beats: [
        { id: 'b1', groupId: 'g', wordRange: [3, 3], audioCue: { gesture: 'snap' } },
      ],
    });
    const c = beatLevelCue({ beat: s.beats[0]!, wordStartTimesSec, fps });
    expect(c).not.toBeNull();
    // wordRange[0] = 3 → wordStartTimesSec[3] = 1.5s → frame 45
    expect(c!.startFrame).toBe(45);
    expect(c!.source).toBe('beat');
    expect(c!.volume).toBeCloseTo(0.6, 6);
  });

  it('returns null when the beat has no audioCue', () => {
    const s = directorScriptSchema.parse({
      project: {},
      groups: [{ id: 'g', role: 'intro-hook', wordRange: [0, 4] }],
      beats: [{ id: 'b1', groupId: 'g', wordRange: [0, 0] }],
    });
    expect(beatLevelCue({ beat: s.beats[0]!, wordStartTimesSec, fps })).toBeNull();
  });
});
