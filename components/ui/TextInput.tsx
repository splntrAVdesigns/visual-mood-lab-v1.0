'use client';

import { forwardRef, type InputHTMLAttributes } from 'react';
import { cx } from './Button';
import s from './ui.module.css';

interface TextInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
  label: string;
  mono?: boolean;
  onChange: (value: string) => void;
}

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { label, mono, className, onChange, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      type="text"
      aria-label={label}
      className={cx(s.input, mono && s.inputMono, className)}
      onChange={(e) => onChange(e.target.value)}
      {...rest}
    />
  );
});
