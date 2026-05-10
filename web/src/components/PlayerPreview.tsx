import { useMemo } from 'react';
import { Player } from '@remotion/player';
import { getComposition, hasPlayerSupport } from '../lib/compositions';
import { StillPreview } from './StillPreview';
import type { CaptionPlan, Transcript } from '../lib/api';

type Props = {
  videoSrc: string;
  templateId: string;
  styleSpec: Record<string, any>;
  transcript: Transcript;
  captionPlan: CaptionPlan | null;
  fallbackFrameSec: number;
  // When false, the source input was swept off disk so the live <Player>
  // overlay would just show black. We swap to a plain <video> of the
  // rendered output mp4 — captions are baked in already, edits are
  // disabled, but the user at least sees what was made. Stock-clip and
  // theme-detail sources never trip this branch (their video is permanent).
  inputAvailable: boolean;
  status: 'queued' | 'running' | 'done' | 'failed';
  outputUrl: string | null;
  // The /jobs/:id/preview endpoint is the still-preview fallback for
  // templates without Player support. Stock-clip sources have a parallel
  // /themes/preview endpoint, but we only need to thread it through if a
  // future template loses Player support — both currently-registered
  // templates ('pop-words', 'reel-clone') hit the live Player path, so
  // this still-fallback is dead code in practice. When the source is a
  // job we keep wiring it; otherwise we hide the still pane entirely.
  jobIdForStillPreview?: string;
};

const FPS = 30;
const COMP_WIDTH = 1080;
const COMP_HEIGHT = 1920;

export function PlayerPreview({
  videoSrc,
  templateId,
  styleSpec,
  transcript,
  captionPlan,
  fallbackFrameSec,
  inputAvailable,
  status,
  outputUrl,
  jobIdForStillPreview,
}: Props) {
  // View-only fallback: input gone but the render is done. The output mp4
  // already has captions baked in; just play it as a plain <video>.
  if (!inputAvailable && status === 'done' && outputUrl) {
    return (
      <div className="space-y-2">
        <div className="aspect-[9/16] w-full max-w-[420px] mx-auto bg-ink-800 rounded-lg overflow-hidden border border-ink-700">
          <video
            src={outputUrl}
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
      videoFile: videoSrc,
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
    [videoSrc, transcript, captionPlan, styleSpec],
  );

  if (!Composition || !hasPlayerSupport(templateId)) {
    if (!jobIdForStillPreview) {
      return (
        <div className="aspect-[9/16] w-full max-w-[420px] mx-auto bg-ink-800 rounded-lg overflow-hidden border border-ink-700 flex items-center justify-center text-ink-400 text-xs px-6 text-center">
          <code>{templateId}</code> isn't supported in live preview yet.
        </div>
      );
    }
    return (
      <div className="space-y-2">
        <StillPreview
          jobId={jobIdForStillPreview}
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
      />
    </div>
  );
}
