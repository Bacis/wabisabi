// Caption renderer. Walks roll.words, emits .w spans (with .lt children for
// letter-split fx) and lets the parent know when a word is clicked. Per-word
// overrides are applied as class/style mutations on the same DOM nodes the
// animation engine targets.
//
// Animation timing comes from CSS custom properties (--i, --j, --word-step,
// --letter-step) on the spans; the actual keyframes live in animations.css.
//
// Free transforms (user drag/rotate/scale) are written via the standalone
// CSS `translate` / `rotate` / `scale` properties — NOT the shorthand
// `transform` — so they compose with the keyframe transforms in animations.css
// instead of clobbering them.

import { useEffect, type CSSProperties, type Ref } from 'react';
import type { LabRoll, AccentSlot } from '../engine/randomizer';
import type {
  BlockTransform,
  WordOverride,
  WordOverrides,
} from '../engine/exportPreset';
import { FX_BY_ID } from '../data/effects';

type Props = {
  roll: LabRoll;
  overrides: WordOverrides;
  selectedWordIdx: number | null;
  onSelectWord: (idx: number) => void;
  onSelectBlock?: () => void;
  blockTransform?: BlockTransform;
  blockSelected?: boolean;
  blockRef?: Ref<HTMLDivElement>;
  // Called once per word render with (idx, element|null) so the parent can
  // collect refs into a Map for react-moveable to target.
  registerWordRef?: (idx: number, el: HTMLSpanElement | null) => void;
};

// Map (slot, italic) → role class (r1..r8). Mirrors the HTML mapping:
//   c1 → r1 (sans) / r2 (italic); c2 → r3/r4; c3 → r5/r6; c4 → r7/r8.
function roleForSlotItalic(slot: AccentSlot, italic: boolean): string {
  const slotIdx = parseInt(slot.slice(1), 10) - 1;
  const baseNum = slotIdx * 2 + 1;
  return italic ? `r${baseNum + 1}` : `r${baseNum}`;
}

function applyWordTransform(style: CSSProperties, ovr: WordOverride | undefined) {
  if (!ovr?.transform) return;
  const { x, y, rot, scale } = ovr.transform;
  // Standalone CSS properties — compose with keyframe `transform`.
  style.translate = `${x}px ${y}px`;
  style.rotate = `${rot}deg`;
  style.scale = `${scale}`;
}

