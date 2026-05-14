// Remotion composition for the Caption Designer. The full editor state
// (tracks, groupStyles) is passed in via the permissive `styleSpec.designer`
// field — no schema change is needed because StyleSpec is z.any().
//
// Rendering pipeline:
//   - Video clip (one per the editor's "single-video" model) → <Video>
//   - Overlay items → <Sequence> + <AbsoluteFill> with per-item transform
//   - Caption groups: each frame finds the active word, locates its group,
//     and renders an <AbsoluteFill> at the group's transform with all phrase
//     words inside; the active word springs up via Remotion's spring().
//   - Audio clips (currently always empty in V1) → <Audio>
//
// Falls back gracefully when `styleSpec.designer` is absent (e.g. someone
// renders this composition with reel-clone-shaped inputs by mistake): just
// renders the video file and exits.

import React from 'react';
import {
  AbsoluteFill,
  Video,
  Audio,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
  spring,
  interpolate,
} from 'remotion';

type Transform = {
  x: number;
  y: number;
  w: number;
  h: number;
  rot: number;
};

type GroupStyle = {
  id: string;
  name: string;
  bg: string;
  text: string;
  activeBg: string;
  activeText: string;
  weight: number;
  scaleActive: number;
  rotateActive: number;
  baseFontSize: number;
  padX: number;
  padY: number;
  radius: number;
  glow: string | null;
  color: string;
};

type CaptionGroup = {
  id: string;
  name: string;
  styleId: string;
  transform: Transform;
};

type CaptionWord = {
  id: string;
  text: string;
  start: number;     // seconds
  duration: number;
  groupId: string;
};

type VideoClip = { id: string; start: number; duration: number; src: string };
type AudioClip = { id: string; start: number; duration: number; src: string; label: string };
type OverlayItem = {
  id: string;
  start: number;
  duration: number;
  label: string;
  transform: Transform;
};

type Track =
  | { id: string; type: 'video'; name: string; items: VideoClip[] }
  | { id: string; type: 'audio'; name: string; items: AudioClip[] }
  | { id: string; type: 'overlay'; name: string; items: OverlayItem[] }
  | { id: string; type: 'captions'; name: string; items: CaptionWord[]; groups: CaptionGroup[] };

type DesignerPayload = {
  tracks: Track[];
  groupStyles: Record<string, GroupStyle>;
};

// Subset of styleSpec.animation the active-word renderer respects. Lets the
// agent's apply_style_patch / tune_field tools drive entry behavior here even
// though the rest of the StyleSpec is per-group via styleSpec.designer.
type AnimationOverrides = {
  preset?: 'pop' | 'fade' | 'karaoke' | 'typewriter' | 'slide';
  durationMs?: number;
  emphasisScale?: number;
  scaleFrom?: number;
  spring?: { damping?: number; stiffness?: number; mass?: number };
};

type Props = {
  videoFile: string;
  videoMeta: { width: number; height: number; durationInFrames: number; fps: number };
  transcript: unknown;
  captionPlan: unknown;
  faces: unknown;
  styleSpec: { designer?: DesignerPayload; animation?: AnimationOverrides } & Record<string, unknown>;
};

const CANVAS_W = 1080;
const CANVAS_H = 1920;

export const CaptionDesigner: React.FC<Props> = ({ videoFile, styleSpec }) => {
  const { fps } = useVideoConfig();
  const designer = styleSpec?.designer;

  if (!designer) {
    return (
      <AbsoluteFill style={{ background: '#000' }}>
        {videoFile && (
          <Video src={videoFile} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        )}
      </AbsoluteFill>
    );
  }

  const videoTrack = designer.tracks.find((t) => t.type === 'video');
  const audioTrack = designer.tracks.find((t) => t.type === 'audio');
  const overlayTrack = designer.tracks.find((t) => t.type === 'overlay');
  const captionTrack = designer.tracks.find((t) => t.type === 'captions');

  return (
    <AbsoluteFill style={{ background: '#000' }}>
      {/* Video — currently the model allows one clip; render whichever is at the start. */}
      {videoTrack?.type === 'video' &&
        videoTrack.items.map((clip) => (
          <Sequence
            key={clip.id}
            from={Math.round(clip.start * fps)}
            durationInFrames={Math.max(1, Math.round(clip.duration * fps))}
          >
            <Video src={clip.src} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          </Sequence>
        ))}

      {/* Audio — added clips play alongside the video. */}
      {audioTrack?.type === 'audio' &&
        audioTrack.items.map((clip) => (
          <Sequence
            key={clip.id}
            from={Math.round(clip.start * fps)}
            durationInFrames={Math.max(1, Math.round(clip.duration * fps))}
          >
            <Audio src={clip.src} />
          </Sequence>
        ))}

      {/* Overlays */}
      {overlayTrack?.type === 'overlay' &&
        overlayTrack.items.map((item) => (
          <Sequence
            key={item.id}
            from={Math.round(item.start * fps)}
            durationInFrames={Math.max(1, Math.round(item.duration * fps))}
          >
            <OverlayLayer item={item} />
          </Sequence>
        ))}

      {/* Captions */}
      {captionTrack?.type === 'captions' && (
        <CaptionsLayer
          words={captionTrack.items}
          groups={captionTrack.groups}
          groupStyles={designer.groupStyles}
          animation={styleSpec.animation}
        />
      )}
    </AbsoluteFill>
  );
};

