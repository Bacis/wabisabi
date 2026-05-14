// Overlay menu shown while the input value starts with "/". Filters the
// SLASH_COMMANDS list by the typed prefix. Highlights the first match so
// Enter can pick it.

import { Icon } from './Icon';
import { SLASH_COMMANDS, type SlashCommand } from './expandSlash';
import styles from './AgentChatPane.module.css';

export function SlashMenu({
  filter,
  onPick,
}: {
  filter: string; // raw input text starting with "/"
  onPick: (c: SlashCommand) => void;
}) {
  const q = filter.startsWith('/') ? filter.slice(1).toLowerCase() : filter.toLowerCase();
  const items = q
    ? SLASH_COMMANDS.filter((c) => c.cmd.slice(1).toLowerCase().includes(q))
    : SLASH_COMMANDS;
  if (items.length === 0) return null;

  return (
    <div className={styles.slashMenu}>
      <div className={styles.slashHead}>
        <span>
          <span className={styles.key}>/</span> SLASH COMMANDS
        </span>
        <span style={{ flex: 1 }} />
        <span>↑↓ NAV · ↵ RUN</span>
      </div>
      <div className={styles.slashList}>
        {items.map((c, i) => (
          <button
            key={c.cmd}
            type="button"
            className={`${styles.slashItem}${i === 0 ? ' ' + styles.sel : ''}`}
            onClick={() => onPick(c)}
          >
            <span className={styles.ic}>
              <Icon name={c.ic} size={13} />
            </span>
            <span>
              <div className={styles.cmd}>
                {c.cmd} <span className={styles.arg}>{c.arg}</span>
              </div>
              <div className={styles.desc}>{c.desc}</div>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
