import type { Asset, CardState } from '@/types/asset';
import type { AssetRenderer, RenderContext } from '@/renderers/types';
import { createRenderer } from '@/renderers/registry';
import { installSoakStats } from '@/lib/debug/soak-stats';
import { peekGLStage } from '@/lib/gl/context-pool';
import { getModBus } from '@/lib/modulation/bus';
import { applyModulation, defaultsOf, type ModState, type ParamState, type SoundState } from '@/renderers/control-schema';
import { MAX_LIVE_RENDERERS } from '@/stores/playbackStore';
import { normalizeSoundState } from '@/lib/sound/types';
import { startTileAudio, stopTileAudio, stopAllTileAudio, updateTileAudio, isTileAudioActive, retriggerTileAudio } from '@/lib/sound/engine';
import { unloadTrack, getTrackFrequencyData } from '@/lib/sound/track';
import { disableMic, getMicFrequencyData, isMicEnabled } from '@/lib/sound/mic';
import { STALL_RESUME_THRESHOLD_MS } from '@/lib/sandbox/protocol';
import type { EffectInstance } from '@/lib/effects/types';
import { getEffectSchema } from '@/lib/effects/registry';
import { getGLStage } from '@/lib/gl/context-pool';
import { compositeEffects, resetEffectHistory, disposeEffectsFor, loadEffectShaderIfNeeded } from '@/lib/gl/effects-compositor';

/**
 * The renderer pool.
 *
 * Two invariants, both load-bearing:
 *
 *  1. ONE requestAnimationFrame drives every live renderer. Forty cards each
 *     scheduling their own frame is how a board becomes unusable.
 *  2. At most MAX_LIVE_RENDERERS are mounted at once. Promoting past the
 *     ceiling evicts the least-recently-promoted preview card. A focused card
 *     is never evicted — you are looking at it.
 *
 * Location: lib/render/pool.ts
 */

interface Entry {
  /** Pool key. This is the board card's itemId, NOT the shader/sketch id —
      two snapshots of the same shader are two entries, each with its own
      live renderer, because they are two different cards. */
  cardId: string;
  asset: Asset;
  renderer: AssetRenderer;
  host: HTMLElement;
  state: CardState;
  controller: AbortController;
  startedAt: number;
  lastTime: number;
  frame: number;
  promotedAt: number;
  mounted: boolean;
  /** Mount/render failure recorded by the pool. The renderer's own `error`
      covers compile and load failures; this covers everything thrown at us. */
  failure: string | null;
  /** Unmodulated values. Modulation is applied on top each frame, never
      written back — otherwise an LFO would permanently drag the saved
      parameter along with it. */
  baseParams: ParamState;
  modState: ModState;
  /** Audio-out counterpart to modState — see lib/sound/. Lifecycle is tied
      to `state === 'focused'`, synced via the pool's syncAudio() helper
      rather than left to callers to manage by hand. */
  soundState: SoundState;
  /**
   * Phase 4.96 — the tile's VFX chain. Unmodulated base values, same
   * "never write back" rule as baseParams above — modulation is resolved
   * fresh into an ephemeral copy each frame (see resolveEffectsForFrame),
   * never mutated in place here, for the identical reason baseParams
   * isn't: closing and reopening the inspector must show wherever the
   * chain was actually left, not wherever an LFO happened to leave it.
   */
  effects: EffectInstance[];
  /**
   * Cached box size, updated by `resizeObserver` on layout change rather
   * than read via `host.getBoundingClientRect()` on every single tick()
   * frame for every live entry. getBoundingClientRect() forces a
   * synchronous layout — cheap in isolation with the pool's small live
   * ceiling, but avoidable, and free to avoid: ResizeObserver already
   * batches and only fires on an actual size change.
   */
  size: { width: number; height: number };
  resizeObserver: ResizeObserver;
}

export interface PoolFrameInfo {
  fps: number;
  live: number;
}

type Listener = (cardId: string, state: CardState, error: string | null) => void;

class RendererPool {
  private entries = new Map<string, Entry>();
  private rafId: number | null = null;
  private listeners = new Set<Listener>();

  private paused = false;
  private globalSpeed = 1;
  private pointer = { x: 0.5, y: 0.5, down: false };

  /** assetId -> poster URL, kept current by the board. */
  private textureSources: Record<string, string> = {};
  private audio: Float32Array | null = null;

  private lastFrameAt = 0;
  private fpsFrames = 0;
  private fpsAt = 0;
  fps = 0;

  /** Card ids that have already logged a getTrackFrequencyData() failure
      — see safeGetTrackFrequencyData()'s doc. Keeps a stuck failure from
      flooding the console at 60fps while still surfacing it once. */
  private trackAudioWarned = new Set<string>();

