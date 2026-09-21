import { create } from 'zustand';
import { FLOATING_PANELS_ENABLED } from '@/lib/panels/config';
import {
  PANEL_LAYOUT_STORAGE_KEY,
  PANEL_LAYOUT_VERSION,
  PANEL_ORDER,
  afterDockAll,
  afterOpen,
  afterToggle,
  allExpanded,
  clampAllGeometry,
  defaultModes,
  defaultPersistedLayout,
  parsePersistedLayout,
  raiseInOrder,
  type CollapsedMap,
  type FloatGeometry,
  type PanelId,
  type PanelMode,
  type PersistedPanelLayout,
  type Viewport,
} from '@/lib/panels/layout';

/**
 * Phase 4.98 — floating sidecar panel layout.
 *
 * Two deliberately separate halves:
 *   - PERSISTED (`modes`, `geometry`): remembered per device in localStorage.
 *   - SESSION (`collapsed`, `z`): never persisted. Open/closed flags live in
 *     FocusedAssetOverlay and reset per tile; collapsed state and stacking
 *     order reset with them (`resetSession`).
 *
 * All the actual decisions (clamping, accordion transitions, parsing) are
 * pure functions in lib/panels/layout.ts. This file only holds state and
 * writes storage. It never reads the DOM: callers pass in the viewport.
 */

function readPersisted(): PersistedPanelLayout {
  if (typeof window === 'undefined') return defaultPersistedLayout();
  let layout = defaultPersistedLayout();
  try {
    const raw = window.localStorage.getItem(PANEL_LAYOUT_STORAGE_KEY);
    if (raw) layout = parsePersistedLayout(JSON.parse(raw));
  } catch {
    // Corrupt JSON / storage disabled — fall back to defaults.
  }
  // Kill switch: present the stack regardless of what was saved, without
  // overwriting the saved layout (so turning it back on restores it).
  if (!FLOATING_PANELS_ENABLED) layout = { ...layout, modes: defaultModes() };
  return layout;
}

function writePersisted(modes: Record<PanelId, PanelMode>, geometry: Partial<Record<PanelId, FloatGeometry>>): void {
  if (typeof window === 'undefined' || !FLOATING_PANELS_ENABLED) return;
  try {
    const payload: PersistedPanelLayout = { v: PANEL_LAYOUT_VERSION, modes, geometry };
    window.localStorage.setItem(PANEL_LAYOUT_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Private browsing / quota — the layout just won't persist.
  }
}

interface PanelLayoutState {
  // persisted
  modes: Record<PanelId, PanelMode>;
  geometry: Partial<Record<PanelId, FloatGeometry>>;
  // session
  collapsed: CollapsedMap;
  /** Back → front. */
  z: PanelId[];

  /** Detach `id` into a floating panel at `geo` (already clamped by the caller). */
  float: (id: PanelId, geo: FloatGeometry) => void;
  /** Return `id` to the stack. Counts as opening it for the accordion. */
  dock: (id: PanelId) => void;
  dockAll: () => void;
  /** Commit a final position (end of a drag, keyboard move, resize clamp). */
  setGeometry: (id: PanelId, geo: FloatGeometry) => void;
  raise: (id: PanelId) => void;
  toggleCollapsed: (id: PanelId, additive?: boolean) => void;
  /** A panel was just opened from the header toolbar. */
  noteOpened: (id: PanelId) => void;
  resetSession: () => void;
  clampAll: (viewport: Viewport) => void;
}

const initial = readPersisted();

export const usePanelLayoutStore = create<PanelLayoutState>((set, get) => ({
  modes: initial.modes,
  geometry: initial.geometry,
  collapsed: allExpanded(),
  z: [...PANEL_ORDER],

  float: (id, geo) => {
    const modes = { ...get().modes, [id]: 'float' as const };
    const geometry = { ...get().geometry, [id]: geo };
    set({ modes, geometry, z: raiseInOrder(get().z, id) });
    writePersisted(modes, geometry);
  },

  dock: (id) => {
    const modes = { ...get().modes, [id]: 'stack' as const };
    set({ modes, collapsed: afterOpen(get().collapsed, modes, id) });
    writePersisted(modes, get().geometry);
  },

  dockAll: () => {
    const modes = defaultModes();
    set({ modes, collapsed: afterDockAll(get().collapsed, get().z) });
    writePersisted(modes, get().geometry);
  },

  setGeometry: (id, geo) => {
    const geometry = { ...get().geometry, [id]: geo };
    set({ geometry });
    writePersisted(get().modes, geometry);
  },

  raise: (id) => {
    const z = get().z;
    if (z[z.length - 1] === id) return;
    set({ z: raiseInOrder(z, id) });
  },

  toggleCollapsed: (id, additive = false) => {
    set({ collapsed: afterToggle(get().collapsed, get().modes, id, additive) });
  },

  noteOpened: (id) => {
    set({ collapsed: afterOpen(get().collapsed, get().modes, id) });
  },

  resetSession: () => {
    set({ collapsed: allExpanded(), z: [...PANEL_ORDER] });
  },

  clampAll: (viewport) => {
    const { geometry, changed } = clampAllGeometry(get().geometry, viewport);
    if (!changed) return;
    set({ geometry });
    writePersisted(get().modes, geometry);
  },
}));
