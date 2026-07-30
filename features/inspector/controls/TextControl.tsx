import { Field, TextInput } from '@/components/ui';
import type { TextControl as TextControlType, ParamValue } from '@/renderers/control-schema';

interface Props {
  control: TextControlType;
  value: ParamValue;
  dirty: boolean;
  onChange: (v: ParamValue) => void;
  onReset: () => void;
}

export function TextControlRow({ control, value, dirty, onChange, onReset }: Props) {
  return (
    <Field label={control.label} hint={control.hint} dirty={dirty} onReset={onReset}>
      <TextInput
        label={control.label}
        mono={control.monospace}
        value={typeof value === 'string' ? value : control.default}
        maxLength={control.maxLength}
        onChange={onChange}
      />
    </Field>
  );
}
