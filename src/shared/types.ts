import type { StyleSpec } from './styleSpec.js';

export type JobStatus = 'queued' | 'running' | 'done' | 'failed';

export type Word = {
  word: string;
  start: number; // seconds
  end: number;   // seconds
  confidence: number;
};

export type Transcript = {
  language: string;
  duration: number;
  words: Word[];
};

// LLM-enriched view of the transcript: each chunk is a caption line with the
// raw words and a parallel boolean flag marking which words to emphasize
// (color + scale). Built by the enrichTranscript stage; falls back to fixed-N
// chunking inside the render template if absent.
export type CaptionChunk = {
  words: Word[];
  emphasis: boolean[];
};

// Canvas-space rect (1080×1920 baseline). Used by the Caption Designer for
// per-group placement on screen and per-overlay-item position.
export type Transform = {
  x: number;
  y: number;
  w: number;
  h: number;
  rot: number;
};

// A caption group bundles a subset of words at a single on-screen position
// with a shared GroupStyle. Used by the 'caption-designer' template; ignored
// by reel-clone/pop-words (so legacy renders are unaffected when these
// fields are absent on CaptionPlan).
export type CaptionGroup = {
  id: string;
  name: string;
  styleId: string;       // FK → GroupStyle.id in styleSpec.groupStyles
  transform: Transform;
};

// Per-group styling. Lives inside styleSpec.groupStyles for the caption-
// designer template. Adding more is a one-liner.
export type GroupStyle = {
  id: string;
  name: string;
  bg: string;
  text: string;
  activeBg: string;
  activeText: string;
  weight: number;          // font-weight
  scaleActive: number;     // 1.0 - 1.3
  rotateActive: number;    // degrees applied to active word
  baseFontSize: number;    // canvas px @ group.w === 1080
  padX: number;            // ratio of fontSize
  padY: number;
  radius: number;
  glow: string | null;     // active-word box-shadow color or null
  color: string;           // identity color (timeline strip, swatches)
};

export type CaptionPlan = {
  chunks: CaptionChunk[];
  // Additive — caption-designer template consumes these; ReelClone ignores.
  groups?: CaptionGroup[];
  wordGroupAssignments?: Record<string, string>;  // wordId → groupId
};

// Face detection output from the MediaPipe sidecar. Coordinates are
// normalized [0, 1] so the layout engine can resolve them to any frame size.
export type FaceBox = {
  x: number;
  y: number;
  width: number;
  height: number;
  score: number;
};

export type FaceSample = {
  time: number; // seconds from video start
  faces: FaceBox[];
};

export type FaceData = {
  videoWidth: number;
  videoHeight: number;
  videoFps: number;
  videoDuration: number;
  samples: FaceSample[];
};

// Snapshot of render-stage progress, written to the `progress` column on
// every poll/onProgress callback. The viewer renders a live progress bar
// from this. Only populated while the render stage is running (and stays
// populated after to show the final stats).
export type RenderProgress = {
  mode: 'local' | 'lambda';
  percent: number; // 0-100
  framesRendered?: number;
  framesEncoded?: number;
  totalFrames?: number;
  // Lambda-only:
  lambdasInvoked?: number;
  totalChunks?: number;
  startedAt: string; // ISO
  updatedAt: string; // ISO
};

export type Job = {
  id: string;
  status: JobStatus;
  stage: string | null;
  inputPath: string;
  outputPath: string | null;
  templateId: string;
  styleSpec: StyleSpec;
  transcript: Transcript | null;
  captionPlan: CaptionPlan | null;
  faces: FaceData | null;
  progress: RenderProgress | null;
  error: string | null;
  attempts: number;
};
