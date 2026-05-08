import { useState } from 'react';
import { HexColorPicker } from 'react-colorful';
import type { ColorListControl } from '../../lib/types';
import { Field } from './Field';

type Props = {
  control: ColorListControl;
  value: string[] | string | undefined;
  onChange: (value: string[]) => void;
};

const DEFAULT_NEW = '#ff66cc';

export function ColorList({ control, value, onChange }: Props) {
  const [open, setOpen] = useState<number | null>(null);
  // The schema accepts a string OR string[]; the editor always works in array
  // form for editing, then writes back the array (which is also valid).
  const colors = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? [value]
      : control.default ?? [];

  const min = control.minColors ?? 1;
  const max = control.maxColors ?? 8;

  const update = (next: string[]) => onChange(next);
  const setAt = (i: number, c: string) => {
    const next = colors.slice();
    next[i] = c;
    update(next);
  };
  const remove = (i: number) => {
    if (colors.length <= min) return;
    update(colors.filter((_, idx) => idx !== i));
    if (open === i) setOpen(null);
  };
  const add = () => {
    if (colors.length >= max) return;
    const last = colors[colors.length - 1] ?? DEFAULT_NEW;
    update([...colors, last]);
  };

  return (
    <Field label={control.label} description={control.description}>
      <div className="space-y-1.5">
        {colors.map((c, i) => {
          const isHex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(c);
          return (
            <div key={i} className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setOpen(open === i ? null : i)}
                className="h-6 w-6 rounded border border-ink-600 shrink-0"
                style={{ backgroundColor: isHex ? c : '#ffffff' }}
                aria-label={`Edit color ${i + 1}`}
              />
              <input
                type="text"
                value={c}
                onChange={(e) => setAt(i, e.target.value.trim())}
                spellCheck={false}
                className="flex-1 rounded bg-ink-700 border border-ink-600 px-2 py-0.5 text-xs font-mono text-ink-100 focus:outline-none focus:ring-1 focus:ring-amber-400"
              />
              <button
                type="button"
                onClick={() => remove(i)}
                disabled={colors.length <= min}
                className="text-ink-400 hover:text-rose-300 disabled:opacity-30 disabled:cursor-not-allowed text-xs px-1"
                aria-label={`Remove color ${i + 1}`}
              >
                ✕
              </button>
            </div>
          );
        })}
        {open !== null && colors[open] && (
          <div className="rounded border border-ink-600 bg-ink-800 p-2">
            <HexColorPicker
              color={colors[open]!}
              onChange={(c) => setAt(open, c)}
            />
          </div>
        )}
        <button
          type="button"
          onClick={add}
          disabled={colors.length >= max}
          className="text-xs text-ink-300 border border-dashed border-ink-600 rounded px-2 py-1 hover:bg-ink-700 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          + add color
        </button>
      </div>
    </Field>
  );
}
