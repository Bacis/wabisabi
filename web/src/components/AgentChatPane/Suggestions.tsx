// Starter prompts shown when the thread is empty. The data is light static
// content for V1 — clip-derived suggestions ("4 ideas from your clip") are
// a V2 concern that needs an extra Claude call.

import { useEditor } from '@/lib/editor/store';
import { Icon } from './Icon';
import styles from './AgentChatPane.module.css';

type Suggestion = {
  t: string;
  d: string;
  ic: 'spark' | 'wand' | 'image' | 'hash';
  prompt: string;
};

const STARTERS: Suggestion[] = [
  {
    t: 'Make the headline pop',
    d: 'boost first 2 words · spring + scale',
    ic: 'wand',
    prompt:
      'Make the opening 1–2 words pop — heavier weight, larger size, faster entry, slight scale-up.',
  },
  {
    t: 'Match a cinematic noir style',
    d: 'cool palette · serif italic accents',
    ic: 'image',
    prompt: 'Match a cinematic noir style — cool palette, serif italic accents, soft vignette.',
  },
  {
    t: 'Highlight every # and @',
    d: 'auto-detect · italic accent variant',
    ic: 'hash',
    prompt: 'Highlight every hashtag and at-mention with a glowing italic accent in violet.',
  },
  {
    t: 'Punchier emphasis on key words',
    d: 'amber + bigger · faster duration',
    ic: 'spark',
    prompt: 'Make emphasized words punchier — amber fill, larger size, faster entry duration.',
  },
];

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
        <span className={styles.small}>· 4 IDEAS FROM YOUR CLIP</span>
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
        {STARTERS.map((s, i) => (
          <button key={i} type="button" className={styles.sug} onClick={() => onPick(s.prompt)}>
            <span className={styles.ico}>
              <Icon name={s.ic} size={15} />
            </span>
            <span className={styles.copy}>
              <div className="t">{s.t}</div>
              <div className="d">{s.d}</div>
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
