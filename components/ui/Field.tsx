'use client';

import { createContext, useContext, type ReactNode } from 'react';
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
  /** Small badge rendered right after the label. */
  badge?: string;
  children: ReactNode;
}

/**
 * Optional header action shared by every Field inside a control row.
 * Phase 4.97F uses this for the compact CTRL pill so it sits immediately
 * LEFT of the numeric value/readout instead of being absolutely positioned
 * over it. The provider is deliberately generic so future per-control tools
 * can use the same clean layout contract without teaching every control
 * component about them individually.
 */
const FieldActionContext = createContext<ReactNode>(null);

export function FieldActionProvider({ value, children }: { value: ReactNode; children: ReactNode }) {
  return <FieldActionContext.Provider value={value}>{children}</FieldActionContext.Provider>;
}

/**
 * The label + readout + control row. Every control in the inspector uses
 * this, which is what makes a shader panel and a video panel look like the
 * same product.
 */
export function Field({ label, value, valueNode, hint, dirty, onReset, badge, children }: FieldProps) {
  const action = useContext(FieldActionContext);

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
          {action}
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
