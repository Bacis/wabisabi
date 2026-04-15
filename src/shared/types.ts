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

export type CaptionPlan = {
  chunks: CaptionChunk[];
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
