// Real audio waveform of the source clip. Replaces the prior decorative
// "audio peaks" lane (synthetic sine bars). Decodes the video's audio
// track via Web Audio API and renders min/max bucket pairs as a centered
// bar strip — same vibe as a DAW track.

import { useEditor } from '@/lib/editor/store';
import { useAudioPeaks } from './useAudioPeaks';
import styles from '@/components/AgentChatPane/AgentChatPane.module.css';

function videoSrcFromTracks(
  tracks: Array<{ type: string; items: Array<{ src?: string }> }>,
): string | null {
  const v = tracks.find((t) => t.type === 'video');
  return v?.items?.[0]?.src ?? null;
}

export function AudioWaveform({ height = 28 }: { height?: number }) {
  const tracks = useEditor((s) => s.tracks) as unknown as Array<{
    type: string;
    items: Array<{ src?: string }>;
  }>;
  const src = videoSrcFromTracks(tracks);
  const { peaks, loading, error } = useAudioPeaks(src, 600);

  return (
    <div className={`${styles.ctlLane} ${styles.waveform}`} style={{ height }}>
      {loading && (
        <span className={styles.waveformStatus}>decoding audio…</span>
      )}
      {error && (
        <span className={styles.waveformStatus} title={error}>
          waveform unavailable
        </span>
      )}
      {peaks && (
        <svg
          className={styles.waveformSvg}
          viewBox={`0 0 ${peaks.bucketCount} 100`}
          preserveAspectRatio="none"
          aria-label="Audio waveform"
        >
          {Array.from({ length: peaks.bucketCount }, (_, i) => {
            const min = peaks.data[i * 2] ?? 0;
            const max = peaks.data[i * 2 + 1] ?? 0;
            // Map [-1, 1] → [0, 100], centered at 50.
            const y1 = 50 - max * 50;
            const y2 = 50 - min * 50;
            return (
              <line
                key={i}
                x1={i + 0.5}
                x2={i + 0.5}
                y1={y1}
                y2={y2}
                stroke="currentColor"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
        </svg>
      )}
    </div>
  );
}
