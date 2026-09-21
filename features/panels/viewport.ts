'use client';

import { useMemo, useSyncExternalStore } from 'react';
import type { Viewport } from '@/lib/panels/layout';

/**
 * The area floating panels may occupy: the window, minus the fixed
 * Inspector drawer on the right (its width is the --inspector-w token —
 * read from the document rather than hardcoded, so retuning the token
 * retunes the clamp with it).
 */
const FALLBACK_INSPECTOR_W = 320;

// getComputedStyle() can force a style recalculation, and this is read from
// useSyncExternalStore's getSnapshot — which React calls on every render and
// every store notification. The token only changes with the stylesheet (or a
// breakpoint), so read it once and drop the cache on resize.
let cachedInspectorWidth: number | null = null;
let invalidateInstalled = false;

function inspectorWidth(): number {
  if (!invalidateInstalled && typeof window !== 'undefined') {
    invalidateInstalled = true;
    window.addEventListener('resize', () => {
      cachedInspectorWidth = null;
    });
  }
  if (cachedInspectorWidth !== null) return cachedInspectorWidth;
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--inspector-w');
  const n = parseFloat(raw);
  cachedInspectorWidth = Number.isFinite(n) && n > 0 ? n : FALLBACK_INSPECTOR_W;
  return cachedInspectorWidth;
}

/** Imperative read — for event handlers (drag start, keyboard move, float button). */
export function readViewport(): Viewport {
  return {
    width: window.innerWidth,
    height: window.innerHeight,
    rightInset: inspectorWidth(),
  };
}

function subscribe(onChange: () => void): () => void {
  // Coalesce a resize storm into one notification per frame.
  let raf = 0;
  const onResize = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(onChange);
  };
  window.addEventListener('resize', onResize);
  return () => {
    window.removeEventListener('resize', onResize);
    cancelAnimationFrame(raf);
  };
}

// The snapshot is a primitive string so React's equality check is by value —
// an object snapshot would look "changed" on every read.
const getSnapshot = (): string => {
  const v = readViewport();
  return `${v.width}x${v.height}x${v.rightInset}`;
};
const getServerSnapshot = (): string => `1280x800x${FALLBACK_INSPECTOR_W}`;

/** Reactive viewport for render-time clamping. */
export function useViewport(): Viewport {
  const key = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return useMemo(() => {
    const [width, height, rightInset] = key.split('x').map(Number);
    return { width, height, rightInset };
  }, [key]);
}
