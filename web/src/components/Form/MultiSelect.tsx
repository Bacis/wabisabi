import type { MultiSelectControl } from '../../lib/types';
import { Field } from './Field';

type Props = {
  control: MultiSelectControl;
  value: string[] | undefined;
  onChange: (value: string[]) => void;
};

export function MultiSelect({ control, value, onChange }: Props) {
  const current = Array.isArray(value) ? value : control.default ?? [];
  const toggle = (v: string) => {
    if (current.includes(v)) {
      onChange(current.filter((x) => x !== v));
    } else {
      // Preserve the option order so cycles read predictably.
      const ordered = control.options
        .map((o) => o.value)
        .filter((opt) => current.includes(opt) || opt === v);
      onChange(ordered);
    }
  };
  return (
    <Field label={control.label} description={control.description}>
      <div className="flex flex-wrap gap-1">
        {control.options.map((opt) => {
          const selected = current.includes(opt.value);
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => toggle(opt.value)}
              className={`rounded px-2 py-1 text-xs font-medium border transition-colors ${
                selected
                  ? 'bg-amber-400/20 border-amber-400 text-amber-200'
                  : 'bg-ink-700 border-ink-600 text-ink-300 hover:bg-ink-600'
              }`}
            >
              {opt.label ?? opt.value}
            </button>
          );
        })}
      </div>
    </Field>
  );
}
