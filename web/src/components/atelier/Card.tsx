import type { ReactNode, MouseEvent, HTMLAttributes } from 'react';
import styles from './atelier.module.css';

type Padding = 'snug' | 'padded' | 'none';

type Props = Omit<HTMLAttributes<HTMLDivElement>, 'onClick'> & {
  children: ReactNode;
  padding?: Padding;
  dashed?: boolean;
  interactive?: boolean;
  flush?: boolean;
  onClick?: (e: MouseEvent<HTMLDivElement>) => void;
  className?: string;
};

export function Card({
  children,
  padding = 'padded',
  dashed,
  interactive,
  flush,
  className,
  onClick,
  ...rest
}: Props) {
  return (
    <div
      {...rest}
      onClick={onClick}
      className={[
        styles.card,
        padding !== 'none' ? styles[padding] : '',
        dashed ? styles.dashed : '',
        interactive ? styles.interactive : '',
        flush ? styles.flush : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </div>
  );
}

export function CardIcon({
  children,
  tone = 'cyan',
}: {
  children: ReactNode;
  tone?: 'cyan' | 'amber';
}) {
  return (
    <span
      className={[styles.cardIcon, tone === 'amber' ? styles.amber : '']
        .filter(Boolean)
        .join(' ')}
      aria-hidden="true"
    >
      {children}
    </span>
  );
}
