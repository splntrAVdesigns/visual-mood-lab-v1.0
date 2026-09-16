'use client';

import { useEffect, useRef, useState } from 'react';
import { IconButton } from '@/components/ui';
import s from '../features.module.css';

export interface OverflowMenuItem {
  id: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  /** Styles the row as a destructive action (red text), matching the
      existing `variant="danger"` convention on Button elsewhere in this
      header. Not used today — Delete stays inline-always per product
      decision (see features.module.css's header-collapse comment) —
      but kept on the item shape since a future addition (e.g. a
      collapsed "Remove all modulation") would want it without a second
      item shape. */
  danger?: boolean;
}

interface HeaderOverflowMenuProps {
  items: OverflowMenuItem[];
  /** Accessible label for the trigger + the menu region itself. */
  label?: string;
}

/**
 * The `⋯ More` trigger + anchored popover that collapses lower-frequency
 * FocusedAssetOverlay header actions (Sound, VCapture, Save snapshot/
 * Download) at narrow panel widths. See features.module.css's
 * `.focusHeaderOverflowGroup` / `.focusHeaderMoreTrigger` container-query
 * pair for the CSS side of the swap — this component only renders the
 * trigger and the menu; which one is visible at a given panel width is a
 * pure CSS decision, not React state, so there's no resize listener here
 * deciding "am I collapsed."
 *
 * Positioning note: anchored with a plain getBoundingClientRect() +
 * position:fixed, not a shared popover utility — ModulationPanel.tsx's
 * own floating-looking panel (`.modPanel`) actually renders inline in
 * the focused-view sidecar, not as a floating popover, so there was no
 * existing anchor-positioning piece to reuse here. If the app grows a
 * second floating menu beyond this one, this positioning effect is the
 * candidate to extract into a shared hook at that point — not before.
 */
export function HeaderOverflowMenu({ items, label = 'More actions' }: HeaderOverflowMenuProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  // Ref sits on a wrapping <span>, not the IconButton itself — this
  // component's own icon library may or may not forward refs through
  // IconButton, and a wrapper avoids depending on that either way.
  const anchorRef = useRef<HTMLSpanElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const openMenu = () => {
    const el = anchorRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPos({ top: rect.bottom + 6, right: Math.max(8, window.innerWidth - rect.right) });
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
    };
    // A resize or fullscreen transition can invalidate the anchored
    // position (the trigger itself may move or disappear — e.g.
    // entering fullscreen already force-closes every open sidecar panel
    // in FocusedAssetOverlay). Closing rather than re-measuring live
    // matches that existing behavior instead of adding a second,
    // differently-timed reflow response.
    const onReflow = () => setOpen(false);

    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('resize', onReflow);
    document.addEventListener('fullscreenchange', onReflow);

    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('resize', onReflow);
      document.removeEventListener('fullscreenchange', onReflow);
    };
  }, [open]);

  // Belt-and-suspenders: if the container query hides
  // .focusHeaderMoreTrigger (panel widened back out) while the menu
  // happens to be open, don't leave an orphaned floating panel behind.
  useEffect(() => {
    if (!open) return;
    const el = anchorRef.current;
    if (!el) return;
    if (getComputedStyle(el).display === 'none') setOpen(false);
  }, [open]);

  if (items.length === 0) return null;

  return (
    <span ref={anchorRef} className={s.focusHeaderMoreTrigger}>
      <IconButton
        label={open ? `Close ${label.toLowerCase()}` : label}
        icon={<MoreIconFallback />}
        active={open}
        onClick={() => (open ? setOpen(false) : openMenu())}
      />
      {open && pos && (
        <div
          ref={panelRef}
          className={s.headerOverflowPanel}
          style={{ top: pos.top, right: pos.right }}
          role="menu"
          aria-label={label}
        >
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              className={s.headerOverflowItem}
              data-danger={item.danger ? 'true' : undefined}
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                item.onClick();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

/**
 * Inline fallback so this component compiles standalone without a
 * confirmed `MoreIcon`/`EllipsisIcon` export from `@/components/ui`.
 * Swap this for the real icon from that library — given how complete
 * that set already is (Close, Code, Download, Fullscreen, VCapture,
 * Chevron, Reset all exist), it's very likely already there under some
 * name; this just avoids blocking on confirming which one before shipping the
 * rest of the fix. See PLACEMENT.md.
 */
function MoreIconFallback() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="3.5" cy="8" r="1.4" fill="currentColor" />
      <circle cx="8" cy="8" r="1.4" fill="currentColor" />
      <circle cx="12.5" cy="8" r="1.4" fill="currentColor" />
    </svg>
  );
}
