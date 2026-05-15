import styles from './atelier.module.css';

// Amber gradient rounded-square containing an italic-serif glyph. Used as
// the brand lockup in the AtelierShell header and on the Login top bar.
export function BrandMark({
  glyph = 'w',
  size = 24,
  className,
  ariaLabel,
}: {
  glyph?: string;
  size?: number;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <span
      className={[styles.brandMark, className].filter(Boolean).join(' ')}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.58) }}
      aria-label={ariaLabel}
      aria-hidden={ariaLabel ? undefined : true}
    >
      {glyph}
    </span>
  );
}
