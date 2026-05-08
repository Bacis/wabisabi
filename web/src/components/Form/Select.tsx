import type { SelectControl } from '../../lib/types';
import { Field } from './Field';

type Props = {
  control: SelectControl;
  value: string | undefined;
  onChange: (value: string) => void;
};

export function Select({ control, value, onChange }: Props) {
  const v = value ?? control.default ?? control.options[0]?.value ?? '';
  return (
    <Field label={control.label} description={control.description}>
      <select
        value={v}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded bg-ink-700 border border-ink-600 px-2 py-1.5 text-sm text-ink-100 focus:outline-none focus:ring-1 focus:ring-amber-400"
      >
        {control.options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label ?? opt.value}
          </option>
        ))}
      </select>
    </Field>
  );
}
