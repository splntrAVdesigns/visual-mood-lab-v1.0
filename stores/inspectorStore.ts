import { create } from 'zustand';
import type { ControlSchema, ModState, Modulation, ParamState, ParamValue, SoundState } from '@/renderers/control-schema';
import { coerce, defaultsOf, effectiveMax, hydrate } from '@/renderers/control-schema';
import { getPool } from '@/lib/render/pool';
import { DEFAULT_SOUND_STATE, normalizeSoundState } from '@/lib/sound/types';
import { useBoardStore } from './boardStore';
import {
  flushParams,
  flushSnapshotParams,
  persistMod,
  persistParams,
  persistSnapshotParams,
  persistSound,
  persistEffects,
} from '@/lib/persist/client';
import type { EffectInstance } from '@/lib/effects/types';
import { MAX_EFFECTS_PER_CHAIN, createEffectInstance } from '@/lib/effects/types';
import { defaultEffectParams, getEffectSchema } from '@/lib/effects/registry';

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
   * The underlying asset's real id — DISTINCT from itemId. itemId is the
   * board CARD's identity (what the pool, the URL, and getPool().get()
   * key off); assetId is the shader/sketch/media row itself. The two
   * happen to coincide for a plain canonical card, which is why this
   * field's absence went unnoticed for so long — see persist()/flush()
   * below for the bug that not tracking this separately caused.
   */
  assetId: string | null;
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
  /** Tile sound preset configuration for the open card. */
  sound: SoundState;
  /** Phase 4.96 — the open card's VFX chain. Empty for most cards, same
      as mod above. */
  effects: EffectInstance[];

  openInspector: (
    schema: ControlSchema,
    saved: ParamState | undefined,
    itemId: string,
    assetId: string,
    isSnapshot?: boolean,
    mod?: ModState,
    isOwned?: boolean,
    sound?: SoundState,
    effects?: EffectInstance[],
  ) => void;
  setModulation: (controlId: string, mod: Modulation | null) => void;
  setSoundState: (sound: SoundState) => void;
  /** Phase 4.96 — VFX rack actions. Each mirrors setSoundState's shape:
      update local state, push to the live pool entry, persist, sync the
      board store — in that order, same as every other setter here. */
  addEffect: (effectType: string) => void;
  removeEffect: (instanceId: string) => void;
  reorderEffects: (fromIndex: number, toIndex: number) => void;
  setEffectEnabled: (instanceId: string, enabled: boolean) => void;
  setEffectMix: (instanceId: string, mix: number) => void;
  setEffectParam: (instanceId: string, paramId: string, value: ParamValue) => void;
  setEffectModulation: (instanceId: string, paramId: string, mod: Modulation | null) => void;
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
 * FIX: this used to take only `itemId` and pass it to BOTH
 * persistSnapshotParams (correct — that one genuinely wants the board
 * item's own id) AND persistParams (WRONG — that one wants the real
 * underlying asset's id, which is not generally the same string as the
 * board card's itemId). The two only happened to match for a canonical,
 * owned, non-snapshot card in the cases exercised so far, which is every
 * seed asset (owned by a fixed library account, never the signed-in
 * viewer, so isOwned is always false there — routing through the
 * board-item path regardless) and every snapshot (isSnapshot always
 * true). A directly owned, non-snapshot asset — a genuine upload or
 * capture — is the first case where itemId and the real asset id
 * actually diverge, which is exactly what surfaced this as a 404 on the
 * Video Export Foundation capture's Paused toggle. assetId now threads
 * through from openInspector() (ultimately from openAssetById in
 * openAsset.ts, which has the real Asset object and thus asset.id in
 * hand) precisely so this function has the right id for both branches.
 *
 * The board-store sync rides the SAME debounce as the network write
 * (passed as onSaved), not a synchronous call on every setParam(). It used
 * to fire on every single drag tick, which handed RendererStage's mount
 * effect a brand-new `asset` object dozens of times a second — see
 * lib/persist/client.ts's persistParams doc comment for the full mechanism
 * of why that made the live canvas go black for the whole duration of a
 * drag.
 */
function persist(itemId: string, assetId: string, usesBoardItemPath: boolean, params: ParamState): void {
  const onSaved = (saved: ParamState) => useBoardStore.getState().updateAssetParams(itemId, saved);
  usesBoardItemPath
    ? persistSnapshotParams(itemId, params, 500, onSaved)
    : persistParams(assetId, params, 500, onSaved);
}

function flush(itemId: string, assetId: string, usesBoardItemPath: boolean): void {
  const onSaved = (saved: ParamState) => useBoardStore.getState().updateAssetParams(itemId, saved);
  usesBoardItemPath ? flushSnapshotParams(itemId, onSaved) : flushParams(assetId, onSaved);
}

/** Phase 4.96 — the shared tail every VFX action below runs: push to the
    live pool entry, persist (debounced, same 500ms window as params/mod/
    sound), sync the board store so a reopened card and its grid thumbnail
    both reflect the edit. Mirrors setSoundState's body exactly, factored
    out since six different actions below all end the same way. Same
    itemId/assetId fix as persist()/flush() above — see that doc. */
function applyEffects(
  itemId: string,
  assetId: string,
  isSnapshot: boolean,
  isOwned: boolean,
  effects: EffectInstance[],
): void {
  getPool().setEffects(itemId, effects);
  persistEffects(itemId, assetId, effects, isSnapshot || !isOwned);
  useBoardStore.getState().updateAssetEffects(itemId, effects);
}

export const useInspectorStore = create<InspectorState>()((set, get) => ({
  open: false,
  navOpen: false,
  showAdvanced: false,
  schema: null,
  params: {},
  dirty: new Set(),
  itemId: null,
  assetId: null,
  isSnapshot: false,
  isOwned: true,
  mod: {},
  sound: DEFAULT_SOUND_STATE,
  effects: [],

  openInspector: (schema, saved, itemId, assetId, isSnapshot = false, mod = {}, isOwned = true, sound = DEFAULT_SOUND_STATE, effects = []) => {
    const params = hydrate(schema, saved);
    // normalizeSoundState, not a bare default param: `sound` here is
    // whatever the caller read off the asset row, and `sound` is a JSONB
    // column — a row written before the note rack landed still carries
    // the legacy `key: string` shape with no `notes` array at all. The
    // default param above only covers a caller passing nothing; it does
    // nothing for a caller passing a genuinely malformed value, which is
    // exactly what happens with an unmigrated row. Without this,
    // SoundPanel reads sound.notes as undefined and NoteRack throws on
    // `.length` the instant the panel opens — getPool().setSoundState()
    // below was already safe (it normalizes internally), which is why
    // the audio engine itself played fine even while this crashed; only
    // the store's own copy, what the panel actually renders from, was
    // still raw.
    const normalizedSound = normalizeSoundState(sound);
    set({ open: true, schema, params, dirty: new Set(), itemId, assetId, isSnapshot, isOwned, mod, sound: normalizedSound, effects });
    getPool().get(itemId)?.setParams(params);
    getPool().setBaseParams(itemId, params);
    getPool().setModState(itemId, mod);
    getPool().setSoundState(itemId, normalizedSound);
    getPool().setEffects(itemId, effects);
  },

  setModulation: (controlId, mod) => {
    const { mod: current, itemId, assetId, isSnapshot, isOwned } = get();
    const next: ModState = { ...current };

    if (mod) next[controlId] = mod;
    else delete next[controlId];

    set({ mod: next });

    if (!itemId || !assetId) return;
    getPool().setModState(itemId, next);
    persistMod(itemId, assetId, next, isSnapshot || !isOwned);
    useBoardStore.getState().updateAssetMod(itemId, next);
  },

  setSoundState: (sound) => {
    const { itemId, assetId, isSnapshot, isOwned } = get();
    const normalized = normalizeSoundState(sound);
    set({ sound: normalized });

    if (!itemId || !assetId) return;
    getPool().setSoundState(itemId, normalized);
    persistSound(itemId, assetId, normalized, isSnapshot || !isOwned);
    useBoardStore.getState().updateAssetSound(itemId, normalized);
  },

  /** Chain cap enforced here, not just in the UI — see
      MAX_EFFECTS_PER_CHAIN's doc in lib/effects/types.ts. A no-op past the
      cap rather than silently dropping the oldest entry: the rack's
      "+ Add Effect" affordance disables itself at the cap, so reaching
      this branch at all means something bypassed that (a stale UI state,
      a direct store call) — failing closed is safer than guessing which
      entry the person would have wanted evicted. */
  addEffect: (effectType) => {
    const { effects, itemId, assetId, isSnapshot, isOwned } = get();
    if (!itemId || !assetId || effects.length >= MAX_EFFECTS_PER_CHAIN) return;

    const instance = createEffectInstance(effectType, defaultEffectParams(effectType));
    const next = [...effects, instance];
    set({ effects: next });
    applyEffects(itemId, assetId, isSnapshot, isOwned, next);
  },

  removeEffect: (instanceId) => {
    const { effects, itemId, assetId, isSnapshot, isOwned } = get();
    if (!itemId || !assetId) return;

    const next = effects.filter((e) => e.id !== instanceId);
    set({ effects: next });
    applyEffects(itemId, assetId, isSnapshot, isOwned, next);
  },

  /** Instance identity (EffectInstance.id) travels with the object through
      the splice — nothing here touches `id`, only array position — which
      is what makes a modulation routing survive a reorder for free (see
      IMPLEMENTATION_PLAN.md §7 Phase 4.96's "instance-stable modulation
      targeting" decision: the routing lives ON the instance, in its own
      `mod` field, not in a table keyed by position). */
  reorderEffects: (fromIndex, toIndex) => {
    const { effects, itemId, assetId, isSnapshot, isOwned } = get();
    if (!itemId || !assetId || fromIndex === toIndex) return;
    if (fromIndex < 0 || fromIndex >= effects.length || toIndex < 0 || toIndex >= effects.length) return;

    const next = [...effects];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    set({ effects: next });
    applyEffects(itemId, assetId, isSnapshot, isOwned, next);
  },

  setEffectEnabled: (instanceId, enabled) => {
    const { effects, itemId, assetId, isSnapshot, isOwned } = get();
    if (!itemId || !assetId) return;

    const next = effects.map((e) => (e.id === instanceId ? { ...e, enabled } : e));
    set({ effects: next });
    applyEffects(itemId, assetId, isSnapshot, isOwned, next);
  },

  setEffectMix: (instanceId, mix) => {
    const { effects, itemId, assetId, isSnapshot, isOwned } = get();
    if (!itemId || !assetId) return;

    const clamped = Math.max(0, Math.min(1, mix));
    const next = effects.map((e) => (e.id === instanceId ? { ...e, mix: clamped } : e));
    set({ effects: next });
    applyEffects(itemId, assetId, isSnapshot, isOwned, next);
  },

  setEffectParam: (instanceId, paramId, value) => {
    const { effects, itemId, assetId, isSnapshot, isOwned } = get();
    if (!itemId || !assetId) return;

    const instance = effects.find((e) => e.id === instanceId);
    if (!instance) return;

    // Same coerce()-against-the-real-control discipline setParam uses for
    // asset params, not a raw pass-through — an effect param is a real
    // Control (min/max/kind) exactly like any other, via getEffectSchema.
    const control = getEffectSchema(instance.effectType)?.controls.find((c) => c.id === paramId);
    const coerced = control ? coerce(control, value) : value;
    const next = effects.map((e) =>
      e.id === instanceId ? { ...e, params: { ...e.params, [paramId]: coerced } } : e,
    );
    set({ effects: next });
    applyEffects(itemId, assetId, isSnapshot, isOwned, next);
  },

  setEffectModulation: (instanceId, paramId, mod) => {
    const { effects, itemId, assetId, isSnapshot, isOwned } = get();
    if (!itemId || !assetId) return;

    const next = effects.map((e) => {
      if (e.id !== instanceId) return e;
      const nextMod: ModState = { ...e.mod };
      if (mod) nextMod[paramId] = mod;
      else delete nextMod[paramId];
      return { ...e, mod: nextMod };
    });
    set({ effects: next });
    applyEffects(itemId, assetId, isSnapshot, isOwned, next);
  },

  closeInspector: () => {
    // Flush before closing: a change made just before hitting X would
    // otherwise be lost inside the debounce window.
    const { itemId, assetId, isSnapshot, isOwned } = get();
    if (itemId && assetId) flush(itemId, assetId, isSnapshot || !isOwned);
    set({ open: false });
  },

  toggleNav: () => set((s) => ({ navOpen: !s.navOpen })),
  setNavOpen: (navOpen) => set({ navOpen }),
  toggleAdvanced: () => set((s) => ({ showAdvanced: !s.showAdvanced })),

  setParam: (id, value) => {
    const { schema, params, dirty, itemId, assetId, isSnapshot, isOwned } = get();
    const control = schema?.controls.find((c) => c.id === id);
    if (!control) return;

    const next = coerce(control, value, params);
    const nextDirty = new Set(dirty);
    nextDirty.add(id);
    const nextParams = { ...params, [id]: next };

    // Cascading reclamp: this edit can change ANOTHER control's true max
    // via that control's own maxIf (e.g. Waveform Layers capping lower
    // once Render Style becomes Radial) — walk every control with a
    // maxIf and re-clamp its stored value against the new effective max
    // right now, in the same update, rather than waiting for the person
    // to touch that control directly. Without this, the displayed value
    // (7) could sit there being a flat-out lie about what's actually
    // rendering (3) until something else happened to touch it.
    // Excludes `id` itself — its own coerce() call above already
    // clamped it against whatever its max is post-edit.
    const clampedIds: string[] = [];
    if (schema) {
      for (const sibling of schema.controls) {
        if (sibling.id === id || !sibling.maxIf) continue;
        const cap = effectiveMax(sibling, nextParams);
        const curVal = nextParams[sibling.id];
        if (cap !== undefined && typeof curVal === 'number' && curVal > cap) {
          nextParams[sibling.id] = cap;
          nextDirty.add(sibling.id);
          clampedIds.push(sibling.id);
        }
      }
    }

    set({ params: nextParams, dirty: nextDirty });

    if (!itemId || !assetId) return;
    const renderer = getPool().get(itemId);
    if (control.kind === 'trigger') {
      renderer?.emit(control.event);
      // Triggers are fire-and-forget, never persisted (see pool.ts's
      // own doc on the same distinction) — and can't produce a
      // clampedIds entry themselves (a trigger's coerced value is
      // always null, never a number a maxIf comparison would match),
      // so there's nothing from the cascade above worth persisting
      // here either. Matches the original early-return shape exactly.
      return;
    }
    renderer?.setParam(id, next);
    // Keep the pool's baseParams in lockstep with every edit, not just
    // resetParam's — setModState() restores any *non*-modulated control
    // back to entry.baseParams whenever modulation is assigned/changed
    // on ANY control on this asset (so an LFO-driven value doesn't
    // freeze wherever it last landed). Without this, a plain edit here
    // renders correctly in the moment but leaves baseParams stale at
    // whatever it was hydrated as — invisible until the next modulation
    // change silently force-restores the OLD value straight into the
    // live renderer, even though the inspector (reading its own params
    // state, untouched by any of this) still shows the edit as active.
    // Confirmed exactly this way: HUD mode showing "Alpha" in the
    // dropdown while the tile silently rendered Radial again the
    // instant modulation was routed to an unrelated control.
    getPool().setBaseParam(itemId, id, next);
    // Any sibling(s) reclamped above need the exact same treatment —
    // pushed to the live renderer and kept in baseParams lockstep — or
    // the cascading fix above only ever touches the inspector's own
    // display, leaving the actual live render still showing the old,
    // uncapped value.
    for (const clampedId of clampedIds) {
      renderer?.setParam(clampedId, nextParams[clampedId]);
      getPool().setBaseParam(itemId, clampedId, nextParams[clampedId]);
    }
    persist(itemId, assetId, isSnapshot || !isOwned, nextParams);
  },

  resetParam: (id) => {
    const { schema, params, dirty, itemId, assetId, isSnapshot, isOwned } = get();
    const control = schema?.controls.find((c) => c.id === id);
    if (!control || control.kind === 'trigger') return;

    const nextDirty = new Set(dirty);
    nextDirty.delete(id);
    const nextParams = { ...params, [id]: control.default };
    set({ params: nextParams, dirty: nextDirty });

    if (!itemId || !assetId) return;
    getPool().get(itemId)?.setParam(id, control.default);
    getPool().setBaseParam(itemId, id, control.default);
    persist(itemId, assetId, isSnapshot || !isOwned, nextParams);
  },

  resetAll: () => {
    const { schema, itemId, assetId, isSnapshot, isOwned } = get();
    if (!schema) return;
    const params = defaultsOf(schema);
    set({ params, dirty: new Set() });

    if (!itemId || !assetId) return;
    getPool().get(itemId)?.setParams(params);
    getPool().setBaseParams(itemId, params);
    persist(itemId, assetId, isSnapshot || !isOwned, params);
  },
}));
