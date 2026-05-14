import type { ReactNode } from 'react';
import styles from './atelier.module.css';

type Size = 'sm' | 'md' | 'lg' | 'xl';

export function SerifDisplay({
  children,
  size = 'md',
  as: As = 'h1',
  className,
}: {
  children: ReactNode;
  size?: Size;
  as?: 'h1' | 'h2' | 'h3' | 'p' | 'span' | 'div';
  className?: string;
}) {
  return (
    <As className={[styles.serif, styles[size], className].filter(Boolean).join(' ')}>
      {children}
    </As>
  );
}
