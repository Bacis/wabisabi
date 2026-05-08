import type { SliderControl } from '../../lib/types';
import { Field } from './Field';

type Props = {
  control: SliderControl;
  value: number | undefined;
  onChange: (value: number) => void;
};

export function Slider({ control, value, onChange }: Props) {
  const v = typeof value === 'number' ? value : control.default ?? control.min;
  const display = control.step != null && control.step < 1
    ? v.toFixed(2)
    : Math.round(v).toString();
  return (
    <Field
      label={control.label}
      description={control.description}
      trailing={`${display}${control.unit ?? ''}`}
    >
      <input
        type="range"
        min={control.min}
        max={control.max}
        step={control.step ?? 1}
        value={v}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-amber-400"
      />
    </Field>
  );
}
