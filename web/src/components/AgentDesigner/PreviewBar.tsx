// Cinematic preview bar above the phone frame: clip name + aspect tag +
// duration on the left, POINT / PLAYBACK mode toggle on the right.
//
// POINT mode is the prototype's affordance for "click a word to scope the
// next message"; here it's a visual toggle that mirrors whether
// selectedWord is non-null (transcript strip clicks toggle it).

import { useEditor } from '@/lib/editor/store';
import { Icon } from '@/components/AgentChatPane/Icon';
import styles from '@/components/AgentChatPane/AgentChatPane.module.css';

function fmt(t: number): string {
  return `${t.toFixed(2)}s`;
}

export function PreviewBar() {
  const source = useEditor((s) => s.source);
  const durationSec = useEditor((s) => s.durationSec);
  const selectedWord = useEditor((s) => s.selectedWord);
  const clearSelectedWord = useEditor((s) => s.clearSelectedWord);

  const clipName =
    source?.kind === 'stock'
      ? source.clipId
      : source?.kind === 'job'
        ? `upload · ${source.jobId.slice(0, 8)}`
        : 'untitled';

  return (
    <div className={styles.previewBar}>
      <div className="left">
        <span className={styles.clipName}>
          {source?.kind === 'stock' ? `stock_${source.clipId}.mp4` : clipName}
        </span>
        <span className={styles.tag}>9 : 16</span>
        <span className={styles.tag}>{fmt(durationSec)}</span>
      </div>
      <div className="right">
        <div className={styles.modeToggle}>
          <button
            type="button"
            className={selectedWord ? styles.active : ''}
            onClick={() => {
              // No-op when already on; clicking turns OFF point mode.
              if (selectedWord) clearSelectedWord();
            }}
            title="Click a transcript word in the chat to scope the next message"
          >
            <span className={styles.dot} /> POINT &amp; PROMPT
          </button>
          <button
            type="button"
            className={!selectedWord ? styles.active : ''}
            onClick={() => {
              if (selectedWord) clearSelectedWord();
            }}
          >
            <Icon name="play" size={9} />
            PLAYBACK
          </button>
        </div>
      </div>
    </div>
  );
}
