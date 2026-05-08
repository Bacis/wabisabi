import { useEffect, useRef, useState } from 'react';
import type { FontFamilyControl } from '../../lib/types';
import { Field } from './Field';

// Grouped font registry. Names match the family strings the Player loads
// in lib/preloadFonts.ts — adding a new font means a load there + an entry
// here. Free-form input still works for any user-typed value (e.g. an
// imported brand font); it just won't render correctly without a matching
// loadFont() registration.
type FontGroup = { label: string; fonts: string[] };

const GROUPS: FontGroup[] = [
  {
    label: 'Modern sans',
    fonts: ['Inter', 'Plus Jakarta Sans', 'DM Sans', 'Outfit'],
  },
  {
    label: 'Display / impact',
    fonts: ['Bebas Neue', 'Anton', 'Archivo Black', 'Abril Fatface', 'Workbench'],
  },
  {
    label: 'Cinematic serif',
    fonts: ['Playfair Display', 'Cinzel', 'Cormorant Garamond'],
  },
  {
    label: 'Vintage / retro',
    fonts: ['Press Start 2P', 'VT323', 'Pacifico', 'Lobster'],
  },
  {
    label: 'Tech / mono',
    fonts: ['JetBrains Mono'],
  },
  {
    label: 'Hand-drawn',
    fonts: ['Permanent Marker'],
  },
];

const ALL_FONTS = GROUPS.flatMap((g) => g.fonts);

type Props = {
  control: FontFamilyControl;
  value: string | undefined;
  onChange: (value: string) => void;
};

export function FontFamily({ control, value, onChange }: Props) {
  const v = value ?? control.default ?? ALL_FONTS[0]!;
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const filterTrim = filter.trim().toLowerCase();
  const matches = (s: string) => s.toLowerCase().includes(filterTrim);
  const groupsFiltered = filterTrim
    ? GROUPS.map((g) => ({ ...g, fonts: g.fonts.filter(matches) })).filter((g) => g.fonts.length > 0)
    : GROUPS;
  const customMatch = filterTrim && !ALL_FONTS.some((f) => f.toLowerCase() === filterTrim);

  const pick = (f: string) => {
    onChange(f);
    setOpen(false);
    setFilter('');
  };

  return (
    <Field label={control.label} description={control.description}>
      <div ref={rootRef} className="relative">
        <button
          type="button"
          onClick={() => setOpen((s) => !s)}
          className="w-full text-left rounded bg-ink-700 border border-ink-600 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-amber-400 flex items-center justify-between"
        >
          <span style={{ fontFamily: `"${v}", sans-serif` }} className="truncate text-ink-100">
            {v}
          </span>
          <span className="text-ink-400 text-xs ml-2">▾</span>
        </button>
        {open && (
          <div className="absolute z-20 left-0 right-0 mt-1 max-h-[360px] overflow-y-auto rounded border border-ink-600 bg-ink-800 shadow-xl">
            <div className="sticky top-0 bg-ink-800 border-b border-ink-700 p-2">
              <input
                type="text"
                autoFocus
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setOpen(false);
                  if (e.key === 'Enter') {
                    const first = groupsFiltered[0]?.fonts[0];
                    if (first) pick(first);
                    else if (filterTrim) pick(filterTrim);
                  }
                }}
                placeholder="Search fonts… (or type any name)"
                className="w-full rounded bg-ink-700 border border-ink-600 px-2 py-1 text-xs text-ink-100 focus:outline-none focus:ring-1 focus:ring-amber-400"
              />
            </div>
            {groupsFiltered.map((g) => (
              <div key={g.label} className="py-1">
                <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-ink-400">
                  {g.label}
                </div>
                {g.fonts.map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => pick(f)}
                    className={`w-full text-left px-2 py-1.5 text-sm hover:bg-ink-700 transition-colors ${
                      f === v ? 'bg-ink-700 text-amber-300' : 'text-ink-100'
                    }`}
                    style={{ fontFamily: `"${f}", sans-serif` }}
                  >
                    {f}
                  </button>
                ))}
              </div>
            ))}
            {customMatch && (
              <div className="border-t border-ink-700 py-1">
                <button
                  type="button"
                  onClick={() => pick(filter.trim())}
                  className="w-full text-left px-2 py-1.5 text-xs text-ink-300 hover:bg-ink-700 transition-colors"
                >
                  Use “{filter.trim()}” as custom font
                </button>
              </div>
            )}
            {groupsFiltered.length === 0 && !customMatch && (
              <div className="px-2 py-3 text-xs text-ink-400">No matches.</div>
            )}
          </div>
        )}
      </div>
    </Field>
  );
}
