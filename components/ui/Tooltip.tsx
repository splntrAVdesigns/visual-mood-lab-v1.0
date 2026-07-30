'use client';

import { useState, type ReactNode } from 'react';
import s from './ui.module.css';

interface TooltipProps {
  content: string;
  shortcut?: string;
  children: ReactNode;
}

/**
 * Hover/focus tooltip. Deliberately does not trap or delay — this is a hint
 * layer, not a disclosure. Touch devices never see it, which is why every
 * icon-only control also carries an aria-label.
 */
export function Tooltip({ content, shortcut, children }: TooltipProps) {
  const [open, setOpen] = useState(false);

  return (
    <span
      className={s.tooltipWrap}
      onPointerEnter={(e) => e.pointerType === 'mouse' && setOpen(true)}
      onPointerLeave={() => setOpen(false)}
      onFocusCapture={() => setOpen(true)}
      onBlurCapture={() => setOpen(false)}
    >
      {children}
      {open && (
        <span role="tooltip" className={s.tooltip}>
          {content}
          {shortcut && <span className={s.tooltipShortcut}>{shortcut}</span>}
        </span>
      )}
    </span>
  );
}
