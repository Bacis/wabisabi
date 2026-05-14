// Group-level cue + beat-level cue producers. Day 19 of the Director feature.
//
// Pure functions: group/beat + word timings + fps → optional AudioCue.
// Returns null when the group/beat has no audioCue attached, when the
// sample library has no entry for that gesture (graceful no-op while
// Day 18's library is being curated), or when the start frame falls
// outside the composition range (caller renders no <Audio> tag).

import type { CaptionBeat, SceneGroup } from '../../../src/shared/director/schema';
import { resolveSamplePath } from '../../../src/shared/director/sampleLibrary';
import { DEFAULT_VOLUMES, type AudioCue } from './cueTypes';

export type GroupLevelCueArgs = {
  group: SceneGroup;
  wordStartTimesSec: number[];
  fps: number;
};

export function groupLevelCue(args: GroupLevelCueArgs): AudioCue | null {
  const { group, wordStartTimesSec, fps } = args;
  if (!group.audioCue) return null;
  const startSec = wordStartTimesSec[group.wordRange[0]];
  if (typeof startSec !== 'number') return null;
  const cueOffsetSec = (group.audioCue.offsetMs ?? 0) / 1000;
  const startFrame = Math.round((startSec + cueOffsetSec) * fps);
  const samplePath = resolveSamplePath(group.audioCue.gesture, `g:${group.id}`);
  if (!samplePath) return null;
  return {
    id: `g-${group.id}`,
    samplePath,
    startFrame,
    volume: group.audioCue.volume ?? DEFAULT_VOLUMES.group,
    source: 'group',
  };
}

export type BeatLevelCueArgs = {
  beat: CaptionBeat;
  wordStartTimesSec: number[];
  fps: number;
};

export function beatLevelCue(args: BeatLevelCueArgs): AudioCue | null {
  const { beat, wordStartTimesSec, fps } = args;
  if (!beat.audioCue) return null;
  const startSec = wordStartTimesSec[beat.wordRange[0]];
  if (typeof startSec !== 'number') return null;
  const cueOffsetSec = (beat.audioCue.offsetMs ?? 0) / 1000;
  const startFrame = Math.round((startSec + cueOffsetSec) * fps);
  const samplePath = resolveSamplePath(beat.audioCue.gesture, `b:${beat.id}`);
  if (!samplePath) return null;
  return {
    id: `b-${beat.id}`,
    samplePath,
    startFrame,
    volume: beat.audioCue.volume ?? DEFAULT_VOLUMES.beat,
    source: 'beat',
  };
}
