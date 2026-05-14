// Visual separator between turns. Renders a numbered cp marker + label
// drawn from the agent's reply. Hover reveals a "⟲ HOLD TO REVERT" pill
// that calls back to revert this specific turn.

import { Icon } from './Icon';
import styles from './AgentChatPane.module.css';

export function Checkpoint({
  num,
  label,
  onRevert,
}: {
  num: number;
  label: string;
  onRevert?: () => void;
}) {
  return (
    <div
      className={styles.checkpoint}
      onClick={onRevert}
      title={onRevert ? 'Click to revert to this checkpoint' : undefined}
    >
      <span className={styles.num}>{num}</span>
      <span className={styles.lbl}>{label}</span>
      <span className={styles.grow} />
      {onRevert && (
        <span className={styles.revert}>
          <Icon name="undo" size={9} /> REVERT
        </span>
      )}
    </div>
  );
}
