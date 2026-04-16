import React from 'react';
import { Composition } from 'remotion';
import { z } from 'zod';
import { PopWords } from './templates/PopWords';
import { SingleWord } from './templates/SingleWord';
import { ThreeEffects } from './templates/ThreeEffects';
import { KineticBurst } from './templates/KineticBurst';
import { StoryComposition } from './templates/StoryComposition';

// Schema is intentionally permissive — the API server has already validated
// the StyleSpec with the canonical Zod schema before queueing the job.
const wordSchema = z.object({
  word: z.string(),
  start: z.number(),
  end: z.number(),
  confidence: z.number(),
});

const captionPlanSchema = z
  .object({
    chunks: z.array(
      z.object({
        words: z.array(wordSchema),
        emphasis: z.array(z.boolean()),
      }),
    ),
  })
  .nullable();

const facesSchema = z
  .object({
    videoWidth: z.number(),
    videoHeight: z.number(),
    videoFps: z.number(),
    videoDuration: z.number(),
    samples: z.array(
      z.object({
        time: z.number(),
        faces: z.array(
          z.object({
            x: z.number(),
            y: z.number(),
            width: z.number(),
            height: z.number(),
            score: z.number(),
          }),
        ),
      }),
    ),
  })
  .nullable();

const propsSchema = z.object({
  videoFile: z.string(),
  videoMeta: z.object({
    width: z.number(),
    height: z.number(),
    durationInFrames: z.number(),
    fps: z.number(),
  }),
  transcript: z.object({
    language: z.string(),
    duration: z.number(),
    words: z.array(wordSchema),
  }),
  captionPlan: captionPlanSchema,
  faces: facesSchema,
  styleSpec: z.any(),
});

// Props schema for the producer's multi-clip composition. Permissive on
// purpose — the API server validates every field with stricter Zod schemas
// in src/shared/productionTypes.ts before invoking the renderer.
const storyPropsSchema = z.object({
  clips: z.array(
    z.object({
      fileBasename: z.string(),
      kind: z.enum(['video', 'image']),
      durationInFrames: z.number(),
      startFromFrame: z.number().optional(),
      role: z.enum(['speaker', 'broll', 'image']),
      keepAudio: z.boolean(),
      transcript: z
        .object({
          language: z.string(),
          duration: z.number(),
          words: z.array(wordSchema),
        })
        .nullable()
        .optional(),
      captionPlan: captionPlanSchema.optional(),
      faces: facesSchema.optional(),
      caption: z.string().optional(),
    }),
  ),
  narrationFile: z.string().nullable().optional(),
  narrationTranscript: z
    .object({
      language: z.string(),
      duration: z.number(),
      words: z.array(wordSchema),
    })
    .nullable()
    .optional(),
  narrationCaptionPlan: captionPlanSchema.optional(),
  videoMeta: z.object({
    width: z.number(),
    height: z.number(),
    durationInFrames: z.number(),
    fps: z.number(),
  }),
  styleSpec: z.any(),
  // Optional split-screen background clip. When set, speaker clips are
  // rendered in the top half and this clip loops in the bottom half. `src`
  // is a public/ basename (local mode) or an https URL (lambda mode), same
  // convention as narrationFile.
  backgroundVideo: z
    .object({ src: z.string(), durationInFrames: z.number().int().positive() })
    .nullable()
    .optional(),
});

const storyDefaultProps = {
  clips: [],
  narrationFile: null,
  narrationTranscript: null,
  narrationCaptionPlan: null,
  videoMeta: { width: 1080, height: 1920, durationInFrames: 300, fps: 30 },
  styleSpec: {},
  backgroundVideo: null,
};

const defaultProps = {
  videoFile: '',
  videoMeta: { width: 1080, height: 1920, durationInFrames: 300, fps: 30 },
  transcript: { language: 'en', duration: 10, words: [] },
  captionPlan: null,
  faces: null,
  styleSpec: {},
};

// Composition-specific preview props for the experimental three-effects
// template. An empty transcript would render a blank frame, so we supply a
// synthetic 8-word script over sample.mp4 (which already exists in public/).
// The other compositions keep the shared defaultProps above — they are not
// touched by this experiment.
const threeEffectsSampleWords = [
  { word: 'THREE', start: 0.3, end: 0.8, confidence: 1 },
  { word: 'EFFECTS', start: 0.9, end: 1.6, confidence: 1 },
  { word: 'ARE', start: 1.8, end: 2.1, confidence: 1 },
  { word: 'WILD', start: 2.2, end: 2.9, confidence: 1 },
  { word: 'PARTICLE', start: 3.2, end: 3.9, confidence: 1 },
  { word: 'BURSTS', start: 4.0, end: 4.8, confidence: 1 },
  { word: 'EVERY', start: 5.1, end: 5.6, confidence: 1 },
  { word: 'WORD', start: 5.7, end: 6.4, confidence: 1 },
];
const threeEffectsDefaultProps = {
  ...defaultProps,
  videoFile: 'sample.mp4',
  transcript: {
    language: 'en',
    duration: 10,
    words: threeEffectsSampleWords,
  },
  captionPlan: {
    chunks: [
      {
        words: threeEffectsSampleWords.slice(0, 4),
        emphasis: [false, true, false, false],
      },
      {
        words: threeEffectsSampleWords.slice(4, 8),
        emphasis: [false, false, false, true],
      },
    ],
  },
};

// Both compositions accept the same props shape so the worker doesn't need
// to know which template it's calling — the render stage just passes the
// templateId through and Remotion picks the matching <Composition>.
const calculateMetadata = async ({
  props,
}: {
  props: { videoMeta: { width: number; height: number; durationInFrames: number; fps: number } };
}) => ({
  width: props.videoMeta.width,
  height: props.videoMeta.height,
  durationInFrames: props.videoMeta.durationInFrames,
  fps: props.videoMeta.fps,
});

export const Root: React.FC = () => {
  return (
    <>
      <Composition
        id="pop-words"
        component={PopWords}
        schema={propsSchema}
        fps={30}
        width={1080}
        height={1920}
        durationInFrames={300}
        defaultProps={defaultProps}
        calculateMetadata={calculateMetadata}
      />
      <Composition
        id="single-word"
        component={SingleWord}
        schema={propsSchema}
        fps={30}
        width={1080}
        height={1920}
        durationInFrames={300}
        defaultProps={defaultProps}
        calculateMetadata={calculateMetadata}
      />
      <Composition
        id="three-effects"
        component={ThreeEffects}
        schema={propsSchema}
        fps={30}
        width={1080}
        height={1920}
        durationInFrames={300}
        defaultProps={threeEffectsDefaultProps}
        calculateMetadata={calculateMetadata}
      />
      <Composition
        id="kinetic-burst"
        component={KineticBurst}
        schema={propsSchema}
        fps={30}
        width={1080}
        height={1920}
        durationInFrames={300}
        defaultProps={threeEffectsDefaultProps}
        calculateMetadata={calculateMetadata}
      />
      <Composition
        id="story-composition"
        component={StoryComposition}
        schema={storyPropsSchema}
        fps={30}
        width={1080}
        height={1920}
        durationInFrames={300}
        defaultProps={storyDefaultProps}
        calculateMetadata={calculateMetadata}
      />
    </>
  );
};
