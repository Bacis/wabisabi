import React from 'react';
import {
  AbsoluteFill,
  Audio,
  Img,
  OffthreadVideo,
  Sequence,
  Series,
  staticFile,
} from 'remotion';
import { loadFont } from '@remotion/google-fonts/Inter';
import type { FaceData } from '../lib/positioning';
import {
  CaptionLayer,
  type CaptionPlan,
  type StyleSpec,
  type Transcript,
} from '../lib/CaptionLayer';
import { HopecoreCaptionLayer } from '../lib/HopecoreCaptionLayer';

loadFont('normal', { weights: ['800'], subsets: ['latin'] });

type Clip = {
  fileBasename: string; // basename in public/ or https URL
  kind: 'video' | 'image';
  durationInFrames: number;
  startFromFrame?: number; // for videos: where in the source to begin (after ffmpeg cuts this is usually 0)
  role: 'speaker' | 'broll' | 'image';
  keepAudio: boolean;
  transcript?: Transcript | null;
  captionPlan?: CaptionPlan | null;
  faces?: FaceData | null;
  caption?: string; // optional title-card text for b-roll/image
};

export type StoryProps = {
  clips: Clip[];
  narrationFile?: string | null; // basename in public/ or https URL
  // Global narration captions: per-word transcript in output-timeline seconds
  // and optional LLM-enriched chunking. Rendered as one caption layer above
  // all clips, independent of Series.Sequence boundaries.
  narrationTranscript?: Transcript | null;
  narrationCaptionPlan?: CaptionPlan | null;
  // Frames of engagement-hook video prepended at the start of the timeline.
  // Narration audio is wrapped in <Sequence from={hookDurationInFrames}> so
  // it starts only after the hook ends. Default 0 keeps the non-producer
  // call sites (if any) backward compatible.
  hookDurationInFrames?: number;
  videoMeta: { width: number; height: number; durationInFrames: number; fps: number };
  styleSpec: StyleSpec;
};

function resolveSrc(basenameOrUrl: string): string {
  return basenameOrUrl.startsWith('http') ? basenameOrUrl : staticFile(basenameOrUrl);
}

// Multi-clip story composition. Each clip is one <Series.Sequence>; the
// Remotion runtime rebases useCurrentFrame() to 0 inside each sequence, so
// the caption layer's word timestamps must already be in clip-local time
// (the pipeline rebases them before staging).
//
// B-roll clips show an optional caption title-card instead of full captions.
// Speaker clips render full per-word captions via <CaptionLayer>.
// A single <Audio src={narrationFile}> track plays above everything for
// narrated_story mode; speaker_montage passes narrationFile=null and keeps
// each speaker clip's original audio.
export const StoryComposition: React.FC<StoryProps> = ({
  clips,
  narrationFile,
  narrationTranscript,
  narrationCaptionPlan,
  hookDurationInFrames = 0,
  styleSpec,
}) => {
  const hasNarrationCaptions =
    !!narrationTranscript && narrationTranscript.words.length > 0;
  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      <Series>
        {clips.map((clip, i) => (
          <Series.Sequence key={i} durationInFrames={Math.max(1, clip.durationInFrames)}>
            <AbsoluteFill>
              {clip.kind === 'video' ? (
                <OffthreadVideo
                  src={resolveSrc(clip.fileBasename)}
                  muted={!clip.keepAudio}
                  startFrom={clip.startFromFrame ?? 0}
                />
              ) : (
                <Img
                  src={resolveSrc(clip.fileBasename)}
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              )}
              {clip.role === 'speaker' && clip.transcript && (
                <CaptionLayer
                  transcript={clip.transcript}
                  captionPlan={clip.captionPlan ?? null}
                  faces={clip.faces ?? null}
                  styleSpec={styleSpec}
                />
              )}
              {/* Title cards only when we DON'T have global narration
                  captions — otherwise the two layers compete. */}
              {clip.role !== 'speaker' && clip.caption && !hasNarrationCaptions && (
                <TitleCard text={clip.caption} />
              )}
            </AbsoluteFill>
          </Series.Sequence>
        ))}
      </Series>
      {/* Global narration caption layer — sibling to Series, so
          useCurrentFrame here is the OUTPUT-timeline frame (not rebased
          per sequence). The narration transcript's word times are in the
          same global coordinate space.
          Layer selection: layout.mode === 'editorial' uses the
          hopecore serif layer (ig.mp4 aesthetic: per-word size variance,
          mixed case, serif, freeform). Anything else gets the classic
          PopWords-style flex-row CaptionLayer. */}
      {hasNarrationCaptions && (
        (styleSpec as { layout?: { mode?: string } })?.layout?.mode === 'editorial' ? (
          <HopecoreCaptionLayer
            transcript={narrationTranscript!}
            captionPlan={narrationCaptionPlan ?? null}
            styleSpec={styleSpec}
          />
        ) : (
          <CaptionLayer
            transcript={narrationTranscript!}
            captionPlan={narrationCaptionPlan ?? null}
            faces={null}
            styleSpec={styleSpec}
          />
        )
      )}
      {narrationFile && (
        // Delay narration by the hook's duration. Using <Sequence from=>
        // keeps the mp3 on disk untouched and lets Remotion handle the
        // start-offset the same way it would any other timed sequence.
        <Sequence from={hookDurationInFrames}>
          <Audio src={resolveSrc(narrationFile)} />
        </Sequence>
      )}
    </AbsoluteFill>
  );
};

// Simple bottom-aligned title card for b-roll. Intentionally understated —
// the narration does the heavy lifting; the card is just a visual anchor.
const TitleCard: React.FC<{ text: string }> = ({ text }) => {
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: '12%',
        display: 'flex',
        justifyContent: 'center',
        padding: '0 5%',
      }}
    >
      <div
        style={{
          backgroundColor: 'rgba(0,0,0,0.55)',
          padding: '14px 28px',
          borderRadius: 14,
          maxWidth: '86%',
        }}
      >
        <span
          style={{
            fontFamily: 'Inter',
            fontWeight: 800,
            fontSize: 48,
            color: '#ffffff',
            textTransform: 'uppercase',
            letterSpacing: 1,
            lineHeight: 1.15,
            textAlign: 'center',
            display: 'inline-block',
          }}
        >
          {text}
        </span>
      </div>
    </div>
  );
};
