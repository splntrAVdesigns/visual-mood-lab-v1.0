import type { Asset, CardState } from '@/types/asset';
import type { AssetRenderer, RenderContext } from '@/renderers/types';
import { createRenderer } from '@/renderers/registry';
import { getModBus } from '@/lib/modulation/bus';
import { applyModulation, type ModState, type ParamState } from '@/renderers/control-schema';
import { MAX_LIVE_RENDERERS } from '@/stores/playbackStore';

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
  private audio: Float32Array | null = null;

  private lastFrameAt = 0;
  private fpsFrames = 0;
  private fpsAt = 0;
  fps = 0;

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
      return;
    }

    if (existing && existing.host !== host) {
      // Same asset, different element — e.g. the grid card is already live
      // and the focused overlay just asked for the same asset. The old
      // promote() silently kept rendering into the original host here,
      // which is why the enlarged view showed nothing: the renderer never
      // moved. Tear down and remount into the new host instead.
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
    const now = performance.now();

    const entry: Entry = {
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
      baseParams: { ...(asset.params ?? {}) },
      modState: { ...(asset.mod ?? {}) },
    };

    this.entries.set(asset.id, entry);
    renderer.setQuality(state === 'focused' ? 'full' : 'preview');

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

    entry.controller.abort();
    entry.renderer.dispose();
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
    const entry = this.entries.get(cardId);
    if (entry) entry.baseParams = { ...params };
  }

  setBaseParam(cardId: string, id: string, value: ParamState[string]): void {
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

    const signal = getModBus().sample(`${cardId}:${controlId}`, mod);
    const next = applyModulation(control, base, mod, signal);
    return typeof next === 'number' ? next : null;
  }

  get liveCount(): number {
    return this.entries.size;
  }

  disposeAll(): void {
    for (const id of [...this.entries.keys()]) this.demote(id);
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
   */
  private applyModulation(entry: Entry): void {
    const routings = Object.keys(entry.modState);
    if (routings.length === 0) return;

    const schema = entry.renderer.getControlSchema();
    if (!schema) return;

    const bus = getModBus();

    for (const controlId of routings) {
      const mod = entry.modState[controlId];
      const control = schema.controls.find((c) => c.id === controlId);
      if (!mod || !control) continue;

      const base = entry.baseParams[controlId];
      if (base === undefined) continue;

      const signal = bus.sample(`${entry.cardId}:${controlId}`, mod);
      entry.renderer.setParam(controlId, applyModulation(control, base, mod, signal));
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

    const dt = Math.min((now - this.lastFrameAt) / 1000, 0.1);
    this.lastFrameAt = now;

    this.fpsFrames++;
    if (now - this.fpsAt > 1000) {
      this.fps = Math.round((this.fpsFrames * 1000) / (now - this.fpsAt));
      this.fpsFrames = 0;
      this.fpsAt = now;
    }

    for (const entry of this.entries.values()) {
      if (!entry.mounted) continue;

      const rect = entry.host.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;

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
        width: rect.width,
        height: rect.height,
        pixelRatio: window.devicePixelRatio || 1,
        pointer: this.pointer,
        audio: this.audio,
      };

      this.applyModulation(entry);

      try {
        entry.renderer.render(ctx);
      } catch (err) {
        entry.failure = err instanceof Error ? err.message : String(err);
        this.notify(entry.cardId, entry.state, entry.failure);
        this.demote(entry.cardId);
      }
    }
  };
}

let pool: RendererPool | null = null;

export function getPool(): RendererPool {
  if (!pool) pool = new RendererPool();
  return pool;
}

export type { RendererPool };
