import { Field, Slider } from '@/components/ui';
import { sampleControllerParameterValue } from '@/lib/control-surface';
import { ModulatedValue } from '../ModulatedValue';
import type { StepperControl as StepperControlType, ParamValue } from '@/renderers/control-schema';
import { num } from './shared';

interface Props {
  control: StepperControlType;
  value: ParamValue;
  dirty: boolean;
  onChange: (v: ParamValue) => void;
  onReset: () => void;
  controllerActive?: boolean;
  cardId?: string | null;
}

export function StepperControlRow({
  control,
  value,
  dirty,
  onChange,
  onReset,
  controllerActive = false,
  cardId = null,
}: Props) {
  const v = num(value, control.default);
  return (
    <Field
      label={control.label}
      hint={control.hint}
      dirty={dirty}
      onReset={onReset}
      valueNode={controllerActive ? (
        <ModulatedValue cardId={cardId} controlId={control.id} step={control.step ?? 1} fallback={v} />
      ) : undefined}
      value={String(v)}
    >
      <Slider
        label={control.label}
        value={v}
        min={control.min}
        max={control.max}
        step={control.step ?? 1}
        modulated={controllerActive}
        liveValue={controllerActive ? () => sampleControllerParameterValue(cardId, control.id) : undefined}
        onChange={onChange}
      />
    </Field>
  );
}
