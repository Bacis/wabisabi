import type { ReactNode } from 'react';
import styles from './atelier.module.css';

export type PillToggleOption<T extends string> = {
  value: T;
  label: ReactNode;
  count?: number;
  dot?: boolean;
};

export function PillToggle<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: PillToggleOption<T>[];
  value: T;
  onChange: (next: T) => void;
  ariaLabel?: string;
}) {
  return (
    <div className={styles.pillToggle} role="group" aria-label={ariaLabel}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(opt.value)}
          >
            {opt.dot && <span className={styles.ptDot} aria-hidden="true" />}
            <span>{opt.label}</span>
            {opt.count != null && <span className={styles.ptCount}>{opt.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
