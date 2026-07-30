import { Field, Toggle } from '@/components/ui';
import type { ToggleControl as ToggleControlType, ParamValue } from '@/renderers/control-schema';

interface Props {
  control: ToggleControlType;
  value: ParamValue;
  dirty: boolean;
  onChange: (v: ParamValue) => void;
  onReset: () => void;
}

export function ToggleControlRow({ control, value, dirty, onChange, onReset }: Props) {
  return (
    <Field label={control.label} hint={control.hint} dirty={dirty} onReset={onReset} value={value ? 'on' : 'off'}>
      <Toggle label={control.label} checked={Boolean(value)} onChange={onChange} />
    </Field>
  );
}
