'use client';

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import s from './ui.module.css';

export type ButtonVariant = 'ghost' | 'outline' | 'solid' | 'accent' | 'danger';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  block?: boolean;
  /** Renders in the active/pressed state. Use for view toggles. */
  active?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'ghost', block, active, className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      data-active={active ? 'true' : undefined}
      className={cx(s.button, s[variant], block && s.block, className)}
      {...rest}
    >
      {children}
    </button>
  );
});

interface IconButtonProps extends Omit<ButtonProps, 'children' | 'block'> {
  /** Required — icon-only controls must be named for screen readers. */
  label: string;
  icon: ReactNode;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton({ label, icon, variant = 'ghost', active, className, ...rest }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        aria-label={label}
        title={label}
        data-active={active ? 'true' : undefined}
        className={cx(s.button, s[variant], s.iconOnly, className)}
        {...rest}
      >
        {icon}
      </button>
    );
  },
);

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