export function LabCaption({
  roll,
  overrides,
  selectedWordIdx,
  onSelectWord,
  onSelectBlock,
  blockTransform,
  blockSelected,
  blockRef,
  registerWordRef,
}: Props) {
  // Drop refs on unmount so stale DOM nodes don't linger in the parent's Map.
  useEffect(
    () => () => {
      if (!registerWordRef) return;
      for (let i = 0; i < roll.words.length; i++) registerWordRef(i, null);
    },
    // Intentional: only run cleanup on unmount. The word count is stable
    // within a single mount (changes bump mountKey upstream).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const containerStyle: CSSProperties = {};
  if (blockTransform) {
    containerStyle.translate = `${blockTransform.x}px ${blockTransform.y}px`;
    containerStyle.alignSelf =
      blockTransform.anchor === 'top'
        ? 'flex-start'
        : blockTransform.anchor === 'bottom'
          ? 'flex-end'
          : 'center';
    containerStyle.justifyContent =
      blockTransform.align === 'left'
        ? 'flex-start'
        : blockTransform.align === 'right'
          ? 'flex-end'
          : 'center';
    containerStyle.textAlign = blockTransform.align;
  }

  return (
    <div
      ref={blockRef}
      className={`caption${blockSelected ? ' caption-selected' : ''}`}
      style={containerStyle}
      onClick={(e) => {
        // Clicking the empty area of the block selects it. Word clicks
        // stopPropagation, so they don't bubble here.
        if (e.target === e.currentTarget) onSelectBlock?.();
      }}
    >
      {roll.words.map((w, i) => {
        const ovr: WordOverride | undefined = overrides[i];
        const isSelected = i === selectedWordIdx;
        const selectedClass = isSelected ? ' w-selected' : '';

        if (w.kind === 'punch') {
          const wobbleClass = w.wobble ? ' punch-wobble' : '';
          const slotForColor = ovr?.colorSlot ?? w.accentSlot;
          const colorVar = ovr?.customColor
            ? ovr.customColor
            : slotForColor
              ? `var(--color0${parseInt(slotForColor.slice(1), 10)})`
              : 'var(--lab-ink)';
          const punchStyle: CSSProperties = {
            ['--i' as never]: i,
            ['--punch-len' as never]: w.word.length,
            ['--word-len' as never]: w.word.length,
            color: colorVar,
          };
          if (ovr && typeof ovr.spacing === 'number') {
            punchStyle.margin = `${ovr.spacing}em 0`;
          }
          applyWordTransform(punchStyle, ovr);

          // When the user picks a custom FX for a punch word, swap the
          // default `.r-punch` entrance (capPunch) for `.r-punch-static`
          // (sizing/coloring only) and add the override fx class. Split
          // into letters when the chosen fx targets `.lt` children.
          const overrideFx = ovr?.fxOverride;
          if (overrideFx) {
            const fxSpec = FX_BY_ID[overrideFx];
            const splitsLetters = fxSpec?.splitsLetters ?? false;
            return (
              <span
                key={i}
                ref={(el) => registerWordRef?.(i, el)}
                className={`w r-punch-static ${overrideFx}${selectedClass}`}
                data-i={i}
                style={punchStyle}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectWord(i);
                }}
              >
                {splitsLetters
                  ? [...w.word].map((ch, j) => (
                      <span
                        key={j}
                        className="lt"
                        data-m={j % 4}
                        style={{ ['--j' as never]: j }}
                      >
                        {ch}
                      </span>
                    ))
                  : w.word}
              </span>
            );
          }

          return (
            <span
              key={i}
              ref={(el) => registerWordRef?.(i, el)}
              className={`w r-punch${wobbleClass}${selectedClass}`}
              data-i={i}
              style={punchStyle}
              onClick={(e) => {
                e.stopPropagation();
                onSelectWord(i);
              }}
            >
              {w.word}
            </span>
          );
        }

        // Body word — figure out the effective role + italic (override → roll
        // → fallback). Color is normally owned by the role class via CSS
        // variables, but a customColor override wins outright.
        const rolledItalic = w.italic;
        const effItalic =
          ovr && ovr.italic !== undefined ? ovr.italic : rolledItalic;
        const effSlot: AccentSlot | null =
          (ovr && ovr.colorSlot) || w.accentSlot;
        const effRole = effSlot
          ? roleForSlotItalic(effSlot, effItalic)
          : effItalic
            ? 'r-ink-serif'
            : 'r-ink-sans';
        const fxClass = ovr?.fxOverride ?? w.fx; // 'we-word' | 'we-stair' | ...
        const splitsLetters = FX_BY_ID[fxClass]?.splitsLetters ?? true;
        const bodyStyle: CSSProperties = {
          ['--i' as never]: i,
          ['--word-len' as never]: w.word.length,
        };
        if (ovr && typeof ovr.spacing === 'number') {
          bodyStyle.marginRight = `${ovr.spacing}em`;
        }
        if (ovr?.customColor) {
          // Inline color wins over the role class's color rule (same
          // specificity, but inline beats stylesheet selectors).
          bodyStyle.color = ovr.customColor;
        }
        applyWordTransform(bodyStyle, ovr);
        return (
          <span
            key={i}
            ref={(el) => registerWordRef?.(i, el)}
            className={`w ${effRole} ${fxClass}${selectedClass}`}
            data-i={i}
            style={bodyStyle}
            onClick={(e) => {
              e.stopPropagation();
              onSelectWord(i);
            }}
          >
            {splitsLetters
              ? [...w.word].map((ch, j) => (
                  <span
                    key={j}
                    className="lt"
                    data-m={j % 4}
                    style={{ ['--j' as never]: j }}
                  >
                    {ch}
                  </span>
                ))
              : w.word}
          </span>
        );
      })}
    </div>
  );
}