  /** `${cardId}:${kind}` keys that have already logged a per-frame fault —
      see warnOnce(). Cleared per card in demote() so the set can't grow for
      the life of the tab and a re-promoted card can warn afresh. */
  private faultWarned = new Set<string>();

  /* ---------------------------------------------------------------- *
   * Public control
   * ---------------------------------------------------------------- */

  setPaused(paused: boolean): void {
    this.paused = paused;
    for (const e of this.entries.values()) {
      paused ? e.renderer.pause() : e.renderer.play();
    }
    paused ? this.stopLoop() : this.startLoop();
  }

  setGlobalSpeed(speed: number): void {
    this.globalSpeed = speed;
  }

  /**
   * Publish the id -> poster URL map that texture controls resolve against.
   * Live renderers are updated in place so linking a source takes effect on
   * the next frame rather than requiring a remount.
   */
  setTextureSources(sources: Record<string, string>): void {
    this.textureSources = sources;
    for (const entry of this.entries.values()) {
      if ('textureSources' in entry.renderer) {
        (entry.renderer as { textureSources: Record<string, string> }).textureSources = sources;
      }
    }
  }

  setPointer(x: number, y: number, down: boolean): void {
    this.pointer = { x, y, down };
    // Pointer is also a modulation source, so the bus needs it too.
    getModBus().setPointer(x, y);
  }

