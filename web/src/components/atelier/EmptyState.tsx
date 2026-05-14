import type { ReactNode } from 'react';
import styles from './atelier.module.css';

export function EmptyState({
  title,
  body,
  action,
  className,
}: {
  title: ReactNode;
  body?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={[styles.empty, className].filter(Boolean).join(' ')}>
      <span className={styles.emptyTitle}>{title}</span>
      {body && <span className={styles.emptyBody}>{body}</span>}
      {action}
    </div>
  );
}
