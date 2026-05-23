// Right panel — properties for the current selection. Switches between a
// BlockProperties view (position + alignment + anchor) and WordProperties
// (color slot / italic / fx / transform / custom hex). Falls back to an empty
// state when nothing is selected.

import { useEffect, useRef, useState } from 'react';
import { Button, MonoLabel, PillToggle, SerifDisplay } from '@/components/atelier';
import type { LabRoll, AccentSlot } from '../engine/randomizer';
import type { WordPlan } from '../engine/randomizer';
import type {
  BlockTransform,
  WordOverride,
  WordOverrides,
  WordTransform,
} from '../engine/exportPreset';
import { INTENSE_FX, SUBTLE_FX, WORD_FX } from '../data/effects';
import type { WordFxId, WordFxSpec } from '../data/effects';
import { FONT_PAIRINGS, pairingForFamilies } from '../data/fonts';
import { THEMES, THEME_CATEGORIES, THEMES_BY_CATEGORY } from '../data/themes';
import type { Selection } from './selection';
import styles from '../LabPage.module.css';

const SLOTS: AccentSlot[] = ['c1', 'c2', 'c3', 'c4'];
const DEFAULT_WORD_TRANSFORM: WordTransform = { x: 0, y: 0, rot: 0, scale: 1 };

type Props = {
  roll: LabRoll;
  overrides: WordOverrides;
  blockTransform: BlockTransform;
  selection: Selection;
  onSetWordOverride: (idx: number, patch: WordOverride | null) => void;
  onClearWordOverride: (idx: number) => void;
  onChangeBlockTransform: (patch: Partial<BlockTransform>) => void;
  onResetBlockTransform: () => void;
  onSetPairing: (pairingId: string) => void;
  onSetTheme: (themeId: string) => void;
  onSetBodyFx: (fxId: WordFxId) => void;
  onSetEmphasisFx: (fxId: WordFxId) => void;
  onSetPunch: (idx: number) => void;
};

export function PropertiesPanel({
  roll,
  overrides,
  blockTransform,
  selection,
  onSetWordOverride,
  onClearWordOverride,
  onChangeBlockTransform,
  onResetBlockTransform,
  onSetPairing,
  onSetTheme,
  onSetBodyFx,
  onSetEmphasisFx,
  onSetPunch,
}: Props) {
  let body: React.ReactNode;
  if (!selection) {
    body = (
      <div className={styles.propEmpty}>
        <MonoLabel tone="dim">Nothing selected</MonoLabel>
        <p className={styles.propEmptyHint}>
          Click the block or any word in the canvas (or in the layers list) to
          edit its style and motion.
        </p>
      </div>
    );
  } else if (selection.kind === 'block') {
    body = (
      <BlockProperties
        roll={roll}
        blockTransform={blockTransform}
        onChange={onChangeBlockTransform}
        onReset={onResetBlockTransform}
        onSetPairing={onSetPairing}
        onSetTheme={onSetTheme}
        onSetBodyFx={onSetBodyFx}
        onSetEmphasisFx={onSetEmphasisFx}
      />
    );
  } else {
    const w = roll.words[selection.idx];
    body = (
      <WordProperties
        roll={roll}
        word={w}
        override={overrides[selection.idx]}
        onPatch={(patch) => onSetWordOverride(selection.idx, patch)}
        onReset={() => onClearWordOverride(selection.idx)}
        onMakePunch={() => onSetPunch(selection.idx)}
      />
    );
  }

  return (
    <aside className={styles.properties}>
      <header className={styles.panelHead}>
        <SerifDisplay size="sm" as="h2" className={styles.panelTitle}>
          Properties
        </SerifDisplay>
        <MonoLabel tone="dim">
          {selection?.kind === 'block'
            ? 'Block'
            : selection?.kind === 'word'
              ? `Word ${selection.idx + 1}`
              : '—'}
        </MonoLabel>
      </header>
      <div className={styles.propBody}>{body}</div>
    </aside>
  );
}

