'use client';

import type { ChangeEvent } from 'react';
import { ChevronDownIcon } from './Icon';
import s from './ui.module.css';

export interface SelectItem {
  value: string;
  label: string;
}

interface SelectProps {
  value: string;
  options: SelectItem[];
  label: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}

/**
 * Native <select> on purpose. A custom listbox would let us match the mono
 * treatment inside the popup, but native gets correct mobile pickers,
 * keyboard type-ahead, and screen-reader behaviour for free — and the closed
 * state, which is what people actually look at, is fully styleable.
 */
export function Select({ value, options, label, disabled, onChange }: SelectProps) {
  return (
    <span className={s.selectWrap}>
      <select
        className={s.select}
        value={value}
        aria-label={label}
        disabled={disabled}
        onChange={(e: ChangeEvent<HTMLSelectElement>) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDownIcon className={s.selectChevron} />
    </span>
  );
}
