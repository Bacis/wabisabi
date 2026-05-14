import React from 'react';
import { Composition } from 'remotion';
import { z } from 'zod';
import { PopWords } from './templates/PopWords';
import { ReelClone } from './templates/ReelClone';
import { CaptionDesigner } from './templates/CaptionDesigner';

// Schema is intentionally permissive — the API server has already validated
// the StyleSpec with the canonical Zod schema before queueing the job.
const wordSchema = z.object({
  word: z.string(),
  start: z.number(),
  end: z.number(),
  confidence: z.number(),
});

const transformSchema = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  rot: z.number(),
});

const captionPlanSchema = z
  .object({
    chunks: z.array(
      z.object({
        words: z.array(wordSchema),
        emphasis: z.array(z.boolean()),
      }),
    ),
    // Additive Caption Designer fields. Optional so legacy payloads validate.
    groups: z
      .array(
        z.object({
          id: z.string(),
          name: z.string(),
          styleId: z.string(),
          transform: transformSchema,
        }),
      )
      .optional(),
    wordGroupAssignments: z.record(z.string()).optional(),
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

const defaultProps = {
  videoFile: '',
  videoMeta: { width: 1080, height: 1920, durationInFrames: 300, fps: 30 },
  transcript: { language: 'en', duration: 10, words: [] },
  captionPlan: null,
  faces: null,
  styleSpec: {},
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
        id="reel-clone"
        component={ReelClone}
        schema={propsSchema}
        fps={30}
        width={1080}
        height={1920}
        durationInFrames={300}
        defaultProps={defaultProps}
        calculateMetadata={calculateMetadata}
      />
      <Composition
        id="caption-designer"
        component={CaptionDesigner}
        schema={propsSchema}
        fps={30}
        width={1080}
        height={1920}
        durationInFrames={300}
        defaultProps={defaultProps}
        calculateMetadata={calculateMetadata}
      />
    </>
  );
};
