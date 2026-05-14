// Word styler — pill-shaped horizontal toolbar that floats at the top of
// the preview stage when a word is selected. Mirrors the prototype's
// `.word-styler` (ai-preview.jsx). All controls are cosmetic in V1; the
// agent does the actual mutation when the user hits "ask agent" — that
// pre-fills the chat input with a targeted prompt.

import { useState } from 'react';
import { useEditor } from '@/lib/editor/store';
import { Icon } from '@/components/AgentChatPane/Icon';
import styles from '@/components/AgentChatPane/AgentChatPane.module.css';

type Motion = 'pop' | 'drift' | 'kinetic' | 'steady' | 'burst' | 'flicker';
type Fx = 'off' | 'soft glow' | 'drop' | 'stroke';

export function WordStyler({
  onAskAgent,
}: {
  onAskAgent: (prefilled: string) => void;
}) {
  const selectedWord = useEditor((s) => s.selectedWord);
  const clearSelectedWord = useEditor((s) => s.clearSelectedWord);
  const styleSpec = useEditor((s) => s.styleSpec);

  const [size, setSize] = useState(100);
  const [italic, setItalic] = useState(false);
  const [underline, setUnderline] = useState(false);
  const [strike, setStrike] = useState(false);
  const [motion] = useState<Motion>('pop');
  const [fx] = useState<Fx>('off');

  if (!selectedWord) return null;

  // Derive the current fill color from the latest patch (or a sensible default).
  const color =
    (styleSpec as { color?: { fill?: string } }).color?.fill ??
    (Array.isArray((styleSpec as { color?: { emphasisFill?: unknown } }).color?.emphasisFill)
      ? (((styleSpec as { color?: { emphasisFill?: string[] } }).color?.emphasisFill ?? [])[0] ??
        '#f4b942')
      : ((styleSpec as { color?: { emphasisFill?: string } }).color?.emphasisFill ?? '#f4b942'));

  return (
    <div className={styles.wordStyler} onMouseDown={(e) => e.stopPropagation()}>
      {/* Target — Aa swatch + word + timecode */}
      <div className={styles.wsSection}>
        <div className={styles.wsTarget}>
          <div className={styles.aa}>Aa</div>
          <div className={styles.meta}>
            <div className={styles.word}>
              <span className={styles.quo}>"</span>
              {selectedWord.text}
              <span className={styles.quo}>"</span>
            </div>
            <div className={styles.sub}>
              <b>{selectedWord.t.toFixed(2)}s</b>
            </div>
          </div>
        </div>
      </div>

      {/* Type — Aa pill */}
      <div className={styles.wsSection}>
        <button type="button" className={`${styles.wsPill} ${styles.mono}`} title="Type">
          <span style={{ fontSize: 13, lineHeight: 1, fontWeight: 800 }}>Aa</span>
          <Icon name="caret-down" size={8} />
        </button>
      </div>

      {/* Size — track + handle + percent */}
      <div className={styles.wsSection}>
        <div
          className={styles.wsSizeTrack}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const pct = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
            setSize(Math.round(40 + pct * 120));
          }}
        >
          <div className={styles.wsSizeFill} style={{ width: `${((size - 40) / 120) * 100}%` }} />
          <div className={styles.wsSizeHead} style={{ left: `${((size - 40) / 120) * 100}%` }} />
        </div>
        <span className={styles.wsSizeVal}>{size}%</span>
      </div>

      {/* Style toggles — I / U / S */}
      <div className={styles.wsSection}>
        <div className={styles.wsToggleGrp}>
          <button
            type="button"
            className={italic ? styles.on : ''}
            onClick={() => setItalic(!italic)}
            style={{ fontStyle: 'italic' }}
            title="Italic"
          >
            I
          </button>
          <button
            type="button"
            className={underline ? styles.on : ''}
            onClick={() => setUnderline(!underline)}
            style={{ textDecoration: 'underline' }}
            title="Underline"
          >
            U
          </button>
          <button
            type="button"
            className={strike ? styles.on : ''}
            onClick={() => setStrike(!strike)}
            style={{ textDecoration: 'line-through' }}
            title="Strikethrough"
          >
            S
          </button>
        </div>
      </div>

      {/* Fill chip */}
      <div className={styles.wsSection}>
        <button type="button" className={styles.wsColorChip} title={`Fill ${color}`}>
          <span className={styles.wsColorDot} style={{ background: color }} />
          <Icon name="caret-down" size={8} />
        </button>
      </div>

      {/* Motion */}
      <div className={styles.wsSection}>
        <button type="button" className={`${styles.wsPill} ${styles.mono}`} title="Motion">
          {motion}
          <Icon name="caret-down" size={8} />
        </button>
      </div>

      {/* FX */}
      <div className={styles.wsSection}>
        <button type="button" className={`${styles.wsPill} ${styles.mono}`} title="Effects">
          <Icon name="sparkle" size={9} />
          {fx}
          <Icon name="caret-down" size={8} />
        </button>
      </div>

      {/* CTA */}
      <div className={styles.wsSection} style={{ gap: 4 }}>
        <button
          type="button"
          className={styles.wsAsk}
          onClick={() => onAskAgent(`tweak "${selectedWord.text}" — `)}
        >
          <Icon name="sparkle" size={10} />
          ask agent
        </button>
        <button type="button" className={styles.wsIconBtn} title="Revert">
          <Icon name="undo" size={11} />
        </button>
        <button type="button" className={styles.wsIconBtn} title="Duplicate">
          <Icon name="layers" size={11} />
        </button>
        <button type="button" className={`${styles.wsIconBtn} ${styles.danger}`} title="Delete">
          <Icon name="x" size={11} />
        </button>
      </div>

      <button
        type="button"
        className={styles.wsClose}
        onClick={() => clearSelectedWord()}
        title="Close (esc)"
        aria-label="Close word styler"
      >
        <Icon name="x" size={10} />
      </button>
    </div>
  );
}
