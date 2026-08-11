'use client';

import { useState, type ReactNode } from 'react';
import { useTooltipsEnabled } from './useTooltipsEnabled';
import s from './ui.module.css';

interface TooltipProps {
  content: string;
  shortcut?: string;
  children: ReactNode;
  /**
   * Horizontal anchor. Default 'center' is correct for most triggers away
   * from a viewport edge. Use 'end' for a trigger sitting at the right
   * edge of its container (e.g. a drawer's top-right corner) so the
   * tooltip grows leftward instead of running off-screen — 'start' is the
   * mirror case for a left-edge trigger.
   */
  align?: 'center' | 'start' | 'end';
}

/**
 * Hover/focus tooltip. Deliberately does not trap or delay — this is a hint
 * layer, not a disclosure. Touch devices never see it, which is why every
 * icon-only control also carries an aria-label.
 *
 * Gated behind the global tooltips-enabled preference (default off, see
 * useTooltipsEnabled) — the hover-tracking state below still runs either
 * way since it's cheap, only the actual popup is suppressed when disabled.
 */
export function Tooltip({ content, shortcut, children, align = 'center' }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const [tooltipsEnabled] = useTooltipsEnabled();

  return (
    <span
      className={s.tooltipWrap}
      onPointerEnter={(e) => e.pointerType === 'mouse' && setOpen(true)}
      onPointerLeave={() => setOpen(false)}
      onFocusCapture={() => setOpen(true)}
      onBlurCapture={() => setOpen(false)}
    >
      {children}
      {open && tooltipsEnabled && (
        <span role="tooltip" className={s.tooltip} data-align={align}>
          {content}
          {shortcut && <span className={s.tooltipShortcut}>{shortcut}</span>}
        </span>
      )}
    </span>
  );
}
