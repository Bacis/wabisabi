// Audio cue value object. Day 19 of the Director feature.
//
// The CueLayer composer (Day 19) and the Web Audio preview path (Day 20)
// both consume this shape. Producers — group-level, beat-level, typewriter
// expansion — produce arrays of these from a DirectorScript + word
// timings. The renderer maps each AudioCue 1:1 to a Remotion <Audio>.

export type AudioCue = {
  /** Stable id for debugging / DOM keys. */
  id: string;
  /** Path relative to remotion/public/, resolved via staticFile() at render. */
  samplePath: string;
  /** Composition frame where the sample begins. */
  startFrame: number;
  /** Optional explicit end frame; defaults to "until the sample ends naturally". */
  endFrame?: number;
  /** 0..1, multiplies the source amplitude. */
  volume: number;
  /** Diagnostic label visible on `<audio data-cue-source>` for test assertions. */
  source: 'group' | 'beat' | 'typewriter';
};

// Default volumes per cue source — matches the Director spec's Workstream E
// recipe so the agent's tune_field path can override per group without
// fighting baked-in mixes.
export const DEFAULT_VOLUMES = {
  group: 0.4,
  beat: 0.6,
  typewriter: 0.35,
} as const satisfies Record<AudioCue['source'], number>;
