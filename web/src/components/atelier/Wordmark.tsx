import { Link } from 'react-router-dom';
import { BrandMark } from './BrandMark';
import styles from './atelier.module.css';

// Top-left brand lockup. Renders the amber 'w' BrandMark + "Wabisabi"
// wordmark. The AgentChatPane has its own (cyan) brand mark + label for
// the agent's voice ("Caption Studio"); this is the product wordmark.
//
// `tagline` is preserved for back-compat with callers that still pass one;
// when set it renders as a dimmer sub-label after a divider.
export function Wordmark({
  to = '/',
  tagline,
}: {
  to?: string;
  tagline?: string;
}) {
  return (
    <Link to={to} className={styles.wordmark} aria-label="Wabisabi home">
      <BrandMark />
      <span className={styles.wmName}>Wabisabi</span>
      {tagline && (
        <>
          <span className={styles.wmSep} aria-hidden="true" />
          <span className={styles.wmSub}>{tagline}</span>
        </>
      )}
    </Link>
  );
}
