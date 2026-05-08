import { HexAlphaColorPicker } from 'react-colorful';
import { useState } from 'react';
import type { GradientFill } from '../../lib/types';

type Props = {
  value: GradientFill;
  onChange: (next: GradientFill) => void;
};

const ENSURE_TWO_STOPS: GradientFill = {
  type: 'linear',
  angle: 90,
  stops: [
    { pos: 0, color: '#ffd700' },
    { pos: 1, color: '#ff2a2a' },
  ],
};

// Renders a CSS-faithful preview of the gradient under the editor.
function previewCss(g: GradientFill): string {
  const stops = g.stops
    .slice()
    .sort((a, b) => a.pos - b.pos)
    .map((s) => `${s.color} ${(s.pos * 100).toFixed(1)}%`)
    .join(', ');
  return `linear-gradient(${g.angle}deg, ${stops})`;
}

export function GradientEditor({ value, onChange }: Props) {
  const safe: GradientFill =
    value && Array.isArray(value.stops) && value.stops.length >= 2
      ? value
      : ENSURE_TWO_STOPS;
  const [activeStop, setActiveStop] = useState(0);

  const updateStop = (i: number, patch: Partial<{ pos: number; color: string }>) => {
    const next = { ...safe, stops: safe.stops.map((s, idx) => (idx === i ? { ...s, ...patch } : s)) };
    onChange(next);
  };
  const addStop = () => {
    if (safe.stops.length >= 6) return;
    // Insert a midpoint stop between the last two.
    const a = safe.stops[safe.stops.length - 2]!;
    const b = safe.stops[safe.stops.length - 1]!;
    const newStop = { pos: (a.pos + b.pos) / 2, color: a.color };
    const next = {
      ...safe,
      stops: [...safe.stops.slice(0, -1), newStop, b],
    };
    onChange(next);
    setActiveStop(safe.stops.length - 1);
  };
  const removeStop = (i: number) => {
    if (safe.stops.length <= 2) return;
    const next = { ...safe, stops: safe.stops.filter((_, idx) => idx !== i) };
    onChange(next);
    setActiveStop(Math.max(0, Math.min(activeStop, next.stops.length - 1)));
  };

  const active = safe.stops[activeStop] ?? safe.stops[0]!;

  return (
    <div className="space-y-2">
      {/* Preview swatch */}
      <div
        className="h-8 rounded border border-ink-600"
        style={{ background: previewCss(safe) }}
      />

      {/* Angle slider */}
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-ink-300 w-12">Angle</span>
        <input
          type="range"
          min={0}
          max={360}
          step={1}
          value={safe.angle}
          onChange={(e) => onChange({ ...safe, angle: Number(e.target.value) })}
          className="flex-1 accent-amber-400"
        />
        <span className="text-[11px] font-mono text-ink-400 tabular-nums w-10 text-right">
          {safe.angle}°
        </span>
      </div>

      {/* Stops list */}
      <div className="space-y-1">
        {safe.stops.map((s, i) => (
          <div
            key={i}
            className={`flex items-center gap-1.5 rounded px-1.5 py-1 ${
              i === activeStop ? 'bg-ink-700' : ''
            }`}
          >
            <button
              type="button"
              onClick={() => setActiveStop(i)}
              className="h-5 w-5 rounded border border-ink-600 shrink-0"
              style={{ background: s.color }}
              aria-label={`Edit stop ${i + 1}`}
            />
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={s.pos}
              onChange={(e) => updateStop(i, { pos: Number(e.target.value) })}
              className="flex-1 accent-amber-400"
            />
            <span className="text-[10px] font-mono text-ink-400 tabular-nums w-8 text-right">
              {(s.pos * 100).toFixed(0)}%
            </span>
            <button
              type="button"
              onClick={() => removeStop(i)}
              disabled={safe.stops.length <= 2}
              className="text-ink-400 hover:text-rose-300 disabled:opacity-30 disabled:cursor-not-allowed text-xs px-1"
              aria-label={`Remove stop ${i + 1}`}
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={addStop}
        disabled={safe.stops.length >= 6}
        className="text-xs text-ink-300 border border-dashed border-ink-600 rounded px-2 py-1 hover:bg-ink-700 disabled:opacity-30 disabled:cursor-not-allowed w-full"
      >
        + add stop
      </button>

      {/* Active stop color editor */}
      <div className="rounded border border-ink-600 bg-ink-800 p-2 space-y-2">
        <div className="text-[11px] text-ink-300">
          Stop {activeStop + 1} · {active.color}
        </div>
        <HexAlphaColorPicker
          color={active.color}
          onChange={(c) => updateStop(activeStop, { color: c })}
        />
        <input
          type="text"
          value={active.color}
          onChange={(e) => updateStop(activeStop, { color: e.target.value.trim() })}
          className="w-full rounded bg-ink-700 border border-ink-600 px-2 py-1 text-xs font-mono text-ink-100 focus:outline-none focus:ring-1 focus:ring-amber-400"
        />
      </div>
    </div>
  );
}
