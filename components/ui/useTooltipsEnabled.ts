'use client';

import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'vml:tooltips-enabled';

function readStored(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

/**
 * Global tooltip-visibility preference. Defaults OFF on every platform per
 * product decision (desktop and mobile alike) — this is opt-in, not
 * opt-out.
 *
 * This is a minimal, self-contained localStorage-backed implementation,
 * not wired into the app's real settings store/panel — that file wasn't
 * available when this was built. A Settings UI should eventually own this
 * preference for real; when it does, swap this hook's internals for a
 * read from that store and nothing at the call sites (Tooltip.tsx, and
 * any future Settings toggle) needs to change, since they only depend on
 * this hook's return shape.
 *
 * Starts false on both server and client to avoid a hydration mismatch,
 * then syncs from storage after mount.
 */
export function useTooltipsEnabled(): [boolean, (next: boolean) => void] {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    setEnabled(readStored());
  }, []);

  const update = useCallback((next: boolean) => {
    setEnabled(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, String(next));
    } catch {
      // Private browsing / storage disabled — preference just won't persist.
    }
  }, []);

  return [enabled, update];
}
