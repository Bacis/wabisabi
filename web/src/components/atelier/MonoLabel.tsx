import type { HTMLAttributes, ReactNode } from 'react';
import styles from './atelier.module.css';

type Tone = 'default' | 'dim' | 'bright' | 'amber' | 'cyan' | 'danger';

export function MonoLabel({
  children,
  tone = 'default',
  dot,
  className,
  as: As = 'span',
  ...rest
}: {
  children: ReactNode;
  tone?: Tone;
  dot?: boolean;
  as?: 'span' | 'div' | 'p';
} & HTMLAttributes<HTMLElement>) {
  const toneClass = tone !== 'default' ? styles[tone] : '';
  return (
    <As
      {...rest}
      className={[styles.monoLabel, toneClass, className].filter(Boolean).join(' ')}
    >
      {dot && <span className={styles.dot} aria-hidden="true" />}
      {children}
    </As>
  );
}
