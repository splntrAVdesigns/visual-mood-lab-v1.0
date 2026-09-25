import { Field } from '@/components/ui';
import { LIBRARY_SHAPES } from '@/lib/shape-source/library';
import type { SelectControl, ParamValue } from '@/renderers/control-schema';
import s from '../../features.module.css';

interface Props {
  control: SelectControl;
  value: ParamValue;
  dirty: boolean;
  onChange: (v: ParamValue) => void;
  onReset: () => void;
}

/** Thumbnail grid for Shape Source; saved legacy silhouettes stay selectable
 * while the new picker presents exactly ten current designs. */
export function ShapeLibraryControlRow({ control, value, dirty, onChange, onReset }: Props) {
  const selected = typeof value === 'string' ? value : control.default;
  const legacy = !control.options.some((o) => o.value === selected) && LIBRARY_SHAPES[selected];
  const options = legacy
    ? [{ value: selected, label: `${legacy.label} · Original` }, ...control.options]
    : control.options;

  return (
    <Field label={control.label} hint={control.hint} dirty={dirty} onReset={onReset}>
      <div className={s.shapeLibraryGrid} role="group" aria-label={control.label}>
        {options.map((option) => {
          const svg = LIBRARY_SHAPES[option.value]?.svg;
          if (!svg) return null;
          return (
            <button
              type="button"
              key={option.value}
              className={s.shapeLibraryItem}
              aria-label={option.label}
              aria-pressed={selected === option.value}
              data-selected={selected === option.value ? 'true' : undefined}
              onClick={() => onChange(option.value)}
            >
              <span
                className={s.shapeLibraryThumb}
                aria-hidden="true"
                style={{ backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(svg)}")` }}
              />
              <span>{option.label}</span>
            </button>
          );
        })}
      </div>
    </Field>
  );
}
