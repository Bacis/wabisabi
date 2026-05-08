import type { Control, FillValue } from '../../lib/types';
import { ColorPicker } from './ColorPicker';
import { ColorList } from './ColorList';
import { FillControl } from './FillControl';
import { Slider } from './Slider';
import { Select } from './Select';
import { Switch } from './Switch';
import { MultiSelect } from './MultiSelect';
import { FontFamily } from './FontFamily';
import { ThemePicker } from './ThemePicker';

type Props = {
  control: Control;
  value: unknown;
  onChange: (value: unknown) => void;
  // Bulk-update path for controls (themePicker today) that apply many
  // styleSpec keys at once. Editor wires this to a deep-merge callback.
  onApplyTheme?: (patch: Record<string, any>) => void;
};

export function ControlRenderer({ control, value, onChange, onApplyTheme }: Props) {
  switch (control.kind) {
    case 'color':
      return <ColorPicker control={control} value={value as string} onChange={onChange} />;
    case 'colorList':
      return <ColorList control={control} value={value as string[] | string} onChange={onChange} />;
    case 'fill':
      return <FillControl control={control} value={value as FillValue | undefined} onChange={onChange} />;
    case 'slider':
      return <Slider control={control} value={value as number} onChange={onChange} />;
    case 'select':
      return <Select control={control} value={value as string} onChange={onChange} />;
    case 'switch':
      return <Switch control={control} value={value as boolean} onChange={onChange} />;
    case 'multiSelect':
      return <MultiSelect control={control} value={value as string[]} onChange={onChange} />;
    case 'fontFamily':
      return <FontFamily control={control} value={value as string} onChange={onChange} />;
    case 'themePicker':
      // Themes are bulk operations — they ignore value/onChange and call
      // onApplyTheme with a styleSpec patch instead. If the parent didn't
      // provide onApplyTheme, render nothing (this should never happen
      // when descriptors are wired correctly).
      if (!onApplyTheme) return null;
      return <ThemePicker control={control} onApplyTheme={onApplyTheme} />;
    case 'number':
    case 'text':
      // Fall back to a plain text/number input — these aren't used by the
      // current descriptors but reserved for future use.
      return (
        <div className="text-xs text-ink-400">
          {control.label}: unsupported control kind {control.kind}
        </div>
      );
  }
}
