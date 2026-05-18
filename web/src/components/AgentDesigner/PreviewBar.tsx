// Cinematic preview bar above the phone frame: clip name + aspect tag +
// duration. (The POINT / PLAYBACK mode toggle that used to live on the
// right was a prototype affordance for "click a word to scope the next
// message"; the live behavior is driven directly by selectedWord in the
// transcript strip + WordStyler, so the duplicate toggle was visual noise.)

import { useEditor } from '@/lib/editor/store';
import { useCanvasDims } from '@/lib/editor/coords';
import styles from '@/components/AgentChatPane/AgentChatPane.module.css';

function fmt(t: number): string {
  return `${t.toFixed(2)}s`;
}

// Reduce w:h to a simple "a : b" label using the GCD. Falls back to a
// compact decimal if the dims aren't whole numbers or the ratio is
// unreasonable. The aspect label sits on the cinematic preview bar so
// readers know whether the canvas is portrait, square, or landscape.
function aspectLabel(w: number, h: number): string {
  if (!(w > 0 && h > 0)) return '—';
  // Snap to common aspects so noisy probed dims (e.g. 1916×1078) round
  // cleanly to 16:9 instead of 958:539.
  const r = w / h;
  if (Math.abs(r - 9 / 16) < 0.05) return '9 : 16';
  if (Math.abs(r - 16 / 9) < 0.05) return '16 : 9';
  if (Math.abs(r - 1) < 0.05) return '1 : 1';
  if (Math.abs(r - 4 / 5) < 0.05) return '4 : 5';
  if (Math.abs(r - 3 / 4) < 0.05) return '3 : 4';
  // Fallback — show a reduced fraction.
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const g = gcd(Math.round(w), Math.round(h)) || 1;
  return `${Math.round(w) / g} : ${Math.round(h) / g}`;
}

export function PreviewBar() {
  const source = useEditor((s) => s.source);
  const durationSec = useEditor((s) => s.durationSec);
  const { canvasW, canvasH } = useCanvasDims();

  const clipName =
    source?.kind === 'stock'
      ? source.clipId
      : source?.kind === 'job'
        ? `upload · ${source.jobId.slice(0, 8)}`
        : 'untitled';

  return (
    <div className={styles.previewBar}>
      <div className={styles.previewBarLeft}>
        <span className={styles.clipName}>
          {source?.kind === 'stock' ? `stock_${source.clipId}.mp4` : clipName}
        </span>
        <span className={styles.tag}>
          <svg
            className={styles.tagIco}
            width="10"
            height="12"
            viewBox="0 0 10 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="1" y="0.6" width="8" height="10.8" rx="1.3" />
            <circle cx="5" cy="9.6" r="0.45" fill="currentColor" stroke="none" />
          </svg>
          {aspectLabel(canvasW, canvasH)}
        </span>
        <span className={styles.tag}>
          <svg
            className={styles.tagIco}
            width="11"
            height="11"
            viewBox="0 0 11 11"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="5.5" cy="5.5" r="4.2" />
            <path d="M5.5 3v2.7l1.6 1" />
          </svg>
          {fmt(durationSec)}
        </span>
      </div>
    </div>
  );
}
