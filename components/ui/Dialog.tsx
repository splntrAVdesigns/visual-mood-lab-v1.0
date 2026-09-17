'use client';

import { useRef, type ReactNode } from 'react';
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

  return (
    <div
      className={s.dialogScrim}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={panelRef}
        className={s.dialog}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={compact ? { width: 'min(380px, 100%)', maxHeight: 'min(78dvh, 680px)' } : undefined}
      >
        <header className={s.dialogHeader} style={compact ? { padding: 12 } : undefined}>
          <h2 className={s.dialogTitle}>{title}</h2>
          <IconButton label="Close" icon={<CloseIcon />} onClick={onClose} />
        </header>
        <div
          className={s.dialogBody}
          style={compact ? { overflowX: 'hidden', padding: 12 } : undefined}
        >
          {children}
        </div>
        {footer && <footer className={s.dialogFooter}>{footer}</footer>}
      </div>
    </div>
  );
}
