'use client';

import { useMemo, useState } from 'react';
import { Field } from '@/components/ui';
import type { FontControl as FontControlType, ParamValue } from '@/renderers/control-schema';
import { FONT_MANIFEST, fontsByCategory, getFontEntry, type FontEntry } from '@/lib/fonts/manifest';
import s from '../../features.module.css';

interface Props {
  control: FontControlType;
  value: ParamValue;
  dirty: boolean;
  onChange: (value: ParamValue) => void;
  onReset: () => void;
}

interface FontGroup {
  label: string;
  entries: FontEntry[];
}

function groupFonts(entries: FontEntry[]): FontGroup[] {
  const custom = entries.filter((f) => f.source === 'custom');
  const google = entries.filter((f) => f.source === 'google');
  return [
    { label: 'Custom', entries: custom },
    { label: 'Google Fonts', entries: google },
  ].filter((g) => g.entries.length > 0);
}

/**
 * Font picker. Each option renders its own label set in its own
 * `cssFamily` — the point of a font control is seeing the face before
 * picking it, the same reason TextureControl shows a thumbnail rather
 * than a bare filename. Whether the browser has actually painted the
 * real glyphs yet (vs. falling back while the file loads) is a FOUC
 * concern for whatever loads the @font-face rules for the host document
 * — this component only assumes `cssFamily` resolves once that's done.
 */
export function FontControlRow({ control, value, dirty, onChange, onReset }: Props) {
  const [open, setOpen] = useState(false);
  const id = typeof value === 'string' ? value : control.default;

  const entries = useMemo(
    () => fontsByCategory(control.category ?? 'any'),
    [control.category],
  );
  const groups = useMemo(() => groupFonts(entries), [entries]);
  const current = getFontEntry(id) ?? FONT_MANIFEST.find((f) => f.id === control.default);

  return (
    <Field
      label={control.label}
      hint={control.hint}
      dirty={dirty}
      onReset={onReset}
      badge={control.disabled ? (control.disabledLabel ?? 'Future feature') : undefined}
      value={current?.family ?? id}
    >
      <div className={s.fontPicker}>
        <button
          type="button"
          className={s.fontTrigger}
          style={current ? { fontFamily: current.cssFamily } : undefined}
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          disabled={control.disabled}
        >
          {current?.family ?? id}
          {current?.note && <span className={s.fontNoteBadge}>demo</span>}
        </button>

        {open && (
          <div className={s.fontMenu} role="listbox">
            {groups.length === 0 && (
              <p className={s.fontMenuEmpty}>No fonts available in this category.</p>
            )}
            {groups.map((group) => (
              <div key={group.label} className={s.fontGroup}>
                <div className={s.fontGroupLabel}>{group.label}</div>
                {group.entries.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    role="option"
                    aria-selected={f.id === id}
                    className={s.fontOption}
                    data-active={f.id === id ? 'true' : undefined}
                    style={{ fontFamily: f.cssFamily }}
                    title={f.note}
                    onClick={() => {
                      onChange(f.id);
                      setOpen(false);
                    }}
                  >
                    <span>{f.family}</span>
                    {f.note && <span className={s.fontNoteBadge}>demo</span>}
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </Field>
  );
}
