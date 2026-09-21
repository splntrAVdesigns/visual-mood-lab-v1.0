'use client';

import { useSyncExternalStore } from 'react';
import { FLOATING_PANELS_ENABLED } from '@/lib/panels/config';

/**
 * Floating panels are a desktop feature (Phase 4.98): a viewport wide
 * enough that the focused view uses the desktop overlay (≥821px — the same
 * breakpoint AppShell/features.module.css use to swap in MobileFocusedView)
 * AND a fine primary pointer. A touch tablet in landscape passes the width
 * test but not the pointer test, and keeps the plain stack.
 *
 * Read through useSyncExternalStore so it is correct on the very first
 * client render (no effect-driven flicker) and follows media-query changes
 * — resizing across the breakpoint, plugging in a mouse.
 */
const QUERY = '(min-width: 821px) and (pointer: fine)';

function subscribe(onChange: () => void): () => void {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}

const getSnapshot = (): boolean => window.matchMedia(QUERY).matches;
const getServerSnapshot = (): boolean => false;

const alwaysOff = (): (() => void) => () => {};

export function useFloatCapable(): boolean {
  // The kill switch is a build-time constant, so the branch is stable
  // between renders — but keep one hook call either way for the rules of hooks.
  const capable = useSyncExternalStore(
    FLOATING_PANELS_ENABLED ? subscribe : alwaysOff,
    FLOATING_PANELS_ENABLED ? getSnapshot : getServerSnapshot,
    getServerSnapshot,
  );
  return FLOATING_PANELS_ENABLED && capable;
}
