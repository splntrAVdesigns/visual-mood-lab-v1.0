import { Field, Slider } from '@/components/ui';
import type { Vec3Control as Vec3ControlType, ParamValue, Vec3 } from '@/renderers/control-schema';
import { fmt, isVec } from './shared';
import s from '../../features.module.css';

interface Props {
  control: Vec3ControlType;
  value: ParamValue;
  dirty: boolean;
  onChange: (v: ParamValue) => void;
  onReset: () => void;
}

export function Vec3ControlRow({ control, value, dirty, onChange, onReset }: Props) {
  const v = isVec(value, 3) ? (value as Vec3) : control.default;
  const labels = control.axisLabels ?? ['X', 'Y', 'Z'];

  return (
    <Field
      label={control.label}
      hint={control.hint}
      dirty={dirty}
      onReset={onReset}
      value={`${fmt(v[0])}, ${fmt(v[1])}, ${fmt(v[2])}`}
    >
      <span className={s.vecRow}>
        {labels.map((axis, i) => (
          <span key={axis} className={s.vecAxis}>
            <span className={s.vecAxisLabel}>{axis}</span>
            <Slider
              label={`${control.label} ${axis}`}
              value={v[i] as number}
              min={control.min[i] as number}
              max={control.max[i] as number}
              step={control.step}
              onChange={(n) => {
                const next: Vec3 = [v[0], v[1], v[2]];
                next[i] = n;
                onChange(next);
              }}
            />
          </span>
        ))}
      </span>
    </Field>
  );
}
