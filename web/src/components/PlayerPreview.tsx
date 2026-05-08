import { useMemo } from 'react';
import { Player } from '@remotion/player';
import { getComposition, hasPlayerSupport } from '../lib/compositions';
import { StillPreview } from './StillPreview';
import type { CaptionPlan, Transcript } from '../lib/api';

type Props = {
  jobId: string;
  templateId: string;
  styleSpec: Record<string, any>;
  transcript: Transcript;
  captionPlan: CaptionPlan | null;
  fallbackFrameSec: number;
  // When false, the source input was swept off disk so the live <Player>
  // overlay would just show black. We swap to a plain <video> of the
  // rendered output mp4 — captions are baked in already, edits are
  // disabled, but the user at least sees what was made.
  inputAvailable: boolean;
  jobStatus: 'queued' | 'running' | 'done' | 'failed';
};

const FPS = 30;
const COMP_WIDTH = 1080;
const COMP_HEIGHT = 1920;

export function PlayerPreview({
  jobId,
  templateId,
  styleSpec,
  transcript,
  captionPlan,
  fallbackFrameSec,
  inputAvailable,
  jobStatus,
}: Props) {
  // View-only fallback: input gone but the render is done. The output mp4
  // already has captions baked in; just play it as a plain <video>.
  if (!inputAvailable && jobStatus === 'done') {
    return (
      <div className="space-y-2">
        <div className="aspect-[9/16] w-full max-w-[420px] mx-auto bg-ink-800 rounded-lg overflow-hidden border border-ink-700">
          <video
            src={`/jobs/${jobId}/output`}
            controls
            loop
            preload="metadata"
            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
          />
        </div>
        <p className="text-[11px] text-ink-400 text-center max-w-[420px] mx-auto">
          Source input expired — playing the rendered output. Live edits are
          disabled; re-upload the original to keep tweaking.
        </p>
      </div>
    );
  }

  const Composition = getComposition(templateId);

  // Memoize inputProps so Player doesn't re-mount every render.
  const inputProps = useMemo(
    () => ({
      videoFile: `/jobs/${jobId}/input`,
      videoMeta: {
        width: COMP_WIDTH,
        height: COMP_HEIGHT,
        durationInFrames: Math.max(1, Math.ceil((transcript.duration ?? 30) * FPS)),
        fps: FPS,
      },
      transcript,
      captionPlan,
      faces: null,
      styleSpec,
    }),
    [jobId, transcript, captionPlan, styleSpec],
  );

  if (!Composition || !hasPlayerSupport(templateId)) {
    // Templates that aren't registered (kinetic-burst, three-effects,
    // story-composition) — fall back to the server-side still-frame path.
    return (
      <div className="space-y-2">
        <StillPreview
          jobId={jobId}
          styleSpec={styleSpec}
          templateId={templateId}
          frameSec={fallbackFrameSec}
        />
        <p className="text-[11px] text-ink-400 text-center">
          Real-time playback isn't supported for <code>{templateId}</code> yet — showing
          server-rendered still preview at {fallbackFrameSec.toFixed(1)}s.
        </p>
      </div>
    );
  }

  const durationInFrames = Math.max(
    30,
    Math.ceil((transcript.duration ?? 30) * FPS),
  );

  return (
    <div className="aspect-[9/16] w-full max-w-[420px] mx-auto bg-ink-800 rounded-lg overflow-hidden border border-ink-700">
      <Player
        component={Composition}
        inputProps={inputProps}
        durationInFrames={durationInFrames}
        compositionWidth={COMP_WIDTH}
        compositionHeight={COMP_HEIGHT}
        fps={FPS}
        controls
        loop
        autoPlay={false}
        style={{ width: '100%', height: '100%' }}
        // The Player tries to honor compositionWidth × compositionHeight at
        // 1080×1920; we render it at the container's actual size and let
        // Player scale internally.
      />
    </div>
  );
}
