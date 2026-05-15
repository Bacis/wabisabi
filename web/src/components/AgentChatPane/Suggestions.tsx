// Starter prompts shown when the thread is empty. The PROMPT_STARTERS data
// lives in web/src/data/promptStarters.ts so the Start page composer and
// the in-conversation StartersButton (chat header) can share the same set.

import { useEditor } from '@/lib/editor/store';
import { Icon } from './Icon';
import { PROMPT_STARTERS } from '@/data/promptStarters';
import styles from './AgentChatPane.module.css';

// Highlight hashtags and at-mentions in the transcribed preview line so
// the eye lands on the punchier words the agent can target.
function HighlightedSnippet({ text }: { text: string }) {
  const parts = text.split(/(\s+)/);
  return (
    <>
      {parts.map((p, i) => {
        if (/^[#@][^\s]+/.test(p)) {
          return (
            <span key={i} className={styles.kw}>
              {p}
            </span>
          );
        }
        return <span key={i}>{p}</span>;
      })}
    </>
  );
}

export function Suggestions({ onPick }: { onPick: (text: string) => void }) {
  const transcriptText = useEditor((s) => s.transcriptText);
  const durationSec = useEditor((s) => s.durationSec);
  const wordCount = transcriptText.split(/\s+/).filter(Boolean).length;
  // Audio "peaks" — match the cinematic timeline's heuristic so the
  // header context line stays consistent with what users see below.
  const peakCount = Math.max(1, Math.ceil(wordCount / 3));
  const preview = transcriptText.slice(0, 160).trim() + (transcriptText.length > 160 ? '…' : '');

  return (
    <div className={styles.suggestions}>
      <div className={styles.sugHead}>
        <span className={styles.eyebrow}>Where shall we start?</span>
        <span className={styles.small}>
          · {PROMPT_STARTERS.length} IDEAS FROM YOUR CLIP
        </span>
      </div>
      {transcriptText && (
        <div className={styles.transcribed}>
          Clip transcribed:{' '}
          <b>
            "<HighlightedSnippet text={preview} />"
          </b>
          {' · '}
          <span className={styles.kw}>{durationSec.toFixed(2)}s</span>
          {' · '}
          {wordCount} words {' · '} {peakCount} audio peaks
        </div>
      )}
      <div className={styles.sugList}>
        {PROMPT_STARTERS.map((s) => (
          <button
            key={s.id}
            type="button"
            className={styles.sug}
            onClick={() => onPick(s.prompt)}
          >
            <span className={styles.ico}>
              <Icon name={s.icon} size={15} />
            </span>
            <span className={styles.copy}>
              <div className="t">{s.title}</div>
              <div className="d">{s.description}</div>
            </span>
            <span className={styles.arr}>
              <Icon name="arrow" size={13} />
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
