'use client';

import { useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CloseIcon } from './Icon';
import { IconButton } from './Button';
import { useDismissable } from './Drawer';
import s from './ui.module.css';

interface DialogProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** Compact tool-dialog sizing used by controller Learn. */
  compact?: boolean;
}

export function Dialog({ open, title, onClose, children, footer, compact = false }: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  useDismissable(open, onClose, panelRef, true);

  if (!open) return null;

  const dialog = (
    <div
      className={s.dialogScrim}
      onClick={(e) => e.target === e.currentTarget && onClose()}
      style={compact ? {
        paddingTop: 'calc(12px + env(safe-area-inset-top, 0px))',
        paddingBottom: 'calc(12px + env(safe-area-inset-bottom, 0px))',
        paddingLeft: 'max(12px, env(safe-area-inset-left, 0px))',
        paddingRight: 'max(12px, env(safe-area-inset-right, 0px))',
      } : undefined}
    >
      <div
        ref={panelRef}
        className={s.dialog}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={compact ? {
          width: 'min(380px, 100%)',
          maxHeight: 'calc(100dvh - 24px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px))',
        } : undefined}
      >
        <header className={s.dialogHeader} style={compact ? { padding: 12 } : undefined}>
          <h2 className={s.dialogTitle}>{title}</h2>
          <IconButton label="Close" icon={<CloseIcon />} onClick={onClose} />
        </header>
        <div className={s.dialogBody} style={compact ? { overflowX: 'hidden', padding: 12 } : undefined}>
          {children}
        </div>
        {footer && <footer className={s.dialogFooter}>{footer}</footer>}
      </div>
    </div>
  );

  // Portaling to body prevents a focused mobile Inspector/VFX panel's own
  // overflow/transform context from clipping the controller dialog at the top.
  return typeof document === 'undefined' ? dialog : createPortal(dialog, document.body);
}
