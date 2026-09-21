'use client';

import { useCallback } from 'react';
import { usePanelLayoutStore } from '@/stores/panelLayoutStore';
import type { PanelId } from '@/lib/panels/layout';

/**
 * A sidecar panel's collapsed state, held in the shared layout store so the
 * stack can behave as an accordion (expanding one collapses the others).
 * Drop-in for the `const [collapsed, setCollapsed] = useState(false)` each
 * panel used to keep locally.
 *
 * Call it unconditionally, ABOVE the panel's `embedded` early return, so hook
 * order is identical on the desktop and mobile-sheet paths. The embedded
 * (mobile) path never reads the value.
 */
export function usePanelCollapsed(
  id: PanelId,
): [collapsed: boolean, toggle: (opts?: { additive?: boolean }) => void] {
  const collapsed = usePanelLayoutStore((s) => s.collapsed[id]);
  const toggleCollapsed = usePanelLayoutStore((s) => s.toggleCollapsed);
  const toggle = useCallback(
    (opts?: { additive?: boolean }) => toggleCollapsed(id, opts?.additive ?? false),
    [toggleCollapsed, id],
  );
  return [collapsed, toggle];
}
