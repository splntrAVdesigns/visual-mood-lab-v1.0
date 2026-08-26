'use client';

import type { ReactNode } from 'react';
import { ResetIcon } from './Icon';
import { IconButton } from './Button';
import { Badge } from './Badge';
import s from './ui.module.css';

interface FieldProps {
  label: string;
  /** Mono readout on the right of the label row. */
  value?: string;
  /** Replaces `value` when supplied — used for live modulated readouts that
      update outside React's render cycle. */
  valueNode?: ReactNode;
  hint?: string;
  /** Shows the accent dot and enables the reset affordance. */
  dirty?: boolean;
  onReset?: () => void;
  /** Small badge rendered right after the label — currently just "Future
      feature" for a control that's schema-present but not yet implemented
      (see Control.disabled in control-schema.ts). */
  badge?: string;
  children: ReactNode;
}

/**
 * The label + readout + control row. Every control in the inspector uses
 * this, which is what makes a shader panel and a video panel look like the
 * same product.
 */
export function Field({ label, value, valueNode, hint, dirty, onReset, badge, children }: FieldProps) {
  return (
    <div className={s.field}>
      <div className={s.fieldHead}>
        <span className={s.fieldRow}>
          <span className={s.fieldLabel} data-dirty={dirty ? 'true' : undefined}>
            {label}
          </span>
          {badge && <Badge>{badge}</Badge>}
        </span>
        <span className={s.fieldRow}>
          {valueNode ?? (value !== undefined && <span className={s.fieldValue}>{value}</span>)}
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
