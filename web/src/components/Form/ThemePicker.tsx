import { useState } from 'react';
import type { Theme, ThemePickerControl } from '../../lib/types';

type Props = {
  control: ThemePickerControl;
  onApplyTheme: (patch: Record<string, any>) => void;
};

export function ThemePicker({ control, onApplyTheme }: Props) {
  // Track last-clicked theme so the card briefly flashes after apply.
  // Not a "current selection" — once applied, the user may tweak anything.
  const [lastApplied, setLastApplied] = useState<string | null>(null);

  const apply = (theme: Theme) => {
    onApplyTheme(theme.patch);
    setLastApplied(theme.id);
    setTimeout(() => {
      setLastApplied((prev) => (prev === theme.id ? null : prev));
    }, 700);
  };

  return (
    <div className="space-y-1.5">
      {control.description && (
        <p className="text-[11px] leading-snug text-ink-400">{control.description}</p>
      )}
      <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1 snap-x">
        {control.themes.map((theme) => (
          <ThemeCard
            key={theme.id}
            theme={theme}
            justApplied={lastApplied === theme.id}
            onPick={() => apply(theme)}
          />
        ))}
      </div>
    </div>
  );
}

function ThemeCard({
  theme,
  justApplied,
  onPick,
}: {
  theme: Theme;
  justApplied: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      className={`shrink-0 snap-start w-[140px] rounded-md border p-2 text-left transition-all bg-ink-700 hover:bg-ink-600 ${
        justApplied
          ? 'border-amber-400 ring-2 ring-amber-400/40'
          : 'border-ink-600 hover:border-ink-500'
      }`}
    >
      <div
        className="text-sm font-medium text-ink-100 leading-tight truncate"
        style={theme.displayFont ? { fontFamily: `"${theme.displayFont}", sans-serif` } : undefined}
        title={theme.name}
      >
        {theme.name}
      </div>
      <div className="mt-1.5 flex items-center gap-1">
        {theme.swatch.slice(0, 5).map((c, i) => (
          <span
            key={i}
            className="h-3 w-3 rounded-full border border-ink-900/40 shrink-0"
            style={{ background: c }}
          />
        ))}
      </div>
      {theme.description && (
        <div className="mt-1 text-[10px] leading-tight text-ink-400 truncate" title={theme.description}>
          {theme.description}
        </div>
      )}
    </button>
  );
}
