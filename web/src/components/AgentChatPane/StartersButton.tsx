// In-conversation access to the same PROMPT_STARTERS the Start page offers
// under "Pick a starter". Renders a sparkle iconBtn in the chat header;
// opening it surfaces the 4 starters as cards. Clicking one drops the full
// prompt into the chat composer (via chatPrefill in the editor store) and
// closes the menu — the user can review, edit, and press send themselves.
//
// We deliberately don't auto-fire the chat turn here. Once the user is
// already mid-conversation, silently replacing the input feels surprising;
// letting them confirm preserves agency.

import { useEffect, useRef, useState } from 'react';
import { useEditor } from '@/lib/editor/store';
import { Icon } from './Icon';
import { PROMPT_STARTERS } from '@/data/promptStarters';
import styles from './AgentChatPane.module.css';

export function StartersButton() {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const setChatPrefill = useEditor((s) => s.setChatPrefill);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!anchorRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className={styles.startersAnchor} ref={anchorRef}>
      <button
        type="button"
        className={styles.iconBtn}
        title="Starter prompts"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="sparkle" size={14} />
      </button>
      {open && (
        <div role="menu" className={styles.startersPopover}>
          <div className={styles.startersHead}>
            <span className={styles.startersEyebrow}>Starter prompts</span>
            <span className={styles.startersHint}>
              · drops into composer
            </span>
          </div>
          <div className={styles.startersList}>
            {PROMPT_STARTERS.map((s) => (
              <button
                key={s.id}
                type="button"
                role="menuitem"
                className={styles.startersRow}
                onClick={() => {
                  setChatPrefill(s.prompt);
                  setOpen(false);
                }}
              >
                <span className={styles.startersRowTitle}>{s.title}</span>
                <span className={styles.startersRowDesc}>{s.description}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
