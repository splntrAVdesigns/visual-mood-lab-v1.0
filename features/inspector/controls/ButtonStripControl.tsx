import { Field } from '@/components/ui';
import type { SelectControl as SelectControlType, ParamValue } from '@/renderers/control-schema';
import s from '../../features.module.css';

interface Props {
  control: SelectControlType;
  value: ParamValue;
  dirty: boolean;
  onChange: (v: ParamValue) => void;
  onReset: () => void;
}

/**
 * Renders a select control's own `options` as a compact button row instead
 * of a dropdown — reuses the exact same `.rateStrip`/`.rateStripKey`
 * classes the Sound panel's RateStrip and NoteRack already use, so a
 * direction picker here and a rate picker there read as the same family of
 * widget rather than two different systems that happen to look similar.
 *
 * Deliberately generic: this has no idea it's being used for a shader's
 * flow direction, or that RateStrip exists — it just renders whatever
 * `control.options` it was given. Any select with `@strip` gets this for
 * free, not just the one control that motivated building it.
 */
export function ButtonStripControlRow({ control, value, dirty, onReset, onChange }: Props) {
  const v = typeof value === 'string' ? value : control.default;

  return (
    <Field label={control.label} hint={control.hint} dirty={dirty} onReset={onReset}>
      <div
        className={s.rateStrip}
        role="group"
        aria-label={control.label}
        style={{ gridTemplateColumns: `repeat(${control.options.length}, 1fr)` }}
      >
        {control.options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            className={s.rateStripKey}
            aria-pressed={v === opt.value}
            aria-label={opt.label}
            data-selected={v === opt.value ? 'true' : undefined}
            onClick={() => onChange(opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </Field>
  );
}
