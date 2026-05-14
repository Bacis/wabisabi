import styles from './atelier.module.css';

export function Halo({ soft, className }: { soft?: boolean; className?: string }) {
  return (
    <div
      className={[styles.halo, soft ? styles.soft : '', className]
        .filter(Boolean)
        .join(' ')}
      aria-hidden="true"
    />
  );
}

export function DotGrid({ className }: { className?: string }) {
  return (
    <div
      className={[styles.dotGrid, className].filter(Boolean).join(' ')}
      aria-hidden="true"
    />
  );
}
