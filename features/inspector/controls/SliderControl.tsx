import { Field, Slider, formatValue } from '@/components/ui';
import { sampleControllerParameterValue } from '@/lib/control-surface';
import { useInspectorStore } from '@/stores';
import { ModulatedValue } from '../ModulatedValue';
import type { SliderControl as SliderControlType, ParamValue } from '@/renderers/control-schema';
import { num } from './shared';

interface Props {
  control: SliderControlType;
  value: ParamValue;
  dirty: boolean;
  onChange: (v: ParamValue) => void;
  onReset: () => void;
  controllerActive?: boolean;
}

export function SliderControlRow({ control, value, dirty, onChange, onReset, controllerActive = false }: Props) {
  const v = num(value, control.default);
  const modulated = useInspectorStore((st) => Boolean(st.mod[control.id]));
  const cardId = useInspectorStore((st) => st.itemId);
  const live = modulated || controllerActive;

  return (
    <Field
      label={control.label}
      hint={control.hint}
      dirty={dirty}
      onReset={onReset}
      valueNode={live ? (
        <ModulatedValue
          cardId={cardId}
          controlId={control.id}
          step={control.step ?? 0.01}
          unit={control.unit}
          fallback={v}
        />
      ) : undefined}
      value={`${formatValue(v, control.step ?? 0.01)}${control.unit ? ` ${control.unit}` : ''}`}
    >
      <Slider
        label={control.label}
        value={v}
        min={control.min}
        max={control.max}
        step={control.step}
        scale={control.scale}
        modulated={live}
        liveValue={controllerActive ? () => sampleControllerParameterValue(cardId, control.id) : undefined}
        onChange={onChange}
      />
    </Field>
  );
}
