import type { ReactNode } from 'react';
import styles from './atelier.module.css';

export function Chip({
  children,
  subtle,
  dot,
  className,
}: {
  children: ReactNode;
  subtle?: boolean;
  dot?: boolean;
  className?: string;
}) {
  return (
    <span
      className={[styles.chip, subtle ? styles.subtle : '', className]
        .filter(Boolean)
        .join(' ')}
    >
      {dot && <span className={styles.chipDot} aria-hidden="true" />}
      {children}
    </span>
  );
}
