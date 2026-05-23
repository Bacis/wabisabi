// Center canvas. Hosts the LabStage (which provides theme CSS variables)
// and a pointer-drag handler bound to whichever element is currently
// selected (the .caption block or one of its word spans).
//
// Why a hand-rolled drag instead of react-moveable: the word spans are
// `display: inline-block` and their bounding box is in continuous flux
// while the keyframe animations in animations.css play. Moveable measures
// its target once on mount, and various combinations of useResizeObserver
// + imperative updateRect() still leave the control-box stuck at 1×1 on
// these targets. Rotation and scale are exposed numerically through
// PropertiesPanel, so dropping the visual handles costs us nothing.
//
// Per-word user transforms persist via the standalone `translate` / `rotate`
// / `scale` CSS properties applied in LabCaption — these compose with the
// keyframes' `transform` instead of clobbering them.

import { useEffect, useMemo, useRef, useCallback } from 'react';
import type { LabRoll } from '../engine/randomizer';
import type {
  BlockTransform,
  WordOverrides,
  WordTransform,
} from '../engine/exportPreset';
import type { Selection } from './selection';
import { LabStage } from './LabStage';
import { LabCaption } from './LabCaption';
import styles from '../LabPage.module.css';

type Props = {
  roll: LabRoll;
  overrides: WordOverrides;
  blockTransform: BlockTransform;
  mountKey: number;
  paused: boolean;
  selection: Selection;
  onSelect: (s: Selection) => void;
  onChangeWordTransform: (idx: number, t: WordTransform) => void;
  onChangeBlockTransform: (patch: Partial<BlockTransform>) => void;
};

const DEFAULT_WORD_TRANSFORM: WordTransform = { x: 0, y: 0, rot: 0, scale: 1 };

export function ComposerCanvas({
  roll,
  overrides,
  blockTransform,
  mountKey,
  paused,
  selection,
  onSelect,
  onChangeWordTransform,
  onChangeBlockTransform,
}: Props) {
  const blockRef = useRef<HTMLDivElement | null>(null);
  const wordRefsRef = useRef<Map<number, HTMLSpanElement>>(new Map());

  const registerWordRef = useCallback(
    (idx: number, el: HTMLSpanElement | null) => {
      if (el) wordRefsRef.current.set(idx, el);
      else wordRefsRef.current.delete(idx);
    },
    [],
  );

  const target = useMemo<HTMLElement | null>(() => {
    if (!selection) return null;
    if (selection.kind === 'block') return blockRef.current;
    return wordRefsRef.current.get(selection.idx) ?? null;
    // mountKey is included so target re-resolves after LabStage remounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, mountKey]);

  // Pointer-drag on the selected element. Mousedown anywhere on the target
  // begins a drag; mousemove updates the override/blockTransform until
  // mouseup. The drag uses screen-px deltas applied as canvas-px (1:1) —
  // the canvas isn't internally scaled, so screen-px == canvas-px.
  useEffect(() => {
    if (!target || !selection) return;

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      // Don't start a drag when the user clicks the move-cursor zone but
      // intends to text-select; only react when the target is the actual
      // selection. The click handler in LabCaption stops propagation, so
      // this only fires when the user mousedowns the *already-selected*
      // element.
      const startScreenX = e.clientX;
      const startScreenY = e.clientY;
      const initial =
        selection.kind === 'word'
          ? (overrides[selection.idx]?.transform ?? DEFAULT_WORD_TRANSFORM)
          : null;
      const initialBlock = selection.kind === 'block' ? { x: blockTransform.x, y: blockTransform.y } : null;

      const onMove = (mv: PointerEvent) => {
        const dx = mv.clientX - startScreenX;
        const dy = mv.clientY - startScreenY;
        if (selection.kind === 'word' && initial) {
          onChangeWordTransform(selection.idx, {
            ...initial,
            x: initial.x + dx,
            y: initial.y + dy,
          });
        } else if (selection.kind === 'block' && initialBlock) {
          onChangeBlockTransform({
            x: initialBlock.x + dx,
            y: initialBlock.y + dy,
          });
        }
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
      e.preventDefault();
    };

    target.addEventListener('pointerdown', onPointerDown);
    // Move cursor while selected so the drag affordance reads visually.
    const prevCursor = target.style.cursor;
    target.style.cursor = 'move';
    return () => {
      target.removeEventListener('pointerdown', onPointerDown);
      target.style.cursor = prevCursor;
    };
  }, [
    target,
    selection,
    overrides,
    blockTransform.x,
    blockTransform.y,
    onChangeWordTransform,
    onChangeBlockTransform,
  ]);

  const isWordSel = selection?.kind === 'word';
  const isBlockSel = selection?.kind === 'block';

  return (
    <div className={styles.canvasWrap}>
      <div
        className={styles.canvasStageHolder}
        onClick={(e) => {
          // Click on the canvas background (not the stage) deselects.
          if (e.target === e.currentTarget) onSelect(null);
        }}
      >
        <LabStage roll={roll} paused={paused} mountKey={mountKey}>
          <LabCaption
            roll={roll}
            overrides={overrides}
            selectedWordIdx={isWordSel ? selection.idx : null}
            onSelectWord={(i) => onSelect({ kind: 'word', idx: i })}
            onSelectBlock={() => onSelect({ kind: 'block' })}
            blockTransform={blockTransform}
            blockSelected={isBlockSel}
            blockRef={blockRef}
            registerWordRef={registerWordRef}
          />
        </LabStage>
      </div>
    </div>
  );
}
