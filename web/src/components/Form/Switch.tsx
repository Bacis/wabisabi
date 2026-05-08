import type { SwitchControl } from '../../lib/types';
import { Field } from './Field';

type Props = {
  control: SwitchControl;
  value: boolean | undefined;
  onChange: (value: boolean) => void;
};

export function Switch({ control, value, onChange }: Props) {
  const v = typeof value === 'boolean' ? value : control.default ?? false;
  return (
    <Field label={control.label} description={control.description}>
      <button
        type="button"
        onClick={() => onChange(!v)}
        role="switch"
        aria-checked={v}
        className={`inline-flex h-6 w-10 items-center rounded-full transition-colors ${
          v ? 'bg-amber-400' : 'bg-ink-600'
        }`}
      >
        <span
          className={`inline-block h-5 w-5 rounded-full bg-ink-900 shadow transform transition-transform ${
            v ? 'translate-x-[18px]' : 'translate-x-[2px]'
          }`}
        />
      </button>
    </Field>
  );
}
