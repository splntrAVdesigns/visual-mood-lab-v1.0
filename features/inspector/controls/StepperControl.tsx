import { Field, Slider } from '@/components/ui';
import type { StepperControl as StepperControlType, ParamValue } from '@/renderers/control-schema';
import { num } from './shared';

interface Props {
  control: StepperControlType;
  value: ParamValue;
  dirty: boolean;
  onChange: (v: ParamValue) => void;
  onReset: () => void;
}

export function StepperControlRow({ control, value, dirty, onChange, onReset }: Props) {
  const v = num(value, control.default);
  return (
    <Field label={control.label} hint={control.hint} dirty={dirty} onReset={onReset} value={String(v)}>
      <Slider
        label={control.label}
        value={v}
        min={control.min}
        max={control.max}
        step={control.step ?? 1}
        onChange={onChange}
      />
    </Field>
  );
}
