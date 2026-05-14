// Typewriter pattern → AudioCue[] expansion. Day 19 of the Director feature.
//
// When a SceneGroup has `audioPattern.type === 'typewriter'`, the renderer
// emits one cue per CHARACTER in the group's word range — a mechanical-
// keyboard click for every letter, including spaces between words. The
// click spacing is driven by `params.intervalMs` (default 100ms).
//
// Sub-frame timing strategy (Workstream E spec, strategy 1): we snap
// visuals to audio rather than audio to visuals. The character reveal in
// the renderer should be re-aligned to land on the same frame boundaries
// the cues fire on, so audio and visual stay in lockstep without
// fractional-frame `<Audio startFrom>` complexity.
//
// This is a PURE FUNCTION — no Remotion deps, no I/O. The CueLayer
// component calls it then wraps the result in <Audio> elements.

import type { SceneGroup } from '../../../src/shared/director/schema';
import { resolveSamplePath } from '../../../src/shared/director/sampleLibrary';
import type { SonicGesture } from '../../../src/shared/director/vocabularies';
import { DEFAULT_VOLUMES, type AudioCue } from './cueTypes';

export type ExpandTypewriterArgs = {
  group: SceneGroup;
  /** Per-word start times in seconds (idx-aligned with the transcript). */
  wordStartTimesSec: number[];
  /** Per-word durations in seconds (or 0 if unknown — chars then evenly fill the group). */
  wordDurationsSec?: number[];
  /** Render frame rate. */
  fps: number;
  /** The actual word text per idx — chars are taken from these. */
  wordsText: string[];
  /** Optional sonic gesture override; defaults to 'tick' (typewriter-canonical). */
  defaultGesture?: SonicGesture;
};

export function expandTypewriterCues(args: ExpandTypewriterArgs): AudioCue[] {
  const { group, wordStartTimesSec, wordDurationsSec, fps, wordsText, defaultGesture = 'tick' } = args;
  if (!group.audioPattern || group.audioPattern.type !== 'typewriter') return [];

  const params = group.audioPattern.params ?? {};
  const intervalMs = params.intervalMs ?? 100;
  const volume = params.volume ?? DEFAULT_VOLUMES.typewriter;
  const framesPerChar = Math.max(1, Math.round((intervalMs / 1000) * fps));

  const [wStart, wEnd] = group.wordRange;
  const cues: AudioCue[] = [];

  // Walk character-by-character through every word in the range. INCLUDES
  // the space between words so a typewriter rhythm reads naturally.
  let charIdx = 0;
  for (let wi = wStart; wi <= wEnd && wi < wordsText.length; wi++) {
    const text = wordsText[wi] ?? '';
    const wStartSec = wordStartTimesSec[wi] ?? 0;
    const wStartFrame = Math.round(wStartSec * fps);
    for (let ci = 0; ci < text.length; ci++) {
      const cueFrame = wStartFrame + ci * framesPerChar;
      const path = resolveSamplePath(defaultGesture, `${group.id}:${wi}:${ci}`);
      if (!path) continue; // graceful skip — library not yet curated
      cues.push({
        id: `tw-${group.id}-${wi}-${ci}`,
        samplePath: path,
        startFrame: cueFrame,
        volume,
        source: 'typewriter',
      });
      charIdx++;
    }
    // Inter-word space — one extra tick at the natural boundary.
    if (wi < wEnd && wi < wordsText.length - 1) {
      const nextStartSec = wordStartTimesSec[wi + 1] ?? wStartSec + (wordDurationsSec?.[wi] ?? 0);
      const spaceFrame = Math.round(nextStartSec * fps) - framesPerChar;
      const path = resolveSamplePath(defaultGesture, `${group.id}:${wi}:space`);
      if (path) {
        cues.push({
          id: `tw-${group.id}-${wi}-space`,
          samplePath: path,
          startFrame: spaceFrame,
          volume,
          source: 'typewriter',
        });
      }
      charIdx++;
    }
  }

  return cues;
}