function BlockProperties({
  roll,
  blockTransform,
  onChange,
  onReset,
  onSetPairing,
  onSetTheme,
  onSetBodyFx,
  onSetEmphasisFx,
}: {
  roll: LabRoll;
  blockTransform: BlockTransform;
  onChange: (patch: Partial<BlockTransform>) => void;
  onReset: () => void;
  onSetPairing: (pairingId: string) => void;
  onSetTheme: (themeId: string) => void;
  onSetBodyFx: (fxId: WordFxId) => void;
  onSetEmphasisFx: (fxId: WordFxId) => void;
}) {
  return (
    <>
      <Section title="Scene">
        <SceneReadout roll={roll} />
      </Section>

      <Section title="Theme">
        <ThemePicker roll={roll} onSetTheme={onSetTheme} />
      </Section>

      <Section title="Body FX">
        <FxSelect
          value={roll.bodyFx.id}
          description={roll.bodyFx.description}
          options={SUBTLE_FX}
          onChange={onSetBodyFx}
          ariaLabel="Body FX"
        />
      </Section>

      <Section title="Emphasis FX">
        <FxSelect
          value={roll.emphasisFx.id}
          description={roll.emphasisFx.description}
          options={INTENSE_FX}
          onChange={onSetEmphasisFx}
          ariaLabel="Emphasis FX"
        />
      </Section>

      <Section title="Font pairing">
        <PairingPicker roll={roll} onSetPairing={onSetPairing} />
      </Section>

      <Section title="Position">
        <NumberField
          label="X"
          value={blockTransform.x}
          onChange={(v) => onChange({ x: v })}
        />
        <NumberField
          label="Y"
          value={blockTransform.y}
          onChange={(v) => onChange({ y: v })}
        />
      </Section>

      <Section title="Alignment">
        <PillToggle
          options={[
            { value: 'left', label: 'Left' },
            { value: 'center', label: 'Center' },
            { value: 'right', label: 'Right' },
          ]}
          value={blockTransform.align}
          onChange={(next) => onChange({ align: next })}
          ariaLabel="Block alignment"
        />
      </Section>

      <Section title="Anchor">
        <PillToggle
          options={[
            { value: 'top', label: 'Top' },
            { value: 'middle', label: 'Middle' },
            { value: 'bottom', label: 'Bottom' },
          ]}
          value={blockTransform.anchor}
          onChange={(next) => onChange({ anchor: next })}
          ariaLabel="Block anchor"
        />
      </Section>

      <Button size="sm" variant="ghost" onClick={onReset} fullWidth>
        Reset block
      </Button>
    </>
  );
}

