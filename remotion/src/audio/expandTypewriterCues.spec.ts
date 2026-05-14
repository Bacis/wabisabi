import { describe, expect, it } from 'vitest';
import { directorScriptSchema } from '../../../src/shared/director/schema.js';
import { expandTypewriterCues } from './expandTypewriterCues';

// Day 19 — typewriter cue expansion tests. Sub-frame timing strategy 1
// (snap visuals to audio): chars land at integer-frame boundaries.

const fps = 30;
const cta = "FOLLOW FOR MORE";
const wordsText = cta.split(' '); // ['FOLLOW', 'FOR', 'MORE']
const wordStartTimesSec = [0.0, 0.6, 1.0];

function script(intervalMs = 100) {
  return directorScriptSchema.parse({
    project: {},
    groups: [
      {
        id: 'g-cta',
        role: 'cta-overlay',
        wordRange: [0, 2],
        audioPattern: { type: 'typewriter', params: { intervalMs } },
      },
    ],
    beats: [],
  });
}

describe('expandTypewriterCues', () => {
  it('emits one cue per character (no spaces shown but counted between words)', () => {
    const s = script();
    const cues = expandTypewriterCues({
      group: s.groups[0]!,
      wordStartTimesSec,
      fps,
      wordsText,
    });
    // 'FOLLOW' = 6 chars, 'FOR' = 3 chars, 'MORE' = 4 chars
    // Plus 2 inter-word spaces (between FOLLOW-FOR and FOR-MORE).
    const charCount = 6 + 3 + 4;
    const spaceCount = 2;
    expect(cues.length).toBe(charCount + spaceCount);
  });

  it('every emitted cue tagged with source="typewriter"', () => {
    const s = script();
    const cues = expandTypewriterCues({
      group: s.groups[0]!,
      wordStartTimesSec,
      fps,
      wordsText,
    });
    for (const c of cues) expect(c.source).toBe('typewriter');
  });

  it('respects intervalMs — 100ms at 30fps = 3 frames between chars', () => {
    const s = script(100);
    const cues = expandTypewriterCues({
      group: s.groups[0]!,
      wordStartTimesSec,
      fps,
      wordsText,
    });
    // The first 6 cues belong to "FOLLOW" which starts at t=0 → frame 0.
    const followCues = cues.slice(0, 6);
    for (let i = 0; i < 6; i++) {
      expect(followCues[i]!.startFrame).toBe(i * 3);
    }
  });

  it('returns [] when the group has no audioPattern', () => {
    const noPattern = directorScriptSchema.parse({
      project: {},
      groups: [{ id: 'g', role: 'cta-overlay', wordRange: [0, 2] }],
      beats: [],
    });
    const cues = expandTypewriterCues({
      group: noPattern.groups[0]!,
      wordStartTimesSec,
      fps,
      wordsText,
    });
    expect(cues).toEqual([]);
  });

  it('defaults volume to 0.35 when params.volume is unset', () => {
    const s = script();
    const cues = expandTypewriterCues({
      group: s.groups[0]!,
      wordStartTimesSec,
      fps,
      wordsText,
    });
    expect(cues[0]!.volume).toBeCloseTo(0.35, 6);
  });

  it('honors params.volume override', () => {
    const custom = directorScriptSchema.parse({
      project: {},
      groups: [
        {
          id: 'g',
          role: 'cta-overlay',
          wordRange: [0, 2],
          audioPattern: { type: 'typewriter', params: { volume: 0.8 } },
        },
      ],
      beats: [],
    });
    const cues = expandTypewriterCues({
      group: custom.groups[0]!,
      wordStartTimesSec,
      fps,
      wordsText,
    });
    expect(cues[0]!.volume).toBeCloseTo(0.8, 6);
  });
});
