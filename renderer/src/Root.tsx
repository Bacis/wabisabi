import React from 'react';
import { Composition } from 'remotion';
import { WabisabiSequence } from './WabisabiSequence';

// Import our mock manifest for local previewing
// @ts-ignore
import mockManifest from './mock_manifest.json';

export const RemotionRoot: React.FC = () => {
  // Calculate total duration based on the last caption
  const lastCaption = mockManifest.sequence[mockManifest.sequence.length - 1];
  const fps = 30;
  const durationInFrames = Math.max(
    Math.round(lastCaption.timestamp_start * fps) + (fps * 2),
    30 // Ensure at least 30 frames
  );

  return (
    <>
      <Composition
        id="WabisabiManifest"
        component={WabisabiSequence as any}
        durationInFrames={durationInFrames}
        fps={fps}
        width={1080}
        height={1920}
        defaultProps={{
          captions: mockManifest.sequence,
          has_background_music: (mockManifest as any).has_background_music || false,
          style_config: (mockManifest as any).style_config,
          base_video_filename: (mockManifest as any).base_video_filename,
        }}
      />
    </>
  );
};