function WordProperties({
  roll,
  word,
  override,
  onPatch,
  onReset,
  onMakePunch,
}: {
  roll: LabRoll;
  word: WordPlan;
  override: WordOverride | undefined;
  onPatch: (patch: WordOverride) => void;
  onReset: () => void;
  onMakePunch: () => void;
}) {
  const transform = override?.transform ?? DEFAULT_WORD_TRANSFORM;
  const effSlot = override?.colorSlot ?? word.accentSlot ?? null;
  const effItalic =
    override?.italic !== undefined
      ? override.italic
      : word.kind === 'body'
        ? word.italic
        : false;
  // Punch words don't carry a rolled `fx` field — when one is selected and
  // no override is set yet, show 'Plain' as the seed so the dropdown has a
  // sensible default for the user to pick from.
  const effFx: WordFxId =
    override?.fxOverride ??
    (word.kind === 'body' ? word.fx : 'we-word');
  const customColor = override?.customColor ?? '';

  return (
    <>
      <Section title="Word">
        <div className={styles.propWordRow}>
          <span className={styles.propWordText}>"{word.word}"</span>
          {word.kind === 'punch' && (
            <span className={styles.propPunchTag}>PUNCH</span>
          )}
        </div>
        <Button
          size="sm"
          variant={word.kind === 'punch' ? 'primary' : 'ghost'}
          onClick={onMakePunch}
          disabled={word.kind === 'punch'}
          fullWidth
        >
          {word.kind === 'punch' ? '★ Current punch word' : 'Make this the punch'}
        </Button>
      </Section>

      <Section title="Color slot">
        <div className={styles.slotRow}>
          {SLOTS.map((slot) => {
            const hex =
              roll.accents.find((a) => a.key === slot)?.hex ?? roll.theme[slot];
            const active = effSlot === slot && !customColor;
            return (
              <button
                key={slot}
                type="button"
                className={[styles.slot, active ? styles.slotActive : '']
                  .filter(Boolean)
                  .join(' ')}
                style={{ background: hex }}
                onClick={() =>
                  // Clear customColor when picking a slot so the role color
                  // takes over again.
                  onPatch({ colorSlot: slot, customColor: undefined })
                }
                aria-label={`Color ${slot}`}
                title={slot}
              />
            );
          })}
        </div>
      </Section>

      <Section title="Custom color">
        <div className={styles.colorRow}>
          <input
            type="color"
            value={customColor || '#ffffff'}
            onChange={(e) => onPatch({ customColor: e.target.value })}
            className={styles.colorInput}
            aria-label="Custom color"
          />
          <input
            type="text"
            value={customColor}
            placeholder="#hex"
            onChange={(e) => onPatch({ customColor: e.target.value || undefined })}
            className={styles.hexInput}
          />
        </div>
      </Section>

      {word.kind === 'body' && (
        <Section title="Italic">
          <PillToggle
            options={[
              { value: 'sans', label: 'Sans' },
              { value: 'italic', label: 'Italic' },
            ]}
            value={effItalic ? 'italic' : 'sans'}
            onChange={(next) => onPatch({ italic: next === 'italic' })}
            ariaLabel="Italic toggle"
          />
        </Section>
      )}

      <Section title="Animation FX">
        <FxSelect
          value={effFx}
          options={WORD_FX}
          onChange={(fxId) => onPatch({ fxOverride: fxId })}
          ariaLabel="Word FX"
        />
      </Section>

      <Section title="Transform">
        <div className={styles.xfRow}>
          <NumberField
            label="X"
            value={transform.x}
            onChange={(v) => onPatch({ transform: { ...transform, x: v } })}
          />
          <NumberField
            label="Y"
            value={transform.y}
            onChange={(v) => onPatch({ transform: { ...transform, y: v } })}
          />
        </div>
        <div className={styles.xfRow}>
          <NumberField
            label="Rot°"
            value={transform.rot}
            step={1}
            onChange={(v) => onPatch({ transform: { ...transform, rot: v } })}
          />
          <NumberField
            label="Scale"
            value={transform.scale}
            step={0.05}
            min={0.1}
            onChange={(v) =>
              onPatch({ transform: { ...transform, scale: Math.max(0.1, v) } })
            }
          />
        </div>
      </Section>

      <Button size="sm" variant="ghost" onClick={onReset} fullWidth>
        Reset word
      </Button>
    </>
  );
}

function SceneReadout({ roll }: { roll: LabRoll }) {
  return (
    <div className={styles.sceneReadout}>
      <span className={styles.rollValue}>{roll.scene.name}</span>
      <span className={styles.rollMeta}>
        {roll.words.length} words · {roll.scene.dur}s
      </span>
    </div>
  );
}

const SLOT_KEYS = ['c1', 'c2', 'c3', 'c4'] as const;

