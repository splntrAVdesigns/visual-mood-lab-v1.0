import { create } from 'zustand';
import type { ControlSchema, ModState, Modulation, ParamState, ParamValue } from '@/renderers/control-schema';
import { coerce, defaultsOf, hydrate } from '@/renderers/control-schema';
import { getPool } from '@/lib/render/pool';
import { useBoardStore } from './boardStore';
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
  /**
   * True when the signed-in viewer owns the underlying asset. A canonical
   * card for a LIBRARY asset (isSnapshot false, isOwned false) still can't
   * write to the shared asset row — same reasoning as a snapshot, so it
   * persists the same way. See persist()/flush() below.
   */
  isOwned: boolean;
  /** controlId -> routing. Empty for most cards. */
  mod: ModState;

  openInspector: (
    schema: ControlSchema,
    saved: ParamState | undefined,
    itemId: string,
    isSnapshot?: boolean,
    mod?: ModState,
    isOwned?: boolean,
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

/*
 * Persist AND sync. These two always have to happen together: the database
 * is the durable copy, but the board store is what the UI actually reads
 * when you reopen a card or look at its grid thumbnail. Updating only the
 * database made edits look like they never saved.
 *
 * `usesBoardItemPath` covers two cases with the same underlying reason:
 * a snapshot, AND a canonical card for an asset the viewer doesn't own
 * (a shared library asset cloned onto their board). Neither can write to
 * the shared `assets` row — that would let one person's slider edit alter
 * what every other account sees — so both persist as a per-card override
 * on the board item instead, the same mechanism either way.
 *
 * The board-store sync rides the SAME debounce as the network write
 * (passed as onSaved), not a synchronous call on every setParam(). It used
 * to fire on every single drag tick, which handed RendererStage's mount
 * effect a brand-new `asset` object dozens of times a second — see
 * lib/persist/client.ts's persistParams doc comment for the full mechanism
 * of why that made the live canvas go black for the whole duration of a
 * drag.
 */
function persist(itemId: string, usesBoardItemPath: boolean, params: ParamState): void {
  const onSaved = (saved: ParamState) => useBoardStore.getState().updateAssetParams(itemId, saved);
  usesBoardItemPath
    ? persistSnapshotParams(itemId, params, 500, onSaved)
    : persistParams(itemId, params, 500, onSaved);
}

function flush(itemId: string, usesBoardItemPath: boolean): void {
  const onSaved = (saved: ParamState) => useBoardStore.getState().updateAssetParams(itemId, saved);
  usesBoardItemPath ? flushSnapshotParams(itemId, onSaved) : flushParams(itemId, onSaved);
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
  isOwned: true,
  mod: {},

  openInspector: (schema, saved, itemId, isSnapshot = false, mod = {}, isOwned = true) => {
    const params = hydrate(schema, saved);
    set({ open: true, schema, params, dirty: new Set(), itemId, isSnapshot, isOwned, mod });
    getPool().get(itemId)?.setParams(params);
    getPool().setBaseParams(itemId, params);
    getPool().setModState(itemId, mod);
  },

  setModulation: (controlId, mod) => {
    const { mod: current, itemId, isSnapshot, isOwned } = get();
    const next: ModState = { ...current };

    if (mod) next[controlId] = mod;
    else delete next[controlId];

    set({ mod: next });

    if (!itemId) return;
    getPool().setModState(itemId, next);
    persistMod(itemId, next, isSnapshot || !isOwned);
    useBoardStore.getState().updateAssetMod(itemId, next);
  },

  closeInspector: () => {
    // Flush before closing: a change made just before hitting X would
    // otherwise be lost inside the debounce window.
    const { itemId, isSnapshot, isOwned } = get();
    if (itemId) flush(itemId, isSnapshot || !isOwned);
    set({ open: false });
  },

  toggleNav: () => set((s) => ({ navOpen: !s.navOpen })),
  setNavOpen: (navOpen) => set({ navOpen }),
  toggleAdvanced: () => set((s) => ({ showAdvanced: !s.showAdvanced })),

  setParam: (id, value) => {
    const { schema, params, dirty, itemId, isSnapshot, isOwned } = get();
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
      persist(itemId, isSnapshot || !isOwned, nextParams);
    }
  },

  resetParam: (id) => {
    const { schema, params, dirty, itemId, isSnapshot, isOwned } = get();
    const control = schema?.controls.find((c) => c.id === id);
    if (!control || control.kind === 'trigger') return;

    const nextDirty = new Set(dirty);
    nextDirty.delete(id);
    const nextParams = { ...params, [id]: control.default };
    set({ params: nextParams, dirty: nextDirty });

    if (!itemId) return;
    getPool().get(itemId)?.setParam(id, control.default);
    getPool().setBaseParam(itemId, id, control.default);
    persist(itemId, isSnapshot || !isOwned, nextParams);
  },

  resetAll: () => {
    const { schema, itemId, isSnapshot, isOwned } = get();
    if (!schema) return;
    const params = defaultsOf(schema);
    set({ params, dirty: new Set() });

    if (!itemId) return;
    getPool().get(itemId)?.setParams(params);
    getPool().setBaseParams(itemId, params);
    persist(itemId, isSnapshot || !isOwned, params);
  },
}));
