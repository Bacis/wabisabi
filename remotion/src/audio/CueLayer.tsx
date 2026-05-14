// Audio cue layer. Day 19 of the Director feature.
//
// Walks a DirectorScript's groups + beats, expands typewriter patterns,
// and emits one Remotion <Audio> per resolved cue. Sits inside the
// Composition tree alongside the caption template; Remotion's renderer
// handles audio encoding into the final mp4 transparently.
//
// Out-of-range cues are no-ops in Remotion — <Audio startFrom={N}> with
// N past the composition's last frame renders nothing — so we can emit
// the full script's cue list without trimming.
//
// Asset URLs use staticFile() so Remotion's offthread asset pipeline
// shares decoded buffers across instances of the same URL. That matters
// for typewriter patterns where the same 12 click samples fire 100+
// times each.

import React from 'react';
import { Audio, staticFile, useVideoConfig } from 'remotion';
import type { DirectorScript } from '../../../src/shared/director/schema';
import { expandTypewriterCues } from './expandTypewriterCues';
import { beatLevelCue, groupLevelCue } from './groupLevelCue';
import type { AudioCue } from './cueTypes';

export type CueLayerProps = {
  script: DirectorScript;
  /** Per-word start times in seconds. Length must cover script.groups' word ranges. */
  wordStartTimesSec: number[];
  /** Per-word text strings — used by the typewriter pattern's per-char expansion. */
  wordsText: string[];
};

export const CueLayer: React.FC<CueLayerProps> = ({ script, wordStartTimesSec, wordsText }) => {
  const { fps } = useVideoConfig();

  const cues: AudioCue[] = [];
  for (const group of script.groups) {
    const g = groupLevelCue({ group, wordStartTimesSec, fps });
    if (g) cues.push(g);
    if (group.audioPattern?.type === 'typewriter') {
      cues.push(
        ...expandTypewriterCues({
          group,
          wordStartTimesSec,
          fps,
          wordsText,
        }),
      );
    }
  }
  for (const beat of script.beats) {
    const b = beatLevelCue({ beat, wordStartTimesSec, fps });
    if (b) cues.push(b);
  }

  return (
    <>
      {cues.map((cue) => (
        <Audio
          key={cue.id}
          src={staticFile(cue.samplePath)}
          startFrom={Math.max(0, cue.startFrame)}
          {...(cue.endFrame !== undefined ? { endAt: cue.endFrame } : {})}
          volume={cue.volume}
          // Data attr lets Playwright (or any DOM-snapshot test) assert
          // cue counts per source category without parsing src URLs.
          data-cue-source={cue.source}
        />
      ))}
    </>
  );
};
