import React from 'react';
import { Video, AbsoluteFill, staticFile } from 'remotion';

interface BRollProps {
  videoPath: string | null;
}

export const BRoll: React.FC<BRollProps> = ({ videoPath }) => {
  if (!videoPath) {
    // If no B-roll is provided, just return black
    return <AbsoluteFill style={{ backgroundColor: 'black' }} />;
  }
  
  // Use Remotion's standard Video component to seamlessly render without hitting Lambda disk limits
  // Clean the path (remove leading slash) for staticFile
  const cleanPath = videoPath.replace(/^\/+/, '');
  return (
    <AbsoluteFill style={{ backgroundColor: 'black' }}>
      <Video 
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
