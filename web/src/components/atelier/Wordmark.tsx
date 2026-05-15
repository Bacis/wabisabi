import { Link } from 'react-router-dom';
import { BrandMark } from './BrandMark';
import styles from './atelier.module.css';

// Top-left brand lockup. New form (per Caption Studio · wabisabi design):
//   [amber-square 'w']  CAPTION STUDIO  |  wabisabi
// The `tagline` prop is preserved for back-compat with old callers but is
// rendered as the sub label after the divider when supplied; otherwise we
// default to "wabisabi".
export function Wordmark({
  to = '/',
  tagline,
}: {
  to?: string;
  tagline?: string;
}) {
  return (
    <Link to={to} className={styles.wordmark} aria-label="Caption Studio home">
      <BrandMark />
      <span className={styles.wmName}>Caption Studio</span>
      <span className={styles.wmSep} aria-hidden="true" />
      <span className={styles.wmSub}>{tagline ?? 'wabisabi'}</span>
    </Link>
  );
}
