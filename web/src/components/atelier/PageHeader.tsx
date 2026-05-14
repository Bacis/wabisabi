import type { ReactNode } from 'react';
import styles from './atelier.module.css';

export function PageHeader({
  eyebrow,
  title,
  description,
  rightSlot,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  rightSlot?: ReactNode;
}) {
  return (
    <header className={styles.pageHeader}>
      {eyebrow && (
        <div className={styles.crown}>
          {eyebrow}
          <span className={styles.crownRule} aria-hidden="true" />
          {rightSlot}
        </div>
      )}
      {title}
      {description && (
        <p style={{ color: 'var(--ag-ink-3)', fontSize: 14, lineHeight: 1.6, maxWidth: 720, margin: 0 }}>
          {description}
        </p>
      )}
    </header>
  );
}
