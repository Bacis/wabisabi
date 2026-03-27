import React from 'react';
import { Composition, CalculateMetadataFunction } from 'remotion';
import { WabisabiSequence } from './WabisabiSequence';

// Import our mock manifest for local previewing
// @ts-ignore
import mockManifest from './mock_manifest.json';

const calculateMetadata: CalculateMetadataFunction<any> = ({ props }) => {
  const fps = 30;
  // If sequence is empty, default to 30 frames
  if (!props.sequence || props.sequence.length === 0) {
    return {
      durationInFrames: 30,
      props,
    };
  }
  
  const lastCaption = props.sequence[props.sequence.length - 1];
  const durationInFrames = Math.max(
    Math.round(lastCaption.timestamp_start * fps) + (fps * 2),
    30 // Ensure at least 30 frames
  );

  return {
    durationInFrames,
    props,
  };
};

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="WabisabiManifest"
        component={WabisabiSequence as any}
        calculateMetadata={calculateMetadata}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={{
          sequence: mockManifest.sequence,
          has_background_music: (mockManifest as any).has_background_music || false,
          background_music_url: (mockManifest as any).background_music_url,
          style_config: (mockManifest as any).style_config,
          base_video_filename: (mockManifest as any).base_video_filename,
        }}
      />
    </>
  );
};
