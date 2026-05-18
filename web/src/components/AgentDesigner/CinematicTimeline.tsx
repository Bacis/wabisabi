// Caption-focused timeline. Sits below the preview on /designer/*.
//
// Visual hierarchy (top → bottom):
//   1. Title bar          — "TIMELINE"
//   2. Ruler              — 1s ticks
//   3. Scenes lane        — Director groups (one pill per scene) when a
//                           DirectorScript is present, OR a single
//                           transcript band showing the truncated
//                           transcript when no plan has been emitted yet.
//   4. Audio peaks lane   — decorative spectrogram-ish bars (subtle)
//   5. Playhead           — amber, follows currentTime
//
// We don't render individual word pills here anymore — at real clip
// lengths (90+ words) the strip turned into unreadable noise. Hover
// tooltips on group pills + the chat's transcript view cover the
// "what does this say" read path.

import { useMemo } from 'react';
import { useEditor } from '@/lib/editor/store';
import styles from '@/components/AgentChatPane/AgentChatPane.module.css';
import { TimelineGroupsLane } from './TimelineGroupsLane';
import { AudioWaveform } from './AudioWaveform';
import { AudioFxLane } from './AudioFxLane';
import { TimelineLegend } from './TimelineLegend';

export function CinematicTimeline() {
  const transcriptText = useEditor((s) => s.transcriptText);
  const durationSec = useEditor((s) => s.durationSec);
  const currentTime = useEditor((s) => s.currentTime);
  const directorScript = useEditor((s) => s.directorScript);
  const seek = useEditor((s) => s.seek);

  const dur = durationSec || 1;
  const pct = (t: number) => (t / dur) * 100;
  // Render a tick mark every second for visual rhythm, but only print a
  // label every Nth tick so the ruler stays readable on long clips.
  // ~10 labels max across the visible range; targets that empirically fit
  // the editor's timeline width without overlapping.
  const labelStep = useMemo(() => {
    if (dur <= 10) return 1;
    if (dur <= 30) return 5;
    if (dur <= 120) return 10;
    return 30;
  }, [dur]);
  const ticks = useMemo(() => {
    const out: Array<{ t: number; labeled: boolean }> = [];
    for (let s = 0; s <= dur; s += 1) {
      out.push({ t: s, labeled: s % labelStep === 0 });
    }
    return out;
  }, [dur, labelStep]);

  function seekFromEvent(e: React.MouseEvent<HTMLDivElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    seek(Math.max(0, Math.min(dur, x * dur)));
  }

  const hasDirectorScript =
    !!directorScript && directorScript.groups.length > 0;
  const hasAudioFx = useMemo(() => {
    if (!directorScript) return false;
    return (
      directorScript.groups.some((g) => g.audioCue || g.audioPattern) ||
      directorScript.beats.some((b) => b.audioCue)
    );
  }, [directorScript]);

  return (
    <>
      <div className={styles.ctlBar}>
        <span className={styles.ttl}>
          <span className={styles.dot} /> TIMELINE
        </span>
        <TimelineLegend
          hasDirectorScript={hasDirectorScript}
          hasAudioFx={hasAudioFx}
        />
        <span style={{ flex: 1 }} />
        <button type="button" className={styles.ico} title="Collapse">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M4 10l4-4 4 4" />
          </svg>
        </button>
      </div>
      <div className={styles.ctlBody}>
        <div className={styles.ctlRuler} onClick={seekFromEvent}>
          {ticks.map(({ t, labeled }, i) => (
            <span key={i}>
              <span className={styles.ctlTick} style={{ left: `${pct(t)}%` }} />
              {labeled && (
                <span className={styles.ctlTickLbl} style={{ left: `${pct(t)}%` }}>
                  {t}s
                </span>
              )}
            </span>
          ))}
        </div>
        {hasDirectorScript ? (
          <TimelineGroupsLane onSeek={seek} />
        ) : (
          <TranscriptBand transcriptText={transcriptText} onSeek={seekFromEvent} />
        )}
        <AudioWaveform />
        <AudioFxLane />
        <div className={styles.ctlPlayhead} style={{ left: `${pct(currentTime)}%` }}>
          <span className={styles.stamp}>{currentTime.toFixed(2)}s</span>
        </div>
      </div>
    </>
  );
}

// Fallback for the "no DirectorScript yet" state. One full-width band
// with a truncated transcript inside, so the user can see what the clip
// is about without needing per-word pills. Clicking seeks at the cursor.
function TranscriptBand({
  transcriptText,
  onSeek,
}: {
  transcriptText: string;
  onSeek: (e: React.MouseEvent<HTMLDivElement>) => void;
}) {
  const trimmed = transcriptText.replace(/\s+/g, ' ').trim();
  const preview = trimmed || 'No transcript on this clip yet.';
  return (
    <div className={styles.ctlLane} onClick={onSeek} title={trimmed}>
      <div className={styles.transcriptBand}>
        <span className={styles.transcriptBandLabel}>TRANSCRIPT</span>
        <span className={styles.transcriptBandBody}>{preview}</span>
      </div>
    </div>
  );
}
