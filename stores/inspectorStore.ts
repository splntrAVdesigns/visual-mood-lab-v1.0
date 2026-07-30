import { create } from 'zustand';
import type { ControlSchema, ParamState, ParamValue } from '@/renderers/control-schema';
import { coerce, defaultsOf, hydrate } from '@/renderers/control-schema';
import { getPool } from '@/lib/render/pool';
import { flushParams, persistParams } from '@/lib/persist/client';

interface InspectorState {
  open: boolean;
  navOpen: boolean;
  showAdvanced: boolean;

  /** Schema for the asset currently in the inspector. */
  schema: ControlSchema | null;
  /** Live values. Phase 3 will persist these; Phase 0 keeps them in memory. */
  params: ParamState;
  /** Set of control ids changed since load — drives the "modified" affordance. */
  dirty: Set<string>;
  /** Asset the inspector is bound to, so edits reach the right renderer. */
  assetId: string | null;

  openInspector: (schema: ControlSchema, saved?: ParamState, assetId?: string) => void;
  closeInspector: () => void;
  toggleNav: () => void;
  setNavOpen: (open: boolean) => void;
  toggleAdvanced: () => void;
  setParam: (id: string, value: ParamValue) => void;
  resetParam: (id: string) => void;
  resetAll: () => void;
}

export const useInspectorStore = create<InspectorState>()((set, get) => ({
  open: false,
  navOpen: false,
  showAdvanced: false,
  schema: null,
  params: {},
  dirty: new Set(),
  assetId: null,

  openInspector: (schema, saved, assetId) => {
    const params = hydrate(schema, saved);
    set({ open: true, schema, params, dirty: new Set(), assetId: assetId ?? null });
    if (assetId) getPool().get(assetId)?.setParams(params);
  },

  closeInspector: () => {
    // Flush before closing: a change made just before hitting X would
    // otherwise be lost inside the debounce window.
    const { assetId } = get();
    if (assetId) flushParams(assetId);
    set({ open: false });
  },

  toggleNav: () => set((s) => ({ navOpen: !s.navOpen })),
  setNavOpen: (navOpen) => set({ navOpen }),
  toggleAdvanced: () => set((s) => ({ showAdvanced: !s.showAdvanced })),

  setParam: (id, value) => {
    const { schema, params, dirty } = get();
    const control = schema?.controls.find((c) => c.id === id);
    if (!control) return;

    const next = coerce(control, value);
    const nextDirty = new Set(dirty);
    nextDirty.add(id);

    set({ params: { ...params, [id]: next }, dirty: nextDirty });

    // Push straight through to the live renderer. Phase 3 adds the debounced
    // persistence layer behind this; the binding itself lands now.
    const { assetId } = get();
    if (assetId) {
      const renderer = getPool().get(assetId);
      if (control.kind === 'trigger') {
        renderer?.emit(control.event);
      } else {
        renderer?.setParam(id, next);
        persistParams(assetId, { ...params, [id]: next });
      }
    }
  },

  resetParam: (id) => {
    const { schema, params, dirty } = get();
    const control = schema?.controls.find((c) => c.id === id);
    if (!control || control.kind === 'trigger') return;

    const nextDirty = new Set(dirty);
    nextDirty.delete(id);
    set({ params: { ...params, [id]: control.default }, dirty: nextDirty });

    const { assetId } = get();
    if (assetId) {
      getPool().get(assetId)?.setParam(id, control.default);
      persistParams(assetId, { ...params, [id]: control.default });
    }
  },

  resetAll: () => {
    const { schema } = get();
    if (!schema) return;
    const params = defaultsOf(schema);
    set({ params, dirty: new Set() });

    const { assetId } = get();
    if (assetId) {
      getPool().get(assetId)?.setParams(params);
      persistParams(assetId, params);
    }
  },
}));
