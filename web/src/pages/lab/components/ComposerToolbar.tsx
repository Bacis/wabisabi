// Toolbar strip above the composer grid. Holds the current theme/scene/fx
// labels (read-only badges) and the four primary actions: Reroll (re-randomize
// per-word plans within the same theme+scene+fx), New (pick a fresh theme/
// scene/fx), Play/Pause, and Copy JSON.

import { Button, MonoLabel } from '@/components/atelier';
import type { LabRoll } from '../engine/randomizer';
import styles from '../LabPage.module.css';

type Props = {
  roll: LabRoll;
  playing: boolean;
  onReroll: () => void;
  onTogglePlay: () => void;
  onCopyJson: () => void;
  onSaveTheme: () => void;
};

const PlayIcon = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M8 5v14l11-7L8 5z" />
  </svg>
);
const PauseIcon = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <rect x="6" y="5" width="4" height="14" />
    <rect x="14" y="5" width="4" height="14" />
  </svg>
);

export function ComposerToolbar({
  roll,
  playing,
  onReroll,
  onTogglePlay,
  onCopyJson,
  onSaveTheme,
}: Props) {
  return (
    <header className={styles.toolbar}>
      <div className={styles.toolbarTitle}>
        <span className={styles.toolbarBrand}>Caption Lab</span>
        <span className={styles.toolbarSep} aria-hidden="true">·</span>
        <span className={styles.toolbarMode}>Composer</span>
      </div>

      <div className={styles.toolbarBadges}>
        <span className={styles.toolbarBadge}>
          <MonoLabel tone="dim">Theme</MonoLabel>
          <span className={styles.toolbarBadgeValue}>{roll.theme.name}</span>
        </span>
        <span className={styles.toolbarBadge}>
          <MonoLabel tone="dim">Scene</MonoLabel>
          <span className={styles.toolbarBadgeValue}>{roll.scene.name}</span>
        </span>
        <span className={styles.toolbarBadge}>
          <MonoLabel tone="dim">FX</MonoLabel>
          <span className={styles.toolbarBadgeValue}>
            {roll.bodyFx.label} → {roll.emphasisFx.label}
          </span>
        </span>
      </div>

      <div className={styles.toolbarActions}>
        <Button
          size="sm"
          variant="ghost"
          className={styles.toolbarGhost}
          onClick={onTogglePlay}
          leadingIcon={playing ? PauseIcon : PlayIcon}
        >
          {playing ? 'Pause' : 'Play'}
        </Button>
        <Button size="sm" variant="cyan" onClick={onReroll}>
          Reroll
        </Button>
        <Button size="sm" variant="ghost" className={styles.toolbarGhost} onClick={onCopyJson}>
          Copy JSON
        </Button>
        <Button size="sm" variant="primary" onClick={onSaveTheme}>
          Save theme
        </Button>
      </div>
    </header>
  );
}
