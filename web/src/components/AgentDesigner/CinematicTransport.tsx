// Cinematic playback transport — replaces the shadcn-styled TransportBar
// under /agent/new. Same store actions; just different visual treatment.

import { useEditor } from '@/lib/editor/store';
import { Icon } from '@/components/AgentChatPane/Icon';
import styles from '@/components/AgentChatPane/AgentChatPane.module.css';

function fmt(t: number): string {
  const m = Math.floor(t / 60);
  const s = (t - m * 60).toFixed(2);
  return `${m}:${s.padStart(5, '0')}`;
}

export function CinematicTransport() {
  const playing = useEditor((s) => s.playing);
  const currentTime = useEditor((s) => s.currentTime);
  const duration = useEditor((s) => s.durationSec);
  const pxPerSec = useEditor((s) => s.pxPerSec);
  const snapEnabled = useEditor((s) => s.snapEnabled);
  const togglePlay = useEditor((s) => s.togglePlay);
  const seek = useEditor((s) => s.seek);
  const zoomIn = useEditor((s) => s.zoomIn);
  const zoomOut = useEditor((s) => s.zoomOut);
  const setSnapEnabled = useEditor((s) => s.setSnapEnabled);

  const pct = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className={styles.transport}>
      <button
        type="button"
        className={`${styles.play}${playing ? ' ' + styles.playing : ''}`}
        onClick={togglePlay}
        title="Play / pause (Space)"
      >
        <Icon name={playing ? 'pause' : 'play'} size={13} />
      </button>
      <div className={styles.time}>
        {fmt(currentTime)} <span className={styles.total}>/ {fmt(duration)}</span>
      </div>
      <div
        className={styles.scrub}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const x = (e.clientX - r.left) / r.width;
          seek(Math.max(0, Math.min(duration, x * duration)));
        }}
      >
        <div className={styles.fill} style={{ width: `${pct}%` }} />
        <div className={styles.head} style={{ left: `${pct}%` }} />
      </div>
      <button
        type="button"
        className={`${styles.snap}${snapEnabled ? ' ' + styles.on : ''}`}
        onClick={() => setSnapEnabled(!snapEnabled)}
        title="Snap to frame (S)"
        aria-pressed={snapEnabled}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M5 2v6a3 3 0 003 3h0a3 3 0 003-3V2M5 14h6" />
        </svg>
      </button>
      <div className={styles.zoomGrp}>
        <button type="button" onClick={zoomOut} title="Zoom out (-)">−</button>
        <span className={styles.val}>{Math.round(pxPerSec)}</span>
        <button type="button" onClick={zoomIn} title="Zoom in (+)">+</button>
      </div>
      <span className={styles.kbd}>SPACE</span>
    </div>
  );
}
