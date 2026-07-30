import { Field } from '@/components/ui';
import type { ColorControl as ColorControlType, ParamValue } from '@/renderers/control-schema';
import { isRGBA, to255, toHex } from './shared';
import s from '../../features.module.css';

interface Props {
  control: ColorControlType;
  value: ParamValue;
  dirty: boolean;
  onChange: (v: ParamValue) => void;
  onReset: () => void;
}

/** Native colour input for the swatch itself, with a live mono hex readout —
    matches the palette's discipline (real values shown, not just a chip). */
export function ColorControlRow({ control, value, dirty, onChange, onReset }: Props) {
  const c = isRGBA(value) ? value : control.default;

  return (
    <Field
      label={control.label}
      hint={control.hint}
      dirty={dirty}
      onReset={onReset}
      value={control.alpha ? `${Math.round(c.a * 100)}%` : undefined}
    >
      <span className={s.swatch}>
      <span className={s.swatchChip} style={{ background: `rgba(${to255(c.r)}, ${to255(c.g)}, ${to255(c.b)}, ${c.a})` }}>
        <input
          type="color"
          className={s.swatchInput}
          aria-label={control.label}
          value={toHex(c)}
          onChange={(e) => {
            const hex = e.target.value;
            const r = parseInt(hex.slice(1, 3), 16) / 255;
            const g = parseInt(hex.slice(3, 5), 16) / 255;
            const b = parseInt(hex.slice(5, 7), 16) / 255;
            onChange({ r, g, b, a: c.a });
          }}
        />
      </span>
        <span className={s.swatchHex}>{toHex(c)}</span>
      </span>
    </Field>
  );
}
