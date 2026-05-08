import { useState } from 'react';
import { HexColorPicker } from 'react-colorful';
import type { ColorControl } from '../../lib/types';
import { Field } from './Field';

type Props = {
  control: ColorControl;
  value: string | undefined;
  onChange: (value: string) => void;
};

export function ColorPicker({ control, value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const v = value ?? control.default ?? '#ffffff';
  const isHex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v);
  return (
    <Field label={control.label} description={control.description}>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((s) => !s)}
          className="h-7 w-7 rounded border border-ink-600 shadow-inner"
          style={{ backgroundColor: isHex ? v : '#ffffff' }}
          aria-label="Open color picker"
        />
        <input
          type="text"
          value={v}
          onChange={(e) => onChange(e.target.value.trim())}
          spellCheck={false}
          className="flex-1 rounded bg-ink-700 border border-ink-600 px-2 py-1 text-xs font-mono text-ink-100 focus:outline-none focus:ring-1 focus:ring-amber-400"
        />
      </div>
      {open && (
        <div className="mt-2 rounded border border-ink-600 bg-ink-800 p-2">
          <HexColorPicker color={isHex ? v : '#ffffff'} onChange={onChange} />
        </div>
      )}
    </Field>
  );
}
