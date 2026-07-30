import { create } from 'zustand';
import type { ControlSchema, ModState, Modulation, ParamState, ParamValue } from '@/renderers/control-schema';
import { coerce, defaultsOf, hydrate } from '@/renderers/control-schema';
import { getPool } from '@/lib/render/pool';
import {
  flushParams,
  flushSnapshotParams,
  persistMod,
  persistParams,
  persistSnapshotParams,
} from '@/lib/persist/client';

interface InspectorState {
  open: boolean;
  navOpen: boolean;
  showAdvanced: boolean;

  schema: ControlSchema | null;
  params: ParamState;
  /** Set of control ids changed since load — drives the "modified" affordance. */
  dirty: Set<string>;

  /** Card identity — the pool key, and what the URL and renderer key off. */
  itemId: string | null;
  /**
   * True when the open card is a saved parameter variation rather than an
   * asset's canonical card. Determines which endpoint edits persist to:
   * a snapshot's board item, or the asset row itself.
   */
  isSnapshot: boolean;
  /** controlId -> routing. Empty for most cards. */
  mod: ModState;

  openInspector: (
    schema: ControlSchema,
    saved: ParamState | undefined,
    itemId: string,
    isSnapshot?: boolean,
    mod?: ModState,
  ) => void;
  setModulation: (controlId: string, mod: Modulation | null) => void;
  closeInspector: () => void;
  toggleNav: () => void;
  setNavOpen: (open: boolean) => void;
  toggleAdvanced: () => void;
  setParam: (id: string, value: ParamValue) => void;
  resetParam: (id: string) => void;
  resetAll: () => void;
}

function persist(itemId: string, isSnapshot: boolean, params: ParamState): void {
  isSnapshot ? persistSnapshotParams(itemId, params) : persistParams(itemId, params);
}

function flush(itemId: string, isSnapshot: boolean): void {
  isSnapshot ? flushSnapshotParams(itemId) : flushParams(itemId);
}

export const useInspectorStore = create<InspectorState>()((set, get) => ({
  open: false,
  navOpen: false,
  showAdvanced: false,
  schema: null,
  params: {},
  dirty: new Set(),
  itemId: null,
  isSnapshot: false,
  mod: {},

  openInspector: (schema, saved, itemId, isSnapshot = false, mod = {}) => {
    const params = hydrate(schema, saved);
    set({ open: true, schema, params, dirty: new Set(), itemId, isSnapshot, mod });
    getPool().get(itemId)?.setParams(params);
    getPool().setBaseParams(itemId, params);
    getPool().setModState(itemId, mod);
  },

  setModulation: (controlId, mod) => {
    const { mod: current, itemId, isSnapshot } = get();
    const next: ModState = { ...current };

    if (mod) next[controlId] = mod;
    else delete next[controlId];

    set({ mod: next });

    if (!itemId) return;
    getPool().setModState(itemId, next);
    persistMod(itemId, next, isSnapshot);
  },

  closeInspector: () => {
    // Flush before closing: a change made just before hitting X would
    // otherwise be lost inside the debounce window.
    const { itemId, isSnapshot } = get();
    if (itemId) flush(itemId, isSnapshot);
    set({ open: false });
  },

  toggleNav: () => set((s) => ({ navOpen: !s.navOpen })),
  setNavOpen: (navOpen) => set({ navOpen }),
  toggleAdvanced: () => set((s) => ({ showAdvanced: !s.showAdvanced })),

  setParam: (id, value) => {
    const { schema, params, dirty, itemId, isSnapshot } = get();
    const control = schema?.controls.find((c) => c.id === id);
    if (!control) return;

    const next = coerce(control, value);
    const nextDirty = new Set(dirty);
    nextDirty.add(id);
    const nextParams = { ...params, [id]: next };
    set({ params: nextParams, dirty: nextDirty });

    if (!itemId) return;
    const renderer = getPool().get(itemId);
    if (control.kind === 'trigger') {
      renderer?.emit(control.event);
    } else {
      renderer?.setParam(id, next);
      persist(itemId, isSnapshot, nextParams);
    }
  },

  resetParam: (id) => {
    const { schema, params, dirty, itemId, isSnapshot } = get();
    const control = schema?.controls.find((c) => c.id === id);
    if (!control || control.kind === 'trigger') return;

    const nextDirty = new Set(dirty);
    nextDirty.delete(id);
    const nextParams = { ...params, [id]: control.default };
    set({ params: nextParams, dirty: nextDirty });

    if (!itemId) return;
    getPool().get(itemId)?.setParam(id, control.default);
    getPool().setBaseParam(itemId, id, control.default);
    persist(itemId, isSnapshot, nextParams);
  },

  resetAll: () => {
    const { schema, itemId, isSnapshot } = get();
    if (!schema) return;
    const params = defaultsOf(schema);
    set({ params, dirty: new Set() });

    if (!itemId) return;
    getPool().get(itemId)?.setParams(params);
    getPool().setBaseParams(itemId, params);
    persist(itemId, isSnapshot, params);
  },
}));
