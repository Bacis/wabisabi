import React from 'react';
import { useCurrentFrame, useVideoConfig, spring } from 'remotion';
import '../index.css';

interface CaptionProps {
  text: string;
  styleClass: string;
  startOffset: number;
  styleConfig?: any;
}

export const Caption: React.FC<CaptionProps> = ({ text, styleClass, startOffset, styleConfig }) => {
  const globalFrame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // The local frame relative to when this specific word should appear
  const localFrame = globalFrame - startOffset;

  if (localFrame < 0) {
    return null; // Hidden until its exact timestamp!
  }

  const seededRandom = (seed: number) => {
    let x = Math.sin(seed) * 10000;
    return x - Math.floor(x);
  };
  
  // Use text length and startOffset as a deterministic seed for this specific word
  const seed = text.length * startOffset + 123;
  const r1 = seededRandom(seed);
  const r2 = seededRandom(seed + 1);
  const r3 = seededRandom(seed + 2);
  const r4 = seededRandom(seed + 3);

  // Random base size multiplier
  const sizeMultiplier = 0.8 + (r1 * 0.4); // 0.8x to 1.2x base scale
  
  // Modest random rotation between -5 and +5 degrees
  const targetRotation = (r2 - 0.5) * 10;
  
  // Modest random jitter to respect flexbox bounding boxes without colliding
  const jitterX = (r3 - 0.5) * 15; // -7.5px to 7.5px
  const jitterY = (r4 - 0.5) * 15; // -7.5px to 7.5px

  // Dynamic emphasis: fully capitalized or long words map to a much larger font size
  const isEmphasized = text === text.toUpperCase() || text.length >= 6;
  const isTiny = text.trim().length <= 2;
  
  // Dramatically boost tiny words ("in", "do", "of") so they don't look like specks next to "WORLD"
  const finalSizeMultiplier = isEmphasized ? sizeMultiplier * 1.8 : (isTiny ? sizeMultiplier * 1.5 : sizeMultiplier);

  // Spring animation for pop-in effect (only scaling strictly from 0 to 1)
  const scale = spring({
    fps,
    frame: localFrame,
    config: { damping: 12, mass: 0.5, stiffness: 150 }, // Bouncier pop
  });

  const activeStyle = (styleConfig && styleClass && styleConfig[styleClass]) ? styleConfig[styleClass] : {};

  // Standard bounding box size dictates Flexbox physical dimensions!
  let calculatedFontSize = styleConfig ? 120 * finalSizeMultiplier : 90 * finalSizeMultiplier;
  
  // Prevent it from ever being microscopic, hard visual floor of 100px
  calculatedFontSize = Math.max(calculatedFontSize, 100);
  
  // Anti-Overflow Protection: Prevent long words from bleeding horizontally off-screen.
  // 1080px canvas width with 10% total padding gives ~970px. We use 900px as a safe maximum bounds.
  // Depending on the font, a character's width is roughly 0.65x its font-size height.
  const maxSafeFontSize = 900 / Math.max(text.length * 0.65, 1);
  calculatedFontSize = Math.min(calculatedFontSize, maxSafeFontSize);

  const animationStyle: React.CSSProperties = {
    // Only use structural scaling for pop-in! The grid reads fontSize.
    transform: `scale(${scale}) translate(${jitterX}px, ${jitterY}px) rotate(${targetRotation}deg)`,
    display: 'inline-block',
    textAlign: 'center',
    margin: '10px 15px', // More breathing room for the flex layout
    zIndex: isEmphasized ? 10 : 1, // Larger text visually asserts itself
    position: 'relative',
  };

  const dynamicStyle: React.CSSProperties = {
     color: activeStyle.primaryColor || 'inherit',
     backgroundColor: activeStyle.backgroundColor || 'transparent',
     padding: activeStyle.backgroundColor ? '10px 20px' : '0',
     borderRadius: activeStyle.backgroundColor ? '15px' : '0',
     fontFamily: activeStyle.fontFamily ? `"${activeStyle.fontFamily}", sans-serif` : 'inherit',
     fontWeight: activeStyle.fontWeight || 'inherit',
     textTransform: activeStyle.textTransform || 'inherit',
     textShadow: activeStyle.textShadow || 'none',
     WebkitTextStroke: activeStyle.textStroke || 'none',
     fontSize: `${calculatedFontSize}px`,
     lineHeight: '1.05',
     display: 'inline-block'
  };

  return (
    <div style={animationStyle}>
      <span className={activeStyle.primaryColor ? '' : styleClass} style={activeStyle.primaryColor ? dynamicStyle : {}}>{text}</span>
    </div>
  );
};
