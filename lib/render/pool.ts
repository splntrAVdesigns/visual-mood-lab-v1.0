import type { Asset, CardState } from '@/types/asset';
import type { AssetRenderer, RenderContext } from '@/renderers/types';
import { createRenderer } from '@/renderers/registry';
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
  assetId: string;
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
}

export interface PoolFrameInfo {
  fps: number;
  live: number;
}

type Listener = (assetId: string, state: CardState, error: string | null) => void;

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
    const existing = this.entries.get(asset.id);

    if (existing && existing.host === host) {
      existing.state = state;
      existing.promotedAt = performance.now();
      existing.renderer.setQuality(state === 'focused' ? 'full' : 'preview');
      this.enforceBudget(asset.id);
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
      this.entries.delete(asset.id);
      this.notify(asset.id, 'poster', null);
    }

    this.enforceBudget(asset.id);

    const controller = new AbortController();
    const renderer = createRenderer(asset.type, asset.id);
    const now = performance.now();

    const entry: Entry = {
      assetId: asset.id,
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
    };

    this.entries.set(asset.id, entry);
    renderer.setQuality(state === 'focused' ? 'full' : 'preview');

    try {
      await renderer.mount(host, asset, controller.signal);
    } catch (err) {
      entry.failure = err instanceof Error ? err.message : String(err);
    }

    // Evicted mid-mount — a constant occurrence during fast scrolling.
    if (controller.signal.aborted || !this.entries.has(asset.id)) {
      renderer.dispose();
      return;
    }

    entry.mounted = true;
    if (this.paused) renderer.pause();

    this.notify(asset.id, state, entry.failure ?? renderer.error);
    this.startLoop();
  }

  demote(assetId: string): void {
    const entry = this.entries.get(assetId);
    if (!entry) return;

    entry.controller.abort();
    entry.renderer.dispose();
    this.entries.delete(assetId);

    this.notify(assetId, 'poster', null);
    if (this.entries.size === 0) this.stopLoop();
  }

  /**
   * Keeps the live set within budget. Focused cards are protected; among
   * previews, the oldest promotion goes first.
   */
  private enforceBudget(incomingId: string): void {
    const candidates = [...this.entries.values()]
      .filter((e) => e.assetId !== incomingId && e.state !== 'focused')
      .sort((a, b) => a.promotedAt - b.promotedAt);

    let over = this.entries.size + (this.entries.has(incomingId) ? 0 : 1) - MAX_LIVE_RENDERERS;

    for (const victim of candidates) {
      if (over <= 0) break;
      this.demote(victim.assetId);
      over--;
    }
  }

  get(assetId: string): AssetRenderer | null {
    return this.entries.get(assetId)?.renderer ?? null;
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

      try {
        entry.renderer.render(ctx);
      } catch (err) {
        entry.failure = err instanceof Error ? err.message : String(err);
        this.notify(entry.assetId, entry.state, entry.failure);
        this.demote(entry.assetId);
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
