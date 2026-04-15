import { z } from 'zod';
import type { CaptionPlan, FaceData, Transcript } from './types.js';

export type ProductionMode = 'speaker_montage' | 'narrated_story';
export type AssetKind = 'video' | 'image';
export type ClipRole = 'speaker' | 'broll' | 'image';

// What the Claude multimodal classifier returns for each asset. Used by the
// orchestrator to understand the visual content of each clip/image.
export const AssetAnalysisSchema = z.object({
  subject: z.string(),
  isPersonOnCamera: z.boolean(),
  sceneTags: z.array(z.string()),
  bRollFriendly: z.boolean(),
  emotionalTone: z.string(),
  caption: z.string(),
});
export type AssetAnalysis = z.infer<typeof AssetAnalysisSchema>;

export type DiarizationSegment = {
  start: number;
  end: number;
  speaker: string;
};

export type Diarization = {
  segments: DiarizationSegment[];
  speakerCount: number;
};

// One row from the production_assets table, with JSON columns already parsed.
export type ProductionAsset = {
  id: string;
  productionId: string;
  ordinal: number;
  kind: AssetKind;
  path: string;
  mime: string | null;
  durationSec: number | null;
  width: number | null;
  height: number | null;
  transcript: Transcript | null;
  diarization: Diarization | null;
  faces: FaceData | null;
  analysis: AssetAnalysis | null;
  hasSpeech: boolean;
  speakerCoverage: number | null;
  role: ClipRole | null;
  error: string | null;
};

// A single entry on the producer's timeline. `inSec`/`outSec` are times in
// the SOURCE asset's timeline (not the rendered output).
export const TimelineEntrySchema = z.object({
  assetId: z.string(),
  role: z.enum(['speaker', 'broll', 'image']),
  inSec: z.number().nonnegative(),
  outSec: z.number().nonnegative(),
  keepAudio: z.boolean(),
  narrationIndex: z.number().int().nonnegative().optional(),
});
export type TimelineEntry = z.infer<typeof TimelineEntrySchema>;

export const NarrationBeatSchema = z.object({
  text: z.string(),
  startSec: z.number().nonnegative(),
  endSec: z.number().nonnegative(),
});
export type NarrationBeat = z.infer<typeof NarrationBeatSchema>;

// Output of the orchestrator LLM. Validated before we cut anything.
export const ProductionPlanSchema = z.object({
  mode: z.enum(['speaker_montage', 'narrated_story']),
  targetDurationSec: z.number().positive(),
  timeline: z.array(TimelineEntrySchema).min(1),
  narrationScript: z.array(NarrationBeatSchema).optional(),
  notes: z.string().default(''),
});
export type ProductionPlan = z.infer<typeof ProductionPlanSchema>;

// A timeline entry after cutSegments has trimmed the source file. The cutPath
// is a local mp4 (or image path) that the renderer stages into Remotion's
// public/ dir.
export type CutTimelineEntry = TimelineEntry & {
  cutPath: string;
  cutDurationSec: number;
  // Rebased transcript/caption plan for speaker clips — word times expressed
  // in the cut clip's own timeline (0..cutDurationSec).
  transcript?: Transcript | null;
  captionPlan?: CaptionPlan | null;
  faces?: FaceData | null;
};

export type ProductionRow = {
  id: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  stage: string | null;
  capSeconds: number;
  prompt: string | null;
  voiceId: string | null;
  mode: ProductionMode | null;
  productionPlan: ProductionPlan | null;
  timeline: CutTimelineEntry[] | null;
  narrationPath: string | null;
  narrationScript: NarrationBeat[] | null;
  outputPath: string | null;
  templateId: string;
  styleSpec: Record<string, unknown>;
  progress: unknown;
  error: string | null;
  attempts: number;
};
