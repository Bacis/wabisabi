import type { ReactNode } from 'react';
import styles from './atelier.module.css';

type Tone = 'amber' | 'cyan' | 'good' | 'danger' | 'muted';

export function Pill({
  children,
  tone = 'muted',
  dot,
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  dot?: boolean;
  className?: string;
}) {
  return (
    <span
      className={[styles.pill, styles[tone], className].filter(Boolean).join(' ')}
    >
      {dot && <span className={styles.pillDot} aria-hidden="true" />}
      {children}
    </span>
  );
}
