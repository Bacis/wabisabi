import { useMemo } from 'react';
import styles from './atelier.module.css';

// Deterministic full-bleed scatter. Mirrors the recipe in
// AgentDesigner/PhoneFrame.tsx — pseudo-random positions keyed off index so
// re-renders don't shimmer.
export function StarField({
  count = 72,
  opacity = 0.7,
  className,
}: {
  count?: number;
  opacity?: number;
  className?: string;
}) {
  const stars = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        x: (i * 173) % 100,
        y: (i * 97 + 13) % 100,
        o: (0.18 + ((i * 31) % 100) / 220) * opacity,
        s: 1 + (i % 3) * 0.6,
      })),
    [count, opacity],
  );
  return (
    <div
      className={[styles.starField, className].filter(Boolean).join(' ')}
      aria-hidden="true"
    >
      {stars.map((s, i) => (
        <span
          key={i}
          className={styles.star}
          style={{
            left: `${s.x}%`,
            top: `${s.y}%`,
            width: s.s,
            height: s.s,
            opacity: s.o,
          }}
        />
      ))}
    </div>
  );
}
