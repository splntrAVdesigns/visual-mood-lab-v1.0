'use client';

import type { ReactNode } from 'react';
import { ResetIcon } from './Icon';
import { IconButton } from './Button';
import s from './ui.module.css';

interface FieldProps {
  label: string;
  /** Mono readout on the right of the label row. */
  value?: string;
  hint?: string;
  /** Shows the accent dot and enables the reset affordance. */
  dirty?: boolean;
  onReset?: () => void;
  children: ReactNode;
}

/**
 * The label + readout + control row. Every control in the inspector uses
 * this, which is what makes a shader panel and a video panel look like the
 * same product.
 */
export function Field({ label, value, hint, dirty, onReset, children }: FieldProps) {
  return (
    <div className={s.field}>
      <div className={s.fieldHead}>
        <span className={s.fieldLabel} data-dirty={dirty ? 'true' : undefined}>
          {label}
        </span>
        <span className={s.fieldRow}>
          {value !== undefined && <span className={s.fieldValue}>{value}</span>}
          {dirty && onReset && (
            <IconButton
              label={`Reset ${label}`}
              icon={<ResetIcon />}
              onClick={onReset}
              style={{ height: 16, width: 16 }}
            />
          )}
        </span>
      </div>
      <div className={s.fieldRow}>{children}</div>
      {hint && <span className={s.fieldHint}>{hint}</span>}
    </div>
  );
}
