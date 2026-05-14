import { useEffect, useMemo, useRef } from 'react';
import { Player, type PlayerRef } from '@remotion/player';
import { getComposition, hasPlayerSupport } from '@/lib/compositions';
import { useEditor } from '@/lib/editor/store';
import { buildTranscriptFromText } from '@shared/buildTranscript';
import { SelectionLayer } from './SelectionLayer';
import { useStageRect } from './useStageRect';
import { CANVAS_W, CANVAS_H } from '@/lib/editor/coords';
import { FPS } from '@/lib/editor/snap';

export function PreviewPanel({ hideSelection = false }: { hideSelection?: boolean } = {}) {
  const tracks = useEditor((s) => s.tracks);
  const groupStyles = useEditor((s) => s.groupStyles);
  const duration = useEditor((s) => s.durationSec);
  const playing = useEditor((s) => s.playing);
  const currentTime = useEditor((s) => s.currentTime);
  const setCurrentTime = useEditor((s) => s.setCurrentTime);
  const pause = useEditor((s) => s.pause);
  const templateId = useEditor((s) => s.templateId);
  const styleSpec = useEditor((s) => s.styleSpec);
  const transcriptText = useEditor((s) => s.transcriptText);
  const transcriptOverridden = useEditor((s) => s.transcriptOverridden);
  const directorScript = useEditor((s) => s.directorScript);

  const playerRef = useRef<PlayerRef>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const stageRect = useStageRect(stageRef);

  const videoTrack = tracks.find((t) => t.type === 'video');
  const videoFile =
    videoTrack && videoTrack.type === 'video' && videoTrack.items[0]
      ? videoTrack.items[0].src
      : '';

  // Drive the Player from store playback intent.
  useEffect(() => {
    const p = playerRef.current;
    if (!p) return;
    if (playing) p.play();
    else p.pause();
  }, [playing]);

  // Seek when currentTime is set explicitly (e.g. timeline scrub). The
  // tolerance avoids fighting our own timeupdate listener.
  useEffect(() => {
    const p = playerRef.current;
    if (!p) return;
    const target = currentTime * FPS;
    const have = p.getCurrentFrame();
    if (Math.abs(have - target) > 2) {
      p.seekTo(target);
    }
  }, [currentTime]);

  // Push player frame back into the store while playing.
  useEffect(() => {
    const p = playerRef.current;
    if (!p) return;
    const onFrame = () => {
      const f = p.getCurrentFrame();
      setCurrentTime(f / FPS);
    };
    const onEnded = () => pause();
    p.addEventListener('frameupdate', onFrame);
    p.addEventListener('ended', onEnded);
    return () => {
      p.removeEventListener('frameupdate', onFrame);
      p.removeEventListener('ended', onEnded);
    };
  }, [setCurrentTime, pause]);

  const durationInFrames = Math.max(30, Math.ceil(duration * FPS));

  const captionTrack = tracks.find((t) => t.type === 'captions');
  const captionWords =
    captionTrack && captionTrack.type === 'captions' ? captionTrack.items : [];
  const captionGroups =
    captionTrack && captionTrack.type === 'captions' ? captionTrack.groups : [];

  // Build the inputProps for the Player. The live transcript reflects the
  // user's edits on the timeline (per-word) or in the transcript editor
  // (bulk override). For caption-designer template we also pass groups +
  // wordGroupAssignments + the editor state via styleSpec.designer.
  const inputProps = useMemo(() => {
    const liveTranscript = transcriptOverridden
      ? buildTranscriptFromText(transcriptText, duration)
      : {
          language: 'en',
          duration,
          words: captionWords.map((w) => ({
            word: w.text,
            start: w.start,
            end: w.start + w.duration,
            confidence: 1,
          })),
        };

    const wordGroupAssignments: Record<string, string> = {};
    for (const w of captionWords) wordGroupAssignments[w.id] = w.groupId;

    const captionPlan =
      templateId === 'caption-designer'
        ? {
            chunks: [],
            groups: captionGroups,
            wordGroupAssignments,
          }
        : null;

    const mergedStyleSpec =
      templateId === 'caption-designer'
        ? { ...styleSpec, designer: { tracks, groupStyles } }
        : styleSpec;

    return {
      videoFile,
      videoMeta: {
        width: CANVAS_W,
        height: CANVAS_H,
        durationInFrames,
        fps: FPS,
      },
      transcript: liveTranscript,
      captionPlan,
      faces: null,
      styleSpec: mergedStyleSpec,
      // Director plan threads through so <CueLayer> inside the composition
      // can emit <Audio> elements per group/beat audioCue + audioPattern.
      directorScript,
    };
  }, [
    videoFile,
    durationInFrames,
    duration,
    tracks,
    groupStyles,
    templateId,
    styleSpec,
    transcriptText,
    transcriptOverridden,
    captionWords,
    captionGroups,
    directorScript,
  ]);

  const Composition = getComposition(templateId);

  return (
    <div className="aspect-[9/16] h-full max-h-full max-w-full flex-shrink-0">
      <div
        ref={stageRef}
        className="relative h-full w-full rounded-lg overflow-hidden border border-ink-700 bg-black"
      >
        {Composition && hasPlayerSupport(templateId) ? (
          <Player
            ref={playerRef}
            component={Composition}
            inputProps={inputProps}
            durationInFrames={durationInFrames}
            compositionWidth={CANVAS_W}
            compositionHeight={CANVAS_H}
            fps={FPS}
            clickToPlay={false}
            style={{ width: '100%', height: '100%' }}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-ink-400 text-xs px-6 text-center">
            <code>{templateId}</code> doesn't support live preview yet.
          </div>
        )}
        {/* Visual selection works for all templates: caption-designer
            shows per-group + per-overlay hit-zones; other templates show
            a single hit-zone whose default position is measured from the
            rendered caption container's DOM bbox (so it overlays the real
            text from the first click) and which writes
            styleSpec.captionTransform on drag. */}
        {!hideSelection && stageRect && <SelectionLayer rect={stageRect} />}
      </div>
    </div>
  );
}
