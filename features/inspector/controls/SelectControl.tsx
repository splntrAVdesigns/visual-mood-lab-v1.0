import { Field, Select } from '@/components/ui';
import type { SelectControl as SelectControlType, ParamValue } from '@/renderers/control-schema';

interface Props {
  control: SelectControlType;
  value: ParamValue;
  dirty: boolean;
  onChange: (v: ParamValue) => void;
  onReset: () => void;
}

export function SelectControlRow({ control, value, dirty, onChange, onReset }: Props) {
  const v = typeof value === 'string' ? value : control.default;
  return (
    <Field
      label={control.label}
      hint={control.hint}
      dirty={dirty}
      onReset={onReset}
      badge={control.disabled ? (control.disabledLabel ?? 'Future feature') : undefined}
    >
      <Select
        label={control.label}
        value={v}
        options={control.options}
        onChange={onChange}
        disabled={control.disabled}
      />
    </Field>
  );
}