const OverlayLayer: React.FC<{ item: OverlayItem }> = ({ item }) => {
  const t = item.transform;
  return (
    <div
      style={{
        position: 'absolute',
        left: `${(t.x / CANVAS_W) * 100}%`,
        top: `${(t.y / CANVAS_H) * 100}%`,
        width: `${(t.w / CANVAS_W) * 100}%`,
        height: `${(t.h / CANVAS_H) * 100}%`,
        transform: `rotate(${t.rot}deg)`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#fff',
        fontSize: 64,
        fontWeight: 700,
        textShadow: '0 4px 24px rgba(0,0,0,0.55)',
      }}
    >
      {item.label}
    </div>
  );
};

const CaptionsLayer: React.FC<{
  words: CaptionWord[];
  groups: CaptionGroup[];
  groupStyles: Record<string, GroupStyle>;
  animation?: AnimationOverrides;
}> = ({ words, groups, groupStyles, animation }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const tSec = frame / fps;

  // Find the currently active word.
  const active = words.find((w) => tSec >= w.start && tSec < w.start + w.duration);
  if (!active) return null;

  const group = groups.find((g) => g.id === active.groupId);
  if (!group) return null;

  const style = groupStyles[group.styleId] ?? groupStyles[Object.keys(groupStyles)[0] ?? ''];
  if (!style) return null;

  const phraseWords = words.filter((w) => w.groupId === group.id);
  const t = group.transform;
  const fontSize = (t.w / CANVAS_W) * style.baseFontSize;

  return (
    <div
      style={{
        position: 'absolute',
        left: `${(t.x / CANVAS_W) * 100}%`,
        top: `${(t.y / CANVAS_H) * 100}%`,
        width: `${(t.w / CANVAS_W) * 100}%`,
        height: `${(t.h / CANVAS_H) * 100}%`,
        transform: `rotate(${t.rot}deg)`,
        display: 'flex',
        flexWrap: 'wrap',
        alignContent: 'center',
        justifyContent: 'center',
        gap: `${fontSize * 0.25}px`,
        fontWeight: style.weight,
      }}
    >
      {phraseWords.map((w) => (
        <Word
          key={w.id}
          word={w}
          active={w.id === active.id}
          style={style}
          fontSize={fontSize}
          fps={fps}
          frame={frame}
          animation={animation}
        />
      ))}
    </div>
  );
};

const Word: React.FC<{
  word: CaptionWord;
  active: boolean;
  style: GroupStyle;
  fontSize: number;
  fps: number;
  frame: number;
  animation?: AnimationOverrides;
}> = ({ word, active, style, fontSize, fps, frame, animation }) => {
  // Spring on activation: when the active word changes, this Word
  // re-mounts (different key path is not used; Remotion keeps Words across
  // frames so we read frame relative to word.start to drive the spring).
  const activeFrame = frame - Math.round(word.start * fps);

  // Pull animation overrides — agent's apply_style_patch / tune_field tools
  // write here. Falling back to the original hardcoded values means inactive
  // (no styleSpec.animation set) behaves identically to pre-override.
  const preset = animation?.preset ?? 'pop';
  const damping = animation?.spring?.damping ?? 12;
  const stiffness = animation?.spring?.stiffness ?? 180;
  const mass = animation?.spring?.mass ?? 1;
  const targetScale = animation?.emphasisScale ?? style.scaleActive;
  const fromScale = animation?.scaleFrom ?? 1;
  const durationFrames =
    animation?.durationMs != null
      ? Math.max(1, Math.round((animation.durationMs / 1000) * fps))
      : null;

  // 'pop' (and 'karaoke', 'typewriter') keep spring-driven scale.
  // 'fade' opacity-only entry; 'slide' opacity + translateY.
  let scale = 1;
  let opacity = 1;
  let translateY = 0;
  let rotate = 0;

  if (active) {
    if (preset === 'fade') {
      const durF = durationFrames ?? Math.round(0.25 * fps);
      opacity = interpolate(activeFrame, [0, durF], [0, 1], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      });
      scale = targetScale;
    } else if (preset === 'slide') {
      const durF = durationFrames ?? Math.round(0.3 * fps);
      opacity = interpolate(activeFrame, [0, durF], [0, 1], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      });
      translateY = interpolate(activeFrame, [0, durF], [fontSize * 0.5, 0], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      });
      scale = targetScale;
    } else if (preset === 'karaoke') {
      // Karaoke: instant highlight, no scale/opacity animation — let the
      // bg/color swap carry the read.
      scale = targetScale;
    } else {
      // 'pop' / default / 'typewriter' fallback: spring scale from fromScale
      // to targetScale. durationMs influences perceived snap only via the
      // spring config; if user wants slower, they lower stiffness.
      const s = spring({ frame: activeFrame, fps, config: { damping, stiffness, mass } });
      scale = interpolate(s, [0, 1], [fromScale, targetScale]);
      rotate = interpolate(s, [0, 1], [0, style.rotateActive]);
    }
  }

  return (
    <span
      style={{
        display: 'inline-block',
        padding: `${fontSize * style.padY}px ${fontSize * style.padX}px`,
        borderRadius: `${fontSize * style.radius}px`,
        background: active ? style.activeBg : style.bg,
        color: active ? style.activeText : style.text,
        fontSize,
        lineHeight: 1.1,
        boxShadow: active && style.glow ? `0 0 ${fontSize * 0.8}px ${style.glow}` : undefined,
        transform: `translateY(${translateY}px) scale(${scale}) rotate(${rotate}deg)`,
        transformOrigin: 'center',
        opacity,
        whiteSpace: 'nowrap',
      }}
    >
      {word.text}
    </span>
  );
};
