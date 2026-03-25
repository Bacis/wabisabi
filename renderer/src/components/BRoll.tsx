import React from 'react';
import { OffthreadVideo, AbsoluteFill, staticFile } from 'remotion';

interface BRollProps {
  videoPath: string | null;
}

export const BRoll: React.FC<BRollProps> = ({ videoPath }) => {
  if (!videoPath) {
    // If no B-roll is provided, just return black
    return <AbsoluteFill style={{ backgroundColor: 'black' }} />;
  }
  
  // Use Remotion's OffthreadVideo to seamlessly render the local MP4 file
  // Clean the path (remove leading slash) for staticFile
  const cleanPath = videoPath.replace(/^\/+/, '');
  return (
    <AbsoluteFill style={{ backgroundColor: 'black' }}>
      <OffthreadVideo 
        src={videoPath.startsWith('http') ? videoPath : staticFile(cleanPath)} 
        muted={true}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover'
        }} 
      />
    </AbsoluteFill>
  );
};
