// Caption Designer — editor-side state shape.
//
// CaptionGroup / GroupStyle / Transform live in src/shared/types because they
// also need to be readable by the Remotion composition. Tracks and per-track
// item shapes are editor-only: when a design is rendered, tracks collapse
// back into the existing inputProps (videoFile, transcript, captionPlan,
// styleSpec) plus an embedded designer payload on styleSpec.designer.

import type { Transform, CaptionGroup, GroupStyle } from '@/lib/api';

export type { Transform, CaptionGroup, GroupStyle };

export type VideoClip = {
  id: string;
  start: number;       // seconds, frame-aligned
  duration: number;
  src: string;
};

export type AudioClip = {
  id: string;
  start: number;
  duration: number;
  src: string;
  label: string;
};

export type OverlayItem = {
  id: string;
  start: number;
  duration: number;
  label: string;
  transform: Transform;
};

export type CaptionWordItem = {
  id: string;
  text: string;
  start: number;
  duration: number;
  groupId: string;
};

export type VideoTrack = {
  id: string;
  type: 'video';
  name: string;
  items: VideoClip[];
};

export type AudioTrack = {
  id: string;
  type: 'audio';
  name: string;
  items: AudioClip[];
};

export type OverlayTrack = {
  id: string;
  type: 'overlay';
  name: string;
  items: OverlayItem[];
};

export type CaptionTrack = {
  id: string;
  type: 'captions';
  name: string;
  items: CaptionWordItem[];
  groups: CaptionGroup[];
};

export type Track = VideoTrack | AudioTrack | OverlayTrack | CaptionTrack;

export type Selection =
  | { kind: 'item'; item: VideoClip | AudioClip | OverlayItem | CaptionWordItem; track: Track }
  | { kind: 'group'; group: CaptionGroup; track: CaptionTrack }
  | null;

// Source descriptor — what Step 1 of /themes/new resolves to.
export type DesignSource =
  | { kind: 'stock'; clipId: string }
  | { kind: 'job'; jobId: string };

// The persisted slice of EditorState (volatile UI bits like currentTime,
// playing, selectedId are excluded by serialize.ts).
export type PersistedDesignState = {
  version: 1;
  tracks: Track[];
  groupStyles: Record<string, GroupStyle>;
  durationSec: number;
  templateId: string;
  styleSpec: Record<string, any>;
  transcriptText: string;
};
