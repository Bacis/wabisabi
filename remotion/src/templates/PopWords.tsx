import React from 'react';
import { AbsoluteFill, OffthreadVideo, staticFile } from 'remotion';
import { loadFont } from '@remotion/google-fonts/Inter';
import type { FaceData } from '../lib/positioning';
import {
  CaptionLayer,
  type CaptionPlan,
  type StyleSpec,
  type Transcript,
} from '../lib/CaptionLayer';

loadFont('normal', {
  weights: ['800'],
  subsets: ['latin'],
});

type Props = {
  videoFile: string;
  videoMeta: { width: number; height: number; durationInFrames: number; fps: number };
  transcript: Transcript;
  captionPlan: CaptionPlan | null;
  faces: FaceData | null;
  styleSpec: StyleSpec;
};

// Thin wrapper: play the source video under a caption overlay. All caption
// rendering logic lives in <CaptionLayer> which is shared with the producer
// pipeline's StoryComposition. Visual output is identical to the pre-refactor
// version — this is just a de-duplication move.
export const PopWords: React.FC<Props> = ({
  videoFile,
  transcript,
  captionPlan,
  faces,
  styleSpec,
}) => {
  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      {videoFile && (
        <OffthreadVideo
          src={videoFile.startsWith('http') ? videoFile : staticFile(videoFile)}
        />
      )}
      <CaptionLayer
        transcript={transcript}
        captionPlan={captionPlan}
        faces={faces}
        styleSpec={styleSpec}
      />
    </AbsoluteFill>
  );
};