function ThemePicker({
  roll,
  onSetTheme,
}: {
  roll: LabRoll;
  onSetTheme: (themeId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close on outside click + Escape. Mousedown so the listener fires before
  // a click inside an option (which itself toggles state) gets eaten.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className={styles.themePicker}>
      <button
        type="button"
        className={styles.themePickerButton}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Theme"
      >
        <span className={styles.themePickerName}>{roll.theme.name}</span>
        <ThemeSwatchRow theme={roll.theme} accents={roll.accents} />
        <span className={styles.themePickerCaret} aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <ul className={styles.themePickerList} role="listbox">
          {THEME_CATEGORIES.map((cat) => {
            const themes = THEMES_BY_CATEGORY[cat.id];
            if (themes.length === 0) return null;
            return (
              <li key={cat.id} className={styles.themePickerGroup}>
                <div
                  className={styles.themePickerGroupHeader}
                  role="presentation"
                  aria-hidden="true"
                >
                  {cat.label}
                  <span className={styles.themePickerGroupCount}>
                    {themes.length}
                  </span>
                </div>
                <ul role="group" aria-label={cat.label}>
                  {themes.map((t) => {
                    const active = t.id === roll.theme.id;
                    return (
                      <li key={t.id}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={active}
                          className={[
                            styles.themePickerOption,
                            active ? styles.themePickerOptionActive : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          onClick={() => {
                            onSetTheme(t.id);
                            setOpen(false);
                          }}
                        >
                          <span className={styles.themePickerName}>{t.name}</span>
                          <ThemeSwatchRow theme={t} />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function ThemeSwatchRow({
  theme,
  accents,
}: {
  theme: LabRoll['theme'];
  // If provided, swatches reflect post-brightening accent hex; otherwise
  // the theme's raw slot colors (useful for option rows that preview a
  // theme that hasn't been rolled yet).
  accents?: LabRoll['accents'];
}) {
  return (
    <span className={styles.themePickerSwatches} aria-hidden="true">
      {SLOT_KEYS.map((slot) => {
        const hex =
          accents?.find((a) => a.key === slot)?.hex ?? theme[slot];
        return (
          <span
            key={slot}
            className={styles.themeSwatch}
            style={{ background: hex }}
            title={`${slot} · ${hex}`}
          />
        );
      })}
      <span
        className={styles.themeBg}
        style={{ background: theme.bg }}
        title={`bg · ${theme.bg}`}
      />
    </span>
  );
}

// Reusable FX dropdown — used both for body/emphasis pickers on the block
// (each with its filtered option set) and for the per-word override picker
// (all FX visible, so a single word can pull from either pool).
function FxSelect({
  value,
  options,
  description,
  onChange,
  ariaLabel,
}: {
  value: WordFxId;
  options: readonly WordFxSpec[];
  description?: string;
  onChange: (fxId: WordFxId) => void;
  ariaLabel: string;
}) {
  return (
    <div className={styles.pickerStack}>
      <select
        className={styles.fxSelect}
        value={value}
        onChange={(e) => onChange(e.target.value as WordFxId)}
        aria-label={ariaLabel}
      >
        {options.map((f) => (
          <option key={f.id} value={f.id}>
            {f.label}
          </option>
        ))}
      </select>
      {description && <p className={styles.fxDescription}>{description}</p>}
    </div>
  );
}

function PairingPicker({
  roll,
  onSetPairing,
}: {
  roll: LabRoll;
  onSetPairing: (pairingId: string) => void;
}) {
  // Active pair = the roll's pairing if it exactly matches a curated entry,
  // else look up by families (covers older rolls without a pairing field).
  const active =
    roll.pairing ??
    pairingForFamilies(roll.fontSans[1], roll.fontSerif[1]) ??
    FONT_PAIRINGS[0];
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className={styles.themePicker}>
      <button
        type="button"
        className={styles.themePickerButton}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Font pairing"
      >
        <span className={styles.pairingButtonStack}>
          <span className={styles.pairingButtonLabel}>{active.name}</span>
          <PairingSamples pair={active} compact />
        </span>
        <span className={styles.themePickerCaret} aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <ul className={styles.themePickerList} role="listbox">
          {FONT_PAIRINGS.map((p) => {
            const isActive = p.id === active.id;
            return (
              <li key={p.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  className={[
                    styles.themePickerOption,
                    styles.pairingPickerOption,
                    isActive ? styles.themePickerOptionActive : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onClick={() => {
                    onSetPairing(p.id);
                    setOpen(false);
                  }}
                >
                  <span className={styles.pairingOptionStack}>
                    <span className={styles.pairingButtonLabel}>{p.name}</span>
                    <PairingSamples pair={p} />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function PairingSamples({
  pair,
  compact,
}: {
  pair: { sans: readonly [string, string]; serif: readonly [string, string] };
  compact?: boolean;
}) {
  return (
    <span
      className={
        compact ? styles.pairingSamplesCompact : styles.pairingSamples
      }
    >
      <span
        className={styles.pairingSampleSans}
        style={{
          fontFamily: pair.sans[0],
          fontWeight: 800,
          letterSpacing: '0.005em',
        }}
      >
        {pair.sans[1]}
      </span>
      <span
        className={styles.pairingSampleSerif}
        style={{
          fontFamily: pair.serif[0],
          fontStyle: 'italic',
          fontWeight: 700,
          letterSpacing: '-0.008em',
        }}
      >
        {pair.serif[1]}
      </span>
    </span>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className={styles.propSection}>
      <MonoLabel tone="dim" className={styles.propSectionTitle}>
        {title}
      </MonoLabel>
      <div className={styles.propSectionBody}>{children}</div>
    </section>
  );
}

function NumberField({
  label,
  value,
  onChange,
  step = 1,
  min,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
}) {
  return (
    <label className={styles.numberField}>
      <span className={styles.numberFieldLabel}>{label}</span>
      <input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        step={step}
        min={min}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(n);
        }}
      />
    </label>
  );
}
