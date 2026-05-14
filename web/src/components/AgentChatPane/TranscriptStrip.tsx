// Clickable transcript inside the chat panel. Clicking a word scopes the
// next agent message to it (point-and-prompt). This is the primary
// affordance — the Remotion <Player> renders captions inside its own
// canvas where we can't reliably overlay clickable hitboxes.

import { useMemo } from 'react';
import { useEditor } from '@/lib/editor/store';
import { Icon } from './Icon';
import styles from './AgentChatPane.module.css';

export function TranscriptStrip() {
  const transcriptText = useEditor((s) => s.transcriptText);
  const durationSec = useEditor((s) => s.durationSec);
  const selectedWord = useEditor((s) => s.selectedWord);
  const selectWordForAgent = useEditor((s) => s.selectWordForAgent);

  // Split transcript on whitespace and assign each word a uniform time slot.
  // Same heuristic as rebuildCaptionsFromTranscript() so word.idx aligns with
  // what the renderer would use after a transcript override.
  const words = useMemo(() => {
    const tokens = transcriptText.split(/\s+/).map((w) => w.trim()).filter(Boolean);
    if (tokens.length === 0 || durationSec <= 0) return [];
    const per = durationSec / tokens.length;
    return tokens.map((text, idx) => ({
      idx,
      text,
      t: idx * per,
      d: per,
    }));
  }, [transcriptText, durationSec]);

  if (words.length === 0) return null;

  return (
    <div className={styles.transcriptStrip}>
      <div className={styles.transcriptStripHead}>
        <Icon name="cursor" size={11} />
        TRANSCRIPT · click a word to scope the next message
      </div>
      <div className={styles.transcriptStripBody}>
        {words.map((w) => {
          const isSelected = selectedWord?.idx === w.idx;
          return (
            <button
              key={w.idx}
              type="button"
              className={`${styles.wordChip}${isSelected ? ' ' + styles.selected : ''}`}
              onClick={() =>
                selectWordForAgent(isSelected ? null : { idx: w.idx, text: w.text, t: w.t, d: w.d })
              }
              title={`${w.t.toFixed(2)}s`}
            >
              {w.text}
            </button>
          );
        })}
      </div>
    </div>
  );
}