  setAudio(data: Float32Array | null): void {
    this.audio = data;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify(assetId: string, state: CardState, error: string | null): void {
    for (const fn of this.listeners) fn(assetId, state, error);
  }

  /* ---------------------------------------------------------------- *
   * Promotion / eviction
   * ---------------------------------------------------------------- */

  async promote(asset: Asset, host: HTMLElement, state: Exclude<CardState, 'poster'>): Promise<void> {
    const cardId = asset.itemId;
    const existing = this.entries.get(cardId);

    if (existing && existing.host === host) {
      existing.state = state;
      existing.promotedAt = performance.now();
      existing.renderer.setQuality(state === 'focused' ? 'full' : 'preview');
      this.enforceBudget(cardId);
      this.syncAudio(existing);
      return;
    }

    if (existing && existing.host !== host) {
      // Same asset, different element — e.g. the grid card is already live
      // and the focused overlay just asked for the same asset. The old
      // promote() silently kept rendering into the original host here,
      // which is why the enlarged view showed nothing: the renderer never
      // moved. Tear down and remount into the new host instead.
      existing.resizeObserver.disconnect();
      existing.controller.abort();
      existing.renderer.dispose();
      this.entries.delete(cardId);
      this.notify(cardId, 'poster', null);
    }

    this.enforceBudget(cardId);

    const controller = new AbortController();
    // The renderer is created from the real shader/sketch id — that decides
    // what compiles and what its internal caches key off. The pool tracks it
    // under cardId; the renderer never needs to know the difference.
    // A snapshot renders its own captured frame, exactly like an uploaded
    // image — never the live shader or sketch. It used to mount the real
    // ShaderRenderer/P5Renderer with the saved params, which meant a whole
    // second live-rendering pipeline (and everything that can go wrong in
    // it) sat behind something meant to be a settled, permanent look. This
    // is what "just a regular snapshot image" should have been from the
    // start.
    const renderer = createRenderer(asset.isSnapshot ? 'image' : asset.type, asset.id);

    // Texture controls store an asset id; the renderer needs poster URLs to
    // resolve them. Injected here rather than having the renderer reach into
    // the board store, which would couple the rendering layer to app state.
    if ('textureSources' in renderer) {
      (renderer as { textureSources: Record<string, string> }).textureSources =
        this.textureSources;
    }
    const now = performance.now();

    // Declared before the Entry it belongs to since the callback closes
    // over `entry` — safe because ResizeObserver's first callback fires
    // asynchronously, well after `entry` below is assigned.
    let entry!: Entry;
    const resizeObserver = new ResizeObserver((observed) => {
      const box = observed[0]?.contentRect;
      if (box) entry.size = { width: box.width, height: box.height };
    });
    resizeObserver.observe(host);

    entry = {
      cardId,
      asset,
      renderer,
      host,
      state,
      controller,
      startedAt: now,
      lastTime: 0,
      frame: 0,
      promotedAt: now,
      mounted: false,
      failure: null,
      // Modulation diagnostic (2026-09) — the actual root cause behind
      // "Morph Speed doesn't seem to be modulating" on Turbulent Flow,
      // and a systemic gap, not a tile-specific one:
      //
      // Every renderer's OWN internal params correctly hydrate against
      // schema defaults before falling back to the saved value — see
      // shader.renderer.ts/p5.renderer.ts/media.renderer.ts's identical
      // `{ ...defaultsOf(this.schema), ...(asset.params ?? {}) }` line in
      // each of their mount()s. This baseParams copy — a SEPARATE object,
      // used specifically as the "value to offset from" by
      // applyModulation() below and sampleModulated() further down — was
      // built from `asset.params` ALONE, with no equivalent merge. Any
      // control added (or newly given a default) to a schema AFTER an
      // asset's params were last saved has no key in the stored
      // `asset.params` at all, so `entry.baseParams[controlId]` reads as
      // `undefined` — and applyModulation()'s own `if (base === undefined)
      // continue` (a few lines down) then silently, permanently skips
      // that one routing, while every other control on the same tile
      // continues to modulate normally, since THEIR keys do exist in the
      // saved params. Exactly the "modulation works across the board,
      // just not for this one control" signature.
      //
      // `setBaseParams()` (called whenever the Inspector opens and hands
      // over its own already-hydrated ParamState) papers over this for
      // the rest of a session once it fires — which is why this doesn't
      // reproduce on every tile, every time, only ones whose modulation
      // is observed before the base Inspector panel has been opened in
      // that session. `asset.schema` is already synchronously available
      // here (cached at ingest — see the Asset type's own doc), so there
      // is no need to wait for renderer.mount(); this can hydrate exactly
      // the same way every renderer already does for itself.
      baseParams: asset.schema
        ? { ...defaultsOf(asset.schema), ...(asset.params ?? {}) }
        : { ...(asset.params ?? {}) },
      modState: { ...(asset.mod ?? {}) },
      // normalizeSoundState rather than a bare spread: `sound` is a JSONB
      // column, so a row written before the note rack landed still has
      // `key: string` and no `notes` array at all. Spreading that
      // straight through handed an engine `notes: undefined`, which threw
      // the moment anything mapped over it. See that function's comment.
      soundState: normalizeSoundState(asset.sound),
      effects: [...(asset.effects ?? [])],
      // Zeroed until the observer's first callback lands — tick() already
      // skips a zero-size entry exactly as it did with a fresh
      // getBoundingClientRect() before layout settles, so this isn't a
      // behavior change, just a different source for the same check.
      size: { width: 0, height: 0 },
      resizeObserver,
    };

    // Keyed by cardId, matching every read/delete elsewhere in this class
    // (.get/.has/.delete all use cardId). This used to be keyed by asset.id
    // instead — invisible for as long as canonical board items had
    // itemId === assetId (the old id scheme), since the two keys happened
    // to be identical strings. Once board items became correctly scoped
    // per-board (itemId = `${boardId}:${assetId}`, needed so the same
    // shared library asset can have a canonical item on more than one
    // board), that accidental equality broke, and the mismatch surfaced as
    // every render silently disposing itself right after mount — see the
    // eviction check a few lines down, which was always finding "no entry"
    // for the correct key and tearing the renderer down before a single
    // frame ever drew.
    this.entries.set(cardId, entry);
    renderer.setQuality(state === 'focused' ? 'full' : 'preview');

    // Fire-and-forget: compositeEffects() silently skips a pass until its
    // source has resolved (see loadEffectShaderIfNeeded's doc) — same
    // "renders without it for a few frames" tolerance texture-source.ts's
    // getTextureImage already relies on for texture controls.
    for (const instance of entry.effects) void loadEffectShaderIfNeeded(instance.effectType);

    try {
      await renderer.mount(host, asset, controller.signal);
    } catch (err) {
      entry.failure = err instanceof Error ? err.message : String(err);
    }

    // Evicted mid-mount — a constant occurrence during fast scrolling.
    if (controller.signal.aborted || !this.entries.has(cardId)) {
      renderer.dispose();
      return;
    }

    entry.mounted = true;
    if (this.paused) renderer.pause();
    this.syncAudio(entry);

    this.notify(cardId, state, entry.failure ?? renderer.error);
    this.startLoop();
  }

  /**
   * Release a card's renderer.
   *
   * `owner` is the host element the caller believes it mounted into. When
   * supplied, the demote is IGNORED unless it matches the entry's actual
   * host.
   *
   * This guard is load-bearing, not defensive noise. A grid card and the
   * focused overlay render the same itemId, so both mount a RendererStage
   * for it. Opening an asset freezes the board, which made the grid card
   * demote "its" renderer — except the pool entry at that key now belonged
   * to the focused overlay, so the enlarged view went black instantly.
   * Ownership makes that impossible by construction rather than relying on
   * the two stages coordinating.
   */
  /** Read-only counters for the soak test and its `?soak=1` hook (lib/debug/soak-stats.ts). */
  stats(): { live: number; focused: number; preview: number; cap: number } {
    let focused = 0;
    for (const e of this.entries.values()) if (e.state === 'focused') focused++;
    return { live: this.entries.size, focused, preview: this.entries.size - focused, cap: MAX_LIVE_RENDERERS };
  }

  demote(cardId: string, owner?: HTMLElement): void {
    const entry = this.entries.get(cardId);
    if (!entry) return;
    if (owner && entry.host !== owner) return;

    // The modulation bus keeps a smoothing-history entry per routed control,
    // keyed by cardId:controlId. setModState() already cleans these up when
    // a routing is explicitly removed, but that left the far more common
    // case uncovered: the card itself goes away — scrolled off, budget-
    // evicted, the snapshot deleted — while its routings are still active.
    // Nothing was ever telling the bus that card no longer exists, so every
    // modulated card anyone ever viewed left a permanent, unreachable entry
    // behind. Over a long session this grows without bound.
    for (const controlId of Object.keys(entry.modState)) {
      getModBus().forget(`${cardId}:${controlId}`);
    }
    stopTileAudio(cardId);
    // Session-only by design (see lib/sound/track.ts's file doc) — a
    // decoded buffer and a running source node have no reason to survive
    // past the card that owns them, same reasoning as stopTileAudio just
    // above for the synth engine.
    unloadTrack(cardId);
    // Releases this card's claim on the shared mic stream (Phase 4.9.2)
    // — see lib/sound/mic.ts's ref-counting doc. A card scrolled off or
    // evicted under budget that never explicitly turned Mic off would
    // otherwise hold that ref forever, keeping the shared stream (and the
    // browser's mic-in-use indicator) alive with nothing left actually
    // reading it.
    disableMic(cardId);
    // Phase 4.96 — drops this card's relay canvases (and the modulation
    // bus's own smoothing entries for every routed effect param, via the
    // same forget() loop pattern as entry.modState just above). Without
    // this, a removed card's relay canvases leak for the tab's lifetime —
    // same class of bug the modState cleanup above already exists to
    // prevent for asset-level modulation.
    for (const instance of entry.effects) {
      for (const controlId of Object.keys(instance.mod)) {
        getModBus().forget(`${cardId}:fx:${instance.id}:${controlId}`);
      }
    }
    disposeEffectsFor(cardId);

    entry.resizeObserver.disconnect();
    entry.controller.abort();
    entry.renderer.dispose();
    this.clearWarnings(cardId);
    this.entries.delete(cardId);

    this.notify(cardId, 'poster', null);
    if (this.entries.size === 0) this.stopLoop();
  }

  /**
   * Keeps the live set within budget. Focused cards are protected; among
   * previews, the oldest promotion goes first.
   */
  private enforceBudget(incomingId: string): void {
    const candidates = [...this.entries.values()]
      .filter((e) => e.cardId !== incomingId && e.state !== 'focused')
      .sort((a, b) => a.promotedAt - b.promotedAt);

    let over = this.entries.size + (this.entries.has(incomingId) ? 0 : 1) - MAX_LIVE_RENDERERS;

    for (const victim of candidates) {
      if (over <= 0) break;
      this.demote(victim.cardId);
      over--;
    }
  }

  get(cardId: string): AssetRenderer | null {
    return this.entries.get(cardId)?.renderer ?? null;
  }

  /** The inspector owns the unmodulated truth; the pool layers motion on it. */
  setBaseParams(cardId: string, params: ParamState): void {
    resetEffectHistory(cardId);
    const entry = this.entries.get(cardId);
    if (entry) entry.baseParams = { ...params };
  }

  setBaseParam(cardId: string, id: string, value: ParamState[string]): void {
    resetEffectHistory(cardId);
    const entry = this.entries.get(cardId);
    if (entry) entry.baseParams[id] = value;
  }

  setModState(cardId: string, mod: ModState): void {
    const entry = this.entries.get(cardId);
    if (!entry) return;

    // Drop smoothing history for routings that no longer exist, so
    // reassigning a source doesn't inherit the previous one's momentum.
    for (const key of Object.keys(entry.modState)) {
      if (!mod[key]) getModBus().forget(`${cardId}:${key}`);
    }
    entry.modState = { ...mod };

    // Restore anything that was being modulated back to its base value —
    // otherwise a parameter freezes wherever the LFO happened to leave it.
    const schema = entry.renderer.getControlSchema();
    if (!schema) return;
    for (const control of schema.controls) {
      if (mod[control.id]) continue;
      const base = entry.baseParams[control.id];
      if (base !== undefined) entry.renderer.setParam(control.id, base);
    }
  }

  /** The Sound toggle/preset/key/octave/volume controls (Stage 2) call
      this. Mirrors setModState — the pool owns the live entry, so this is
      where a change actually takes effect, not just where it's stored. */
  setSoundState(cardId: string, sound: SoundState): void {
    const entry = this.entries.get(cardId);
    if (!entry) return;
    entry.soundState = normalizeSoundState(sound);
    this.syncAudio(entry);
  }

  /**
   * Phase 4.96 — the VFX rack calls this on every chain edit (add/remove/
   * reorder/param change), mirroring setSoundState's "the pool owns the
   * live entry, so this is where a change actually takes effect" pattern.
   *
   * Cleans up stale modulation-bus smoothing state for any (instanceId,
   * paramId) routing that no longer exists — same reasoning as
   * setModState's own cleanup loop, just walking a nested structure
   * (per-instance ModState) instead of a flat one. An instance removed
   * entirely takes its whole `mod` object with it automatically (nothing
   * in `next` references that instanceId at all), so this only needs to
   * diff what's still present on both sides, not separately handle
   * "instance removed" as its own case.
   */
  setEffects(cardId: string, effects: EffectInstance[]): void {
    const entry = this.entries.get(cardId);
    if (!entry) return;

    // A bypass, reorder, or replacement starts a new feedback timeline.
    const chainKey = (chain: EffectInstance[]) => chain
      .filter((effect) => effect.enabled && effect.mix > 0)
      .map((effect) => `${effect.id}:${effect.effectType}`).join('|');
    if (chainKey(entry.effects) !== chainKey(effects)) resetEffectHistory(cardId);
    if (!effects.some((effect) => effect.enabled && effect.mix > 0)) disposeEffectsFor(cardId);

    const bus = getModBus();
    for (const prev of entry.effects) {
      const next = effects.find((e) => e.id === prev.id);
      for (const controlId of Object.keys(prev.mod)) {
        if (!next?.mod[controlId]) bus.forget(`${cardId}:fx:${prev.id}:${controlId}`);
      }
    }

    entry.effects = effects.map((e) => ({ ...e, params: { ...e.params }, mod: { ...e.mod } }));

    for (const instance of entry.effects) void loadEffectShaderIfNeeded(instance.effectType);
  }

  /** The Retrigger control (Stage 2) calls this directly — it's a
      fire-and-forget action, not persisted state, same spirit as a
      renderer's own trigger controls. */
  retriggerSound(cardId: string): void {
    retriggerTileAudio(cardId);
  }

  /** Starts or stops a card's audio subgraph to match `state === 'focused'`
      and soundState.enabled — the single place that decision gets made, so
      every call site (promotion, a state change, a Sound-toggle edit) stays
      in sync with each other by construction rather than by discipline. */
  private syncAudio(entry: Entry): void {
    if (entry.state === 'focused' && entry.soundState.enabled) {
      startTileAudio(entry.cardId, entry.soundState);
    } else {
      stopTileAudio(entry.cardId);
    }
  }

  /** Current modulated value, for the live readout in the inspector. */
  sampleModulated(cardId: string, controlId: string): number | null {
    const entry = this.entries.get(cardId);
    if (!entry) return null;

    const mod = entry.modState[controlId];
    if (!mod) return null;

    const schema = entry.renderer.getControlSchema();
    const control = schema?.controls.find((c) => c.id === controlId);
    if (!control) return null;

    const base = entry.baseParams[controlId];
    if (typeof base !== 'number') return null;

    const signal = getModBus().sample(`${cardId}:${controlId}`, mod, cardId);
    const next = applyModulation(control, base, mod, signal);
    return typeof next === 'number' ? next : null;
  }

  get liveCount(): number {
    return this.entries.size;
  }

  disposeAll(): void {
    for (const id of [...this.entries.keys()]) this.demote(id);
    stopAllTileAudio();
    this.stopLoop();
  }

  /* ---------------------------------------------------------------- *
   * The single frame loop
   * ---------------------------------------------------------------- */

  /**
   * Push modulated values into the renderer for this frame.
   *
   * Reads from baseParams and writes only to the renderer — the stored
   * parameter is never overwritten. That separation is what lets you close
   * an asset mid-oscillation and reopen it exactly where you left it, rather
   * than wherever the LFO happened to be.
   *
   * Returns the same numeric modulated values it just pushed into the
   * renderer, keyed by controlId — updateAudioBindings reuses this rather
   * than resampling the bus a second time, which matters for a source
   * like lfo.noise where sampling twice in the same frame would read two
   * different values off the same phase. `null` when nothing on this
   * asset is currently routed, the common case, so callers can skip
   * building a merged param object for the (much more common) card with
   * no modulation active at all.
   */
  private applyModulation(entry: Entry): Record<string, number> | null {
    const routings = Object.keys(entry.modState);
    if (routings.length === 0) return null;

    const schema = entry.renderer.getControlSchema();
    if (!schema) return null;

    const bus = getModBus();
    const modulated: Record<string, number> = {};

    for (const controlId of routings) {
      const mod = entry.modState[controlId];
      const control = schema.controls.find((c) => c.id === controlId);
      if (!mod || !control) continue;

      const base = entry.baseParams[controlId];
      if (base === undefined) continue;

      const signal = bus.sample(`${entry.cardId}:${controlId}`, mod, entry.cardId);
      const next = applyModulation(control, base, mod, signal);
      entry.renderer.setParam(controlId, next);
      // Sound bindings only ever read a numeric (slider/stepper) source —
      // see normalizeControlValue in lib/sound/engine.ts — so a
      // non-numeric result (color, select, etc. modulated some other way)
      // simply isn't offered to updateAudioBindings below.
      if (typeof next === 'number') modulated[controlId] = next;
    }

    return modulated;
  }

  /**
   * Phase 4.96 — the effects-chain counterpart to applyModulation above,
   * same shape deliberately: reads entry.effects (the unmodulated truth,
   * mirroring baseParams), samples the SAME shared modulation bus every
   * other routing in the app reads, and returns a fresh ephemeral array
   * rather than mutating entry.effects in place — for the identical
   * "don't let an LFO permanently drag the saved value" reason
   * applyModulation's own doc gives.
   *
   * Deliberately NOT folded into applyModulation itself: that function
   * resolves against `entry.renderer.getControlSchema()`, the ASSET's own
   * schema — effect params aren't part of it and were never meant to be
   * (see IMPLEMENTATION_PLAN.md §7 Phase 4.96's "one modulation system,
   * not two" decision — the SOURCE of truth stays the same shared bus,
   * this is a second call site reading it, not a second system). Returns
   * entry.effects unchanged (by reference) when nothing is enabled or
   * nothing on the chain is routed, so the common case allocates nothing.
   */
  private resolveEffectsForFrame(entry: Entry): EffectInstance[] {
    if (entry.effects.length === 0) return entry.effects;

    const bus = getModBus();
    let changed = false;

    const resolved = entry.effects.map((instance) => {
      const routedIds = Object.keys(instance.mod);
      if (!instance.enabled || routedIds.length === 0) return instance;

      const schema = getEffectSchema(instance.effectType);
      if (!schema) return instance;

      changed = true;
      const nextParams = { ...instance.params };
      let nextMix = instance.mix;

      for (const controlId of routedIds) {
        const mod = instance.mod[controlId];
        const control = schema.controls.find((c) => c.id === controlId);
        if (!mod || !control) continue;

        const base = controlId === 'mix' ? instance.mix : (nextParams[controlId] ?? control.default);
        if (typeof base !== 'number') continue;

        const signal = bus.sample(`${entry.cardId}:fx:${instance.id}:${controlId}`, mod, entry.cardId);
        const next = applyModulation(control, base, mod, signal);
        if (typeof next !== 'number') continue;

        if (controlId === 'mix') nextMix = next;
        else nextParams[controlId] = next;
      }

      return { ...instance, mix: nextMix, params: nextParams };
    });

    return changed ? resolved : entry.effects;
  }

  /** Pushes this frame's live param values into the active sound engine,
      if this card is focused, sound-enabled, and actually has an engine
      running.

      Reads the SAME modulated values applyModulation just computed for
      the renderer, layered over baseParams — a control that's both
      sound-bound (via the preset's own SoundBinding) and modulation-
      routed (via the Modulation panel) now drives the engine in lockstep
      with whatever's on screen that frame, rather than the audio staying
      pinned to wherever the slider was last left. A control with no
      modulation routing falls through to its baseParams value exactly as
      before — this only changes behavior for the intersection of "sound-
      bound" and "modulated", which was previously silently inert. */
  private updateAudioBindings(entry: Entry, modulated: Record<string, number> | null): void {
    if (entry.state !== 'focused' || !entry.soundState.enabled) return;
    if (!isTileAudioActive(entry.cardId)) return;

    const schema = entry.renderer.getControlSchema();
    if (!schema) return;

    const effective = modulated ? { ...entry.baseParams, ...modulated } : entry.baseParams;
    updateTileAudio(entry.cardId, schema, effective);
  }

  /**
   * Log a per-frame fault once per (card, kind), not 60 times a second.
   *
   * tick() is one loop serving every live card, so any work in it that can
   * throw has to be contained to the ONE card it belongs to. The rAF is
   * re-armed on the first line of tick(), so an uncaught throw never killed
   * the loop itself — but it aborted the `for` over entries at that card, so
   * every card AFTER it in Map order was skipped for that frame, every
   * frame, for as long as the fault lasted. Modulation, audio-binding and
   * audio-source lookups sat outside the per-card try/catch until now.
   */
  private warnOnce(cardId: string, kind: string, err: unknown): void {
    const key = `${cardId}:${kind}`;
    if (this.faultWarned.has(key)) return;
    this.faultWarned.add(key);
    console.error(`[render-pool] ${kind} failed for ${cardId} — continuing without it:`, err);
  }

  private clearWarnings(cardId: string): void {
    this.trackAudioWarned.delete(cardId);
    const prefix = `${cardId}:`;
    for (const key of this.faultWarned) {
      if (key.startsWith(prefix)) this.faultWarned.delete(key);
    }
  }

  /**
   * The audio feed for this card's frame, or null. Contained: a throw from
   * the mic analyser (or anything else in the chain) must not stop the card
   * rendering, let alone the cards after it.
   *
   * Priority (unchanged): this card's own uploaded track (Phase 4.9) first —
   * see lib/sound/track.ts's file doc for why RenderContext is no longer
   * genuinely board-wide despite the interface's older "shared analyser"
   * comment. Mic (Phase 4.9.2) second: an explicitly loaded track is the more
   * deliberate choice, mic is "react to whatever's happening right now."
   * getMicFrequencyData() alone isn't enough to gate on — it returns real
   * data whenever the SHARED stream is live for ANY card (see
   * lib/sound/mic.ts's top doc), so without the isMicEnabled(cardId) check a
   * card that never turned Mic on would start silently reacting to it the
   * instant some OTHER card did. Last, `this.audio`, the board-wide feed the
   * interface originally described (always null today — nothing calls
   * setAudio() yet), so a card with none of the three behaves exactly as it
   * did before any of this existed.
   */
  private resolveAudio(entry: Entry): Float32Array | null {
    try {
      return (
        this.safeGetTrackFrequencyData(entry.cardId) ??
        (isMicEnabled(entry.cardId) ? getMicFrequencyData() : null) ??
        this.audio
      );
    } catch (err) {
      this.warnOnce(entry.cardId, 'audio-source', err);
      return null;
    }
  }

  /**
   * Defensive wrapper around getTrackFrequencyData() — flagged since rev
   * 10, fixed here per rev 11 (§0/§7 Phase 4.9/§12). track.ts's refresh()
   * calls straight into a live AnalyserNode's getByteFrequencyData(); that
   * node can go momentarily stale during the audio-lifecycle recovery
   * path (context.ts's resetAudioContextForRecovery() racing against this
   * loop's own rAF tick — see track.ts's rewireTrackGraph()), which can
   * throw. Called unwrapped, that throw propagated straight out of tick()'s
   * `for` loop ahead of every entry's own per-card try/catch below — an
   * uncaught throw here on entry N would skip rendering entries N+1..end
   * for that frame, not just fail this one card's audio. §7 Phase 4.97
   * explicitly calls this pattern out as the one to avoid for the new
   * MIDI/gamepad poll loop, so it's worth actually fixing here rather
   * than only documenting.
   *
   * Caught and treated exactly like "no track data this frame" (null),
   * which the existing `?? isMicEnabled(...) ?? this.audio` fallback
   * chain in tick() already handles correctly — the card keeps
   * rendering, just without track-audio modulation for that one frame.
   * Deliberately NOT routed through the render()/demote() catch below:
   * demoting a card over a transient audio-analysis hiccup would kill
   * its visual rendering for a failure that has nothing to do with the
   * renderer itself. Logged once per card, not every frame, so a
   * genuinely stuck failure is still visible without console-spamming
   * at 60fps.
   */
  private safeGetTrackFrequencyData(cardId: string): Float32Array<ArrayBuffer> | null {
    try {
      return getTrackFrequencyData(cardId);
    } catch (err) {
      if (!this.trackAudioWarned.has(cardId)) {
        this.trackAudioWarned.add(cardId);
        console.error(`[render-pool] getTrackFrequencyData failed for ${cardId}, falling back to no track audio:`, err);
      }
      return null;
    }
  }

  private startLoop(): void {
    if (this.rafId !== null || this.paused || this.entries.size === 0) return;
    this.lastFrameAt = performance.now();
    this.rafId = requestAnimationFrame(this.tick);
  }

  private stopLoop(): void {
    if (this.rafId === null) return;
    cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }

  private tick = (now: number): void => {
    this.rafId = requestAnimationFrame(this.tick);

    // Raw, UNclamped gap since the last tick. A single slow frame is
    // normal and dt below already guards against it — but a gap past
    // STALL_RESUME_THRESHOLD_MS can only mean requestAnimationFrame itself
    // was suspended for the whole tab (backgrounded, minimized, laptop
    // sleep, or a native modal like a file picker holding OS focus),
    // since nothing else can stall a single rAF-driven loop that long.
    // That's a whole-loop stall, not any one card hanging — see
    // resumeFromStall's doc on AssetRenderer for the concrete bug this
    // prevents (a healthy p5 sketch's iframe getting torn down the
    // instant the loop resumes, because its own heartbeat was throttled
    // along with everything else and reads as stale the moment anyone
    // checks it again).
    //
    // Deliberately a smaller, separate threshold from HEARTBEAT_TIMEOUT_MS
    // (the per-sandbox teardown check in p5.renderer.ts's render()) — see
    // STALL_RESUME_THRESHOLD_MS's own doc in lib/sandbox/protocol.ts for
    // the race this closes: the pool's own rAF and each iframe's
    // independent heartbeat-sending setInterval can resume from a
    // throttled tab at different rates, so triggering the resume here
    // well before the stricter teardown threshold gives every sandbox's
    // clock a chance to get re-armed first, regardless of exactly how
    // far apart those two recovery rates land on a given browser.
    const rawGapMs = now - this.lastFrameAt;
    const resumedFromStall = rawGapMs > STALL_RESUME_THRESHOLD_MS;

    const dt = Math.min(rawGapMs / 1000, 0.1);
    this.lastFrameAt = now;

    this.fpsFrames++;
    if (now - this.fpsAt > 1000) {
      this.fps = Math.round((this.fpsFrames * 1000) / (now - this.fpsAt));
      this.fpsFrames = 0;
      this.fpsAt = now;
    }

    for (const entry of this.entries.values()) {
      if (!entry.mounted) continue;

      if (resumedFromStall) {
        resetEffectHistory(entry.cardId);
        try {
          entry.renderer.resumeFromStall?.();
        } catch (err) {
          this.warnOnce(entry.cardId, 'resume-from-stall', err);
        }
      }

      // Cached by `entry.resizeObserver`, not a fresh
      // getBoundingClientRect() per entry per frame — see the field's doc
      // on Entry. Same zero-size skip as before.
      const { width, height } = entry.size;
      if (width === 0 || height === 0) continue;

      const scaled = dt * this.globalSpeed;
      entry.frame++;
      // Accumulate scaled time rather than deriving it from wall clock, so a
      // speed change bends the curve from here rather than jumping the whole
      // animation to a new point in its timeline.
      entry.lastTime += scaled;

      const ctx: RenderContext = {
        time: entry.lastTime,
        delta: scaled,
        frame: entry.frame,
        width,
        height,
        pixelRatio: window.devicePixelRatio || 1,
        pointer: this.pointer,
        // Track (Phase 4.9) > mic (Phase 4.9.2) > the board-wide feed — see
        // resolveAudio() for the priority rules and for why the whole chain
        // is contained (each source's own doc explains why it exists).
        audio: this.resolveAudio(entry),
      };

      // Contained per card. A modulation or audio-binding fault costs THIS
      // card its modulation for the frame — it still renders, from its base
      // params — and never reaches the cards after it in the loop. (It is
      // deliberately not routed to demote(): a bad routing is not a dead
      // renderer, and demoting would blank a tile over a config problem.)
      let modulated: Record<string, number> | null = null;
      try {
        modulated = this.applyModulation(entry);
        this.updateAudioBindings(entry, modulated);
      } catch (err) {
        this.warnOnce(entry.cardId, 'modulation', err);
      }

      try {
        entry.renderer.setEffectsActive?.(entry.effects.some((effect) => effect.enabled));
        entry.renderer.render(ctx);
      } catch (err) {
        entry.failure = err instanceof Error ? err.message : String(err);
        this.notify(entry.cardId, entry.state, entry.failure);
        this.demote(entry.cardId);
        continue;
      }

      // Contained separately from render() above: a VFX fault (bad shader,
      // resized-away canvas, GL hiccup) used to fall into the same catch and
      // DEMOTE the card, tearing down a perfectly healthy tile over a
      // post-process problem. Now the tile keeps rendering, un-effected.
      try {
        // Only enter the compositor when a pass can actually be active.
        // Media and sandbox adapters redraw a fresh base before each pass.
        if (entry.effects.some((effect) => effect.enabled && effect.mix > 0)) {
          const surface = entry.renderer.getCanvas?.();
          if (surface instanceof HTMLCanvasElement) {
            const stage = getGLStage();
            if (stage) {
              compositeEffects(stage, surface, {
                source: surface,
                cardId: entry.cardId,
                effects: this.resolveEffectsForFrame(entry),
                width: surface.width,
                height: surface.height,
                time: entry.lastTime,
                delta: ctx.delta,
              });
            }
          }
        }
      } catch (err) {
        this.warnOnce(entry.cardId, 'effects', err);
      }
    }
  };
}

let pool: RendererPool | null = null;

export function getPool(): RendererPool {
  if (!pool) pool = new RendererPool();
  return pool;
}

// The soak test's read-only stats hook. A no-op unless the page URL has ?soak.
if (typeof window !== 'undefined') installSoakStats(() => getPool().stats(), () => peekGLStage());

export type { RendererPool };
