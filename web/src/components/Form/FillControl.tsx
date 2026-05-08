import { useState } from 'react';
import { HexAlphaColorPicker } from 'react-colorful';
import type { FillControl as FillControlSpec, FillValue, GradientFill } from '../../lib/types';
import { Field } from './Field';
import { GradientEditor } from './GradientEditor';

type Props = {
  control: FillControlSpec;
  value: FillValue | undefined;
  onChange: (value: FillValue) => void;
};

const DEFAULT_GRADIENT: GradientFill = {
  type: 'linear',
  angle: 90,
  stops: [
    { pos: 0, color: '#ffd700' },
    { pos: 1, color: '#ff2a2a' },
  ],
};

function isGradient(v: FillValue | undefined): v is GradientFill {
  return !!v && typeof v === 'object' && 'stops' in v;
}

function isHexAlpha(s: string): boolean {
  return /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(s);
}

export function FillControl({ control, value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const current: FillValue =
    value !== undefined ? value : (control.default ?? '#ffffff');
  const mode: 'solid' | 'gradient' = isGradient(current) ? 'gradient' : 'solid';

  const switchTo = (next: 'solid' | 'gradient') => {
    if (next === mode) return;
    if (next === 'solid') {
      // Pick the first stop's color when collapsing a gradient.
      const fallback = isGradient(current) ? current.stops[0]?.color ?? '#ffffff' : '#ffffff';
      onChange(fallback);
    } else {
      onChange(DEFAULT_GRADIENT);
    }
  };

  const swatchStyle: React.CSSProperties = isGradient(current)
    ? {
        background: `linear-gradient(${current.angle}deg, ${current.stops
          .map((s) => `${s.color} ${(s.pos * 100).toFixed(1)}%`)
          .join(', ')})`,
      }
    : { backgroundColor: typeof current === 'string' && isHexAlpha(current) ? current : '#ffffff' };

  return (
    <Field label={control.label} description={control.description}>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((s) => !s)}
          className="h-7 w-7 rounded border border-ink-600 shadow-inner"
          style={swatchStyle}
          aria-label="Open fill editor"
        />
        <input
          type="text"
          value={isGradient(current) ? `gradient · ${current.stops.length} stops` : current}
          readOnly={isGradient(current)}
          onChange={(e) => {
            if (!isGradient(current)) onChange(e.target.value.trim());
          }}
          spellCheck={false}
          className="flex-1 rounded bg-ink-700 border border-ink-600 px-2 py-1 text-xs font-mono text-ink-100 focus:outline-none focus:ring-1 focus:ring-amber-400"
        />
      </div>
      {open && (
        <div className="mt-2 rounded border border-ink-600 bg-ink-800 p-2 space-y-2">
          {/* Solid / Gradient tabs */}
          <div className="flex rounded border border-ink-600 overflow-hidden text-[11px]">
            {(['solid', 'gradient'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => switchTo(m)}
                className={`flex-1 py-1 ${
                  mode === m
                    ? 'bg-amber-400 text-ink-900 font-medium'
                    : 'bg-ink-700 text-ink-300 hover:bg-ink-600'
                }`}
              >
                {m === 'solid' ? 'Solid' : 'Gradient'}
              </button>
            ))}
          </div>

          {mode === 'solid' ? (
            <div className="space-y-2">
              <HexAlphaColorPicker
                color={typeof current === 'string' && isHexAlpha(current) ? current : '#ffffff'}
                onChange={(c) => onChange(c)}
              />
              <input
                type="text"
                value={typeof current === 'string' ? current : '#ffffff'}
                onChange={(e) => onChange(e.target.value.trim())}
                spellCheck={false}
                className="w-full rounded bg-ink-700 border border-ink-600 px-2 py-1 text-xs font-mono text-ink-100 focus:outline-none focus:ring-1 focus:ring-amber-400"
              />
            </div>
          ) : (
            <GradientEditor
              value={isGradient(current) ? current : DEFAULT_GRADIENT}
              onChange={(g) => onChange(g)}
            />
          )}
        </div>
      )}
    </Field>
  );
}
