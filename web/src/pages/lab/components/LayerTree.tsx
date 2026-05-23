// Left panel — Canva-style layer tree. The block is the root layer; each
// word is a leaf row. Clicking a row sets selection (drives Moveable target
// + Properties panel content). A small dot indicates the row has overrides.

import type { LabRoll } from '../engine/randomizer';
import type { WordOverrides } from '../engine/exportPreset';
import type { Selection } from './selection';
import { MonoLabel, SerifDisplay } from '@/components/atelier';
import styles from '../LabPage.module.css';

type Props = {
  roll: LabRoll;
  overrides: WordOverrides;
  selection: Selection;
  onSelect: (s: Selection) => void;
};

function hasOverride(o: WordOverrides[number] | undefined): boolean {
  if (!o) return false;
  return (
    o.transform != null ||
    o.customColor != null ||
    o.fxOverride != null ||
    o.colorSlot != null ||
    o.italic !== undefined ||
    o.spacing !== undefined
  );
}

export function LayerTree({ roll, overrides, selection, onSelect }: Props) {
  const blockSelected = selection?.kind === 'block';
  return (
    <aside className={styles.layerTree}>
      <header className={styles.panelHead}>
        <SerifDisplay size="sm" as="h2" className={styles.panelTitle}>
          Layers
        </SerifDisplay>
        <MonoLabel tone="dim">{roll.words.length} words</MonoLabel>
      </header>

      <div className={styles.layerList}>
        <button
          type="button"
          className={[styles.layerRow, styles.layerRowBlock, blockSelected ? styles.layerRowActive : '']
            .filter(Boolean)
            .join(' ')}
          onClick={() => onSelect({ kind: 'block' })}
        >
          <span className={styles.layerCaret} aria-hidden="true">▼</span>
          <span className={styles.layerKind}>Block</span>
          <span className={styles.layerHint}>{roll.scene.name}</span>
        </button>

        <ul className={styles.layerChildren}>
          {roll.words.map((w, i) => {
            const isSelected = selection?.kind === 'word' && selection.idx === i;
            const ovr = overrides[i];
            return (
              <li key={i}>
                <button
                  type="button"
                  className={[styles.layerRow, styles.layerRowWord, isSelected ? styles.layerRowActive : '']
                    .filter(Boolean)
                    .join(' ')}
                  onClick={() => onSelect({ kind: 'word', idx: i })}
                >
                  <span className={styles.layerIdx}>{i + 1}</span>
                  <span className={styles.layerText}>{w.word}</span>
                  {w.kind === 'punch' && (
                    <span className={styles.layerPunch} title="Punch word">★</span>
                  )}
                  {hasOverride(ovr) && (
                    <span className={styles.layerDot} title="Edited" aria-hidden="true" />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </aside>
  );
}
