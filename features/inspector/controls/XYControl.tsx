import { Field, Slider } from '@/components/ui';
import type { XYControl as XYControlType, ParamValue, Vec2 } from '@/renderers/control-schema';
import { fmt, isVec } from './shared';
import s from '../../features.module.css';

interface Props {
  control: XYControlType;
  value: ParamValue;
  dirty: boolean;
  onChange: (v: ParamValue) => void;
  onReset: () => void;
}

export function XYControlRow({ control, value, dirty, onChange, onReset }: Props) {
  const v = isVec(value, 2) ? (value as Vec2) : control.default;

  return (
    <Field
      label={control.label}
      hint={control.hint}
      dirty={dirty}
      onReset={onReset}
      value={`${fmt(v[0])}, ${fmt(v[1])}`}
    >
      <span className={s.vecRow}>
        {(['X', 'Y'] as const).map((axis, i) => (
          <span key={axis} className={s.vecAxis}>
            <span className={s.vecAxisLabel}>{axis}</span>
            <Slider
              label={`${control.label} ${axis}`}
              value={v[i] as number}
              min={control.min[i] as number}
              max={control.max[i] as number}
              step={control.step}
              onChange={(n) => {
                const next: Vec2 = [v[0], v[1]];
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
