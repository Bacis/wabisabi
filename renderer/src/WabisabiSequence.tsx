import React from 'react';
import { Sequence, useVideoConfig, AbsoluteFill, OffthreadVideo, Audio, staticFile } from 'remotion';
import { Caption } from './components/Caption';
import { BRoll } from './components/BRoll';

export type CaptionData = {
  timestamp_start: number;
  text: string;
  style: string;
  b_roll_search_term: string | null;
  local_b_roll_path?: string | null;
};

export type SingleStyleConfig = {
  primaryColor?: string;
  backgroundColor?: string;
  fontFamily?: string;
  fontWeight?: number;
  textTransform?: 'uppercase' | 'lowercase' | 'none';
  textShadow?: string;
  textStroke?: string;
};

export type StyleConfig = {
  [styleName: string]: SingleStyleConfig;
};

interface WabisabiSequenceProps {
  captions: CaptionData[];
  has_background_music?: boolean;
  style_config?: StyleConfig;
  base_video_filename?: string;
}

export const WabisabiSequence: React.FC<WabisabiSequenceProps> = ({ captions, has_background_music, style_config, base_video_filename }) => {
  const { fps } = useVideoConfig();

  // Group captions into phrases (max 5 words, or if pause > 0.6s)
  const phraseGroups: CaptionData[][] = [];
  let currentGroup: CaptionData[] = [];

  for (let i = 0; i < captions.length; i++) {
    const cap = captions[i];
    if (currentGroup.length === 0) {
      currentGroup.push(cap);
    } else {
      const prevCap = currentGroup[currentGroup.length - 1];
      const timeDiff = cap.timestamp_start - prevCap.timestamp_start;
      
      if (timeDiff < 0.6 && currentGroup.length < 5) {
        currentGroup.push(cap);
      } else {
        phraseGroups.push(currentGroup);
        currentGroup = [cap];
      }
    }
  }
  if (currentGroup.length > 0) phraseGroups.push(currentGroup);

  const availableStyles = style_config 
    ? Object.keys(style_config).filter(key => key.startsWith('style_')) 
    : [];
  const processedGroups = phraseGroups.map(group => {
    if (availableStyles.length <= 1) return group;
    const presentStyles = new Set(group.map(c => c.style));
    const missingStyles = availableStyles.filter(s => !presentStyles.has(s));
    if (missingStyles.length === 0) return group;
    
    const newGroup = [...group];
    let availableIndices = newGroup.map((_, i) => i);
    const seedBase = group[0].timestamp_start * 100;
    availableIndices.sort((a, b) => {
       const randA = Math.sin(seedBase + a) * 10000;
       const randB = Math.sin(seedBase + b) * 10000;
       return (randA - Math.floor(randA)) - (randB - Math.floor(randB));
    });
    missingStyles.forEach((missingStyle, i) => {
       const targetIndex = availableIndices[i % availableIndices.length];
       newGroup[targetIndex] = { ...newGroup[targetIndex], style: missingStyle };
    });
    return newGroup;
  });

  return (
    <AbsoluteFill style={{ backgroundColor: 'black' }}>
      {/* BACKGROUND AMBIENT MUSIC */}
      {has_background_music && (
        <Audio src={staticFile("background_music.mp3")} volume={0.15} />
      )}
      
      {/* BASE VIDEO LAYER + NATIVE AUDIO */}
      <OffthreadVideo 
        src={base_video_filename?.startsWith('http') ? base_video_filename : staticFile(base_video_filename || "input_video.MOV")}  
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
      />
      
      {processedGroups.map((group, groupIndex) => {
        const startFrame = Math.round(group[0].timestamp_start * fps);
        
        // The group stays on screen until the exact frame the next group starts!
        const nextGroup = processedGroups[groupIndex + 1];
        const endFrame = nextGroup 
          ? Math.round(nextGroup[0].timestamp_start * fps) 
          : Math.round(group[group.length - 1].timestamp_start * fps) + (fps * 2.0);
          
        const duration = endFrame - startFrame;

        if (duration <= 0) return null;
        
        // Find if any caption in this group has a B-Roll
        const bRollCaption = group.find(c => c.local_b_roll_path);

        // Safe Bounding Zones configuration (deterministic alternating grid)
        const ZONES = [
          { top: '20%', height: '60%', alignItems: 'center' },       // center-middle block, huge room
          { top: '60%', height: '30%', alignItems: 'flex-start' },   // lower-third, taller
          { top: '10%', height: '35%', alignItems: 'flex-end' },     // upper-third, taller
        ];
        const zone = ZONES[groupIndex % ZONES.length];

        return (
          <Sequence key={groupIndex} from={startFrame} durationInFrames={duration}>
            {/* Background B-roll layer for the phrase if it has one */}
            {bRollCaption?.local_b_roll_path && (
               <BRoll videoPath={bRollCaption.local_b_roll_path} />
            )}
            
            {/* Flex container mapping to a Safe Bounding Box */}
            <AbsoluteFill style={{
              display: 'flex',
              flexDirection: 'row',
              flexWrap: 'wrap',
              justifyContent: 'center',
              alignItems: zone.alignItems as any,
              alignContent: 'center',
              padding: '0 5%', // Tighter edge padding pushes text to fill frame horizontally
              top: zone.top,
              height: zone.height,
              position: 'absolute'
            }}>
               {group.map((caption, i) => (
                  <Caption 
                    key={i} 
                    text={caption.text} 
                    styleClass={caption.style} 
                    startOffset={Math.round(caption.timestamp_start * fps) - startFrame}
                    styleConfig={style_config}
                  />
               ))}
            </AbsoluteFill>
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
