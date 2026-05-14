import { Link } from 'react-router-dom';
import styles from './atelier.module.css';

export function Wordmark({
  to = '/agent/new',
  tagline = 'CAPTION AGENT · V0.1',
}: {
  to?: string;
  tagline?: string;
}) {
  return (
    <Link to={to} className={styles.wordmark} aria-label="Atelier home">
      <span className={styles.wmGlyph} aria-hidden="true">A</span>
      <span className={styles.wmText}>
        <span className={styles.wmName}>Atelier</span>
        <span className={styles.wmTagline}>{tagline}</span>
      </span>
    </Link>
  );
}
