'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CloseIcon } from './Icon';
import { IconButton } from './Button';
import { useDismissable } from './Drawer';
import { useBackdropDismiss } from './useBackdropDismiss';
import s from './ui.module.css';
import layout from './Dialog.module.css';

interface DialogProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** Compact tool-dialog sizing used by controller Learn. */
  compact?: boolean;
  /**
   * On sufficiently wide desktop viewports, render the compact controller
   * tool as a non-modal sidecar immediately left of the Inspector instead of
   * dimming/covering the artwork. Mobile/narrow layouts retain the safe-area
   * modal introduced in 4.97F.2.
   */
  desktopSidecar?: boolean;
}

const DESKTOP_SIDECAR_QUERY = '(min-width: 1200px) and (pointer: fine)';
const CONTROLLER_SIDECAR_CLOSE_EVENT = 'vml:close-controller-sidecars';
let activeControllerToolClose: (() => void) | null = null;

export function Dialog({
  open,
  title,
  onClose,
  children,
  footer,
  compact = false,
  desktopSidecar = false,
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const [useSidecar, setUseSidecar] = useState(false);
  closeRef.current = onClose;

  useEffect(() => {
    if (!desktopSidecar || typeof window === 'undefined') {
      setUseSidecar(false);
      return;
    }

    const media = window.matchMedia(DESKTOP_SIDECAR_QUERY);
    const sync = () => setUseSidecar(media.matches);
    sync();
    media.addEventListener?.('change', sync);
    return () => media.removeEventListener?.('change', sync);
  }, [desktopSidecar]);

  // Controller Learn is a singleton live-production tool. Portaling the tool
  // out of Inspector/VFX prevents clipping, but also means the portal can
  // outlive its owner unless lifecycle is explicit. Phase 4.97G guarantees
  // only one controller tool is open and closes it on tile/session teardown.
  useEffect(() => {
    if (!open || !desktopSidecar || typeof window === 'undefined') return;

    const closeThis = () => closeRef.current();
    if (activeControllerToolClose && activeControllerToolClose !== closeThis) {
      activeControllerToolClose();
    }
    activeControllerToolClose = closeThis;
    window.addEventListener(CONTROLLER_SIDECAR_CLOSE_EVENT, closeThis);

    return () => {
      window.removeEventListener(CONTROLLER_SIDECAR_CLOSE_EVENT, closeThis);
      if (activeControllerToolClose === closeThis) activeControllerToolClose = null;
    };
  }, [open, desktopSidecar]);

  // Sidecar mode is deliberately modeless: no focus trap, no body scroll
  // lock and no scrim interception. Narrow/mobile mode keeps the original
  // modal behavior so the safe-area overlay remains reliable on phones.
  useDismissable(open, onClose, panelRef, !useSidecar);

  // Backdrop click closes only when the press AND release landed on the
  // backdrop (selecting text and overshooting used to close it). Modeless
  // sidecar mode has no scrim interception, so it stays disabled there.
  const backdropDismiss = useBackdropDismiss(onClose, { enabled: !useSidecar });

  if (!open) return null;

  const dialog = (
    <div
      className={`${s.dialogScrim}${useSidecar ? ` ${layout.sidecarHost}` : ''}`}
      data-sidecar={useSidecar ? 'true' : undefined}
      {...backdropDismiss}
      style={compact && !useSidecar ? {
        paddingTop: 'calc(12px + env(safe-area-inset-top, 0px))',
        paddingBottom: 'calc(12px + env(safe-area-inset-bottom, 0px))',
        paddingLeft: 'max(12px, env(safe-area-inset-left, 0px))',
        paddingRight: 'max(12px, env(safe-area-inset-right, 0px))',
      } : undefined}
    >
      <div
        ref={panelRef}
        className={`${s.dialog}${useSidecar ? ` ${layout.sidecarPanel}` : ''}`}
        role="dialog"
        aria-modal={useSidecar ? undefined : true}
        aria-label={title}
        style={compact && !useSidecar ? {
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

  return typeof document === 'undefined' ? dialog : createPortal(dialog, document.body);
}
