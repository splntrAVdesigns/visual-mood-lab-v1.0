'use client';

import {
  useEffect,
  useRef,
  type ReactNode,
} from 'react';
import { CloseIcon } from './Icon';
import { IconButton, cx } from './Button';
import s from './ui.module.css';

interface DrawerProps {
  open: boolean;
  side: 'left' | 'right';
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** Extra controls in the drawer header, left of the close button. */
  actions?: ReactNode;
  /** Hide the scrim. Used when a drawer should not block the board. */
  modal?: boolean;
  className?: string;
}

export function Drawer({
  open,
  side,
  title,
  onClose,
  children,
  footer,
  actions,
  modal = true,
  className,
}: DrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  useDismissable(open, onClose, panelRef, modal);

  return (
    <>
      {modal && (
        <div
          className={s.scrim}
          data-open={open ? 'true' : 'false'}
          onClick={onClose}
          aria-hidden="true"
        />
      )}
      <aside
        ref={panelRef}
        className={cx(s.drawer, side === 'left' ? s.drawerLeft : s.drawerRight, className)}
        data-open={open ? 'true' : 'false'}
        aria-label={title}
        aria-hidden={!open}
        // Keeps the closed panel out of the tab order without unmounting it,
        // so the slide transition still runs.
        inert={!open}
      >
        <header className={s.drawerHeader}>
          <h2 className={s.drawerTitle}>{title}</h2>
          <span style={{ display: 'flex', gap: 'var(--space-1)' }}>
            {actions}
            <IconButton label={`Close ${title}`} icon={<CloseIcon />} onClick={onClose} />
          </span>
        </header>

        <div className={s.drawerBody}>{children}</div>

        {footer && <footer className={s.drawerFooter}>{footer}</footer>}
      </aside>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Shared dismissal behaviour
 * ------------------------------------------------------------------ */

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Escape to close, focus moved in on open and restored on close, and a focus
 * trap while a modal overlay is up. Also locks body scroll so the board
 * behind does not scroll under the drawer on touch.
 */
export function useDismissable(
  open: boolean,
  onClose: () => void,
  panelRef: React.RefObject<HTMLElement | null>,
  modal: boolean,
) {
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    restoreRef.current = document.activeElement as HTMLElement | null;

    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }

      if (e.key !== 'Tab' || !modal || !panel) return;

      const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => el.offsetParent !== null,
      );
      if (!items.length) return;

      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      const active = document.activeElement;

      if (e.shiftKey && active === firstItem) {
        e.preventDefault();
        lastItem.focus();
      } else if (!e.shiftKey && active === lastItem) {
        e.preventDefault();
        firstItem.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);

    const prevOverflow = document.body.style.overflow;
    if (modal) document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = prevOverflow;
      restoreRef.current?.focus?.();
    };
  }, [open, onClose, panelRef, modal]);
}
