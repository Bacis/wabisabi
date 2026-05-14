// Build the initial EditorState from a resolved source (stock clip or
// uploaded job). One video track holding the single source clip, one empty
// audio + overlay track, and one captions track populated from the
// transcript words — assigned to a single default group positioned near the
// bottom-third of the canvas.

import type { Transcript } from '@/lib/api';
import { snapFrame, clampNonNegative } from './snap';
import { CANVAS_W, CANVAS_H } from './coords';
import { DEFAULT_GROUP_STYLE_ID, DEFAULT_GROUP_STYLES } from './groupStyles';
import type { PersistedDesignState, Track } from './types';

let counter = 0;
const newId = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${(counter++).toString(36)}`;

export function buildInitialState(input: {
  videoSrc: string;
  transcript: Transcript;
  durationSec: number;
}): PersistedDesignState {
  const { videoSrc, transcript, durationSec } = input;
  const safeDuration = Math.max(1, durationSec);

  const groupId = newId('group');
  const captionWords = (transcript.words ?? []).map((w) => ({
    id: newId('word'),
    text: w.word,
    start: snapFrame(clampNonNegative(w.start)),
    duration: snapFrame(Math.max(0.05, w.end - w.start)),
    groupId,
  }));

  // Default group sits in the lower third, full canvas width minus a
  // generous side margin. The gizmo lets the user reposition immediately.
  const groupTransform = {
    x: Math.round(CANVAS_W * 0.1),
    y: Math.round(CANVAS_H * 0.62),
    w: Math.round(CANVAS_W * 0.8),
    h: Math.round(CANVAS_H * 0.18),
    rot: 0,
  };

  const videoTrack: Track = {
    id: newId('vtrack'),
    type: 'video',
    name: 'Video',
    items: [
      {
        id: newId('vclip'),
        start: 0,
        duration: snapFrame(safeDuration),
        src: videoSrc,
      },
    ],
  };

  const audioTrack: Track = {
    id: newId('atrack'),
    type: 'audio',
    name: 'Audio',
    items: [],
  };

  const overlayTrack: Track = {
    id: newId('otrack'),
    type: 'overlay',
    name: 'Overlays',
    items: [],
  };

  const captionTrack: Track = {
    id: newId('ctrack'),
    type: 'captions',
    name: 'Captions',
    items: captionWords,
    groups: [
      {
        id: groupId,
        name: 'Captions',
        styleId: DEFAULT_GROUP_STYLE_ID,
        transform: groupTransform,
      },
    ],
  };

  return {
    version: 1,
    durationSec: safeDuration,
    tracks: [overlayTrack, videoTrack, audioTrack, captionTrack],
    groupStyles: { ...DEFAULT_GROUP_STYLES },
    templateId: 'reel-clone',
    styleSpec: {},
    transcriptText: (transcript.words ?? []).map((w) => w.word).join(' '),
  };
}

export { newId };
