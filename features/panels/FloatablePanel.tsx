'use client';

import {
  useEffect,
  useRef,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { usePanelLayoutStore } from '@/stores/panelLayoutStore';
import {
  DEFAULT_PANEL_WIDTH,
  DRAG_THRESHOLD,
  PANEL_MARGIN,
  clampGeometry,
  detachGeometry,
  snapGeometry,
  type FloatGeometry,
  type PanelId,
  type PanelMode,
  type Viewport,
} from '@/lib/panels/layout';
import { readViewport, useViewport } from './viewport';
import { useFloatCapable } from './useFloatCapable';
import s from './panelSlot.module.css';

interface FloatablePanelProps {
  id: PanelId;
  children: ReactNode;
}

interface DragState {
  slot: HTMLElement;
  /** Removes the window listeners registered for this gesture. */
  detach: () => void;
  pointerId: number;
  startX: number;
  startY: number;
  /** Where the panel is (or will be, once detached) at the start of the gesture. */
  originX: number;
  originY: number;
  /**
   * The left/top the element is rendered at while dragging. Movement is a
   * transform RELATIVE to this, so the drag never touches layout; the final
   * position is written to left/top once, on release.
   */
  baseX: number;
  baseY: number;
  /** Set when the gesture detaches a stacked panel: where it lands. */
  detachTo: FloatGeometry | null;
  width: number;
  height: number;
  startedFrom: PanelMode;
  moved: boolean;
  viewport: Viewport;
  raf: number;
  /** Latest pointer sample; clamp/snap/transform are computed once per frame from it. */
  latest: { x: number; y: number; alt: boolean } | null;
  pending: FloatGeometry | null;
}

/** Things inside a header that must keep behaving as themselves, not start a drag. */
const INTERACTIVE = 'button, a, input, select, textarea, [role="tab"], [role="button"], [role="slider"]';

/**
 * A drag that ends over the bare scrim would otherwise produce a `click` on
 * the common ancestor — the scrim — and close the whole focused overlay
 * (its onClick is closeOverlay). Swallow exactly one click, in the capture
 * phase at window so it never reaches React's root listener, and clean up
 * on the next tick in case no click follows.
 */
function suppressNextClick(): void {
  const stop = (ev: Event) => {
    ev.stopPropagation();
    ev.preventDefault();
  };
  window.addEventListener('click', stop, { capture: true, once: true });
  window.setTimeout(() => window.removeEventListener('click', stop, { capture: true }), 0);
}

function writePosition(slot: HTMLElement, geo: FloatGeometry): void {
  slot.style.left = `${geo.x}px`;
  slot.style.top = `${geo.y}px`;
  slot.style.setProperty('--panel-y', `${geo.y}px`);
}

/** Compositor-only movement: no style recalculation of the panel's contents, no layout. */
function writeTransform(slot: HTMLElement, dx: number, dy: number): void {
  slot.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
}

/**
 * Wraps one sidecar panel. In stack mode it is a passthrough block. In float
 * mode it is a `position: fixed` panel the person can drag anywhere clear of
 * the Inspector. See panelSlot.module.css for why the element never moves in
 * the React tree.
 *
 * Dragging writes position straight to the element (in rAF) and commits to
 * the store once, on release — a Modulation panel with many rows must not
 * re-render sixty times a second under the pointer.
 */
export function FloatablePanel({ id, children }: FloatablePanelProps) {
  const capable = useFloatCapable();
  const storedMode = usePanelLayoutStore((st) => st.modes[id]);
  const geometry = usePanelLayoutStore((st) => st.geometry[id]);
  const zRank = usePanelLayoutStore((st) => st.z.indexOf(id));
  const viewport = useViewport();

  const drag = useRef<DragState | null>(null);

  const mode: PanelMode = capable ? storedMode : 'stack';
  const geo =
    mode === 'float'
      ? clampGeometry(geometry ?? { x: PANEL_MARGIN, y: 96, w: DEFAULT_PANEL_WIDTH }, viewport)
      : null;

  // A gesture in flight must not outlive the component.
  useEffect(
    () => () => {
      const d = drag.current;
      if (!d) return;
      if (d.raf) cancelAnimationFrame(d.raf);
      d.detach();
      drag.current = null;
    },
    [],
  );

  const endDrag = (d: DragState): void => {
    if (d.raf) cancelAnimationFrame(d.raf);
    d.detach();
    d.slot.style.transform = '';
    delete d.slot.dataset.dragging;
    if (d.slot.hasPointerCapture(d.pointerId)) d.slot.releasePointerCapture(d.pointerId);
    drag.current = null;
  };

  /** One frame of a drag: clamp + snap the latest pointer sample, then move by transform. */
  const applyFrame = (d: DragState): void => {
    d.raf = 0;
    // A frame callback queued before the gesture ended must not write after it.
    if (drag.current !== d) return;
    const p = d.latest;
    if (!p) return;
    // Right after a stacked panel detaches, React has not necessarily committed
    // its `position: fixed` yet; a transform now would be relative to its
    // in-stack position. Wait a frame for data-mode to flip.
    if (d.slot.dataset.mode !== 'float') {
      d.raf = requestAnimationFrame(() => applyFrame(d));
      return;
    }
    let next = clampGeometry(
      { x: d.originX + (p.x - d.startX), y: d.originY + (p.y - d.startY), w: d.width },
      d.viewport,
    );
    if (!p.alt) next = snapGeometry(next, d.viewport, { height: d.height });
    d.pending = next;
    writeTransform(d.slot, next.x - d.baseX, next.y - d.baseY);
  };

  const onMove = (e: PointerEvent): void => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;

    if (!d.moved) {
      if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < DRAG_THRESHOLD) return;
      d.moved = true;
      d.slot.dataset.dragging = 'true';
      // Capture only NOW, once it is really a drag. Capturing on press would
      // retarget the eventual `click` of a plain header click to the slot —
      // which sits outside the panel's stopPropagation and bubbles to the
      // scrim's close handler. Capture also keeps the gesture alive when the
      // pointer crosses a cross-origin p5 iframe, which swallows window events.
      try {
        d.slot.setPointerCapture(d.pointerId);
      } catch {
        // Pointer already gone — the pointerup/cancel below ends the gesture.
      }
      if (d.detachTo) usePanelLayoutStore.getState().float(id, d.detachTo);
    }

    // The handler only records the sample; the work happens once per frame.
    d.latest = { x: e.clientX, y: e.clientY, alt: e.altKey };
    if (!d.raf) d.raf = requestAnimationFrame(() => applyFrame(d));
  };

  const onUp = (e: PointerEvent): void => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    const { slot, moved } = d;
    // Settle on the newest pointer sample even if the last frame hasn't run.
    if (d.raf) {
      cancelAnimationFrame(d.raf);
      d.raf = 0;
    }
    if (moved && d.latest && slot.dataset.mode === 'float') applyFrame(d);
    const final = d.pending;
    endDrag(d); // clears the transform...
    if (!moved) return; // a plain click: leave it entirely to the browser
    if (final) {
      writePosition(slot, final); // ...and this sets left/top in the same frame: no jump
      usePanelLayoutStore.getState().setGeometry(id, final);
    }
    suppressNextClick();
  };

  const onCancel = (e: PointerEvent): void => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    const { moved, startedFrom } = d;
    endDrag(d); // clears the transform; a floating panel is back where it started
    if (!moved) return;
    // A panel detached mid-gesture goes back to the stack.
    if (startedFrom === 'stack') usePanelLayoutStore.getState().dock(id);
    suppressNextClick();
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    // Any press on a floating panel brings it to the front.
    if (mode === 'float') usePanelLayoutStore.getState().raise(id);

    if (!capable || e.button !== 0 || e.pointerType === 'touch') return;
    const target = e.target as Element;
    const handle = target.closest('[data-panel-handle]');
    if (!handle || !e.currentTarget.contains(handle)) return;
    if (target.closest(INTERACTIVE) && !target.closest('[data-panel-drag]')) return;
    if (drag.current) endDrag(drag.current); // a stale gesture from a lost pointerup

    const slot = e.currentTarget;
    const rect = slot.getBoundingClientRect();
    const viewport = readViewport();
    // Dragging a stacked panel out detaches it anchored by its right edge (so
    // widening to the floating width grows away from the tile). An already
    // floating panel just keeps its rect.
    const detachTo = mode === 'stack' ? detachGeometry(rect, viewport) : null;
    const origin = detachTo ?? {
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      w: Math.round(rect.width),
    };
    // Move/up are tracked on window from the start (not on the slot) so a fast
    // flick that leaves the panel before the threshold cannot lose the gesture.
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    drag.current = {
      slot,
      detach: () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onCancel);
      },
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      originX: origin.x,
      originY: origin.y,
      baseX: origin.x,
      baseY: origin.y,
      detachTo,
      width: origin.w,
      height: rect.height,
      startedFrom: mode,
      moved: false,
      viewport,
      raf: 0,
      latest: null,
      pending: null,
    };
    // Suppresses the compat mouse events that would start a text selection.
    e.preventDefault();
  };

  const style: CSSProperties | undefined = geo
    ? ({
        left: geo.x,
        top: geo.y,
        width: geo.w,
        zIndex: 1 + Math.max(zRank, 0),
        '--panel-y': `${geo.y}px`,
      } as CSSProperties)
    : undefined;

  return (
    <div
      className={s.slot}
      data-panel-id={id}
      data-mode={mode}
      data-floatable={capable ? 'true' : undefined}
      style={style}
      onPointerDown={onPointerDown}
    >
      {children}
    </div>
  );
}
