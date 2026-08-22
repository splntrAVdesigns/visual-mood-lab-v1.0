import type { ControlSchema, ParamState, ParamValue } from './control-schema';
import type { Asset, AssetType } from '@/types/asset';

/**
 * Visual Mood Lab — the renderer contract.
 *
 * Every asset type implements this. Nothing outside `renderers/` may
 * special-case a type; if it does, that is the bug, not the feature.
 *
 * Renderers do NOT own an animation loop. The pool drives them from a single
 * requestAnimationFrame, passing the same RenderContext to each. One loop for
 * forty cards, not forty loops.
 */

export type Quality = 'preview' | 'full';

export interface RenderContext {
  /** Seconds since this renderer started, already scaled by speed. */
  time: number;
  /** Seconds since the previous frame, already scaled. */
  delta: number;
  frame: number;
  /** CSS pixels of the target element. */
  width: number;
  height: number;
  pixelRatio: number;
  pointer: { x: number; y: number; down: boolean };
  /**
   * 64-bin FFT, normalized 0..1, or null when nothing is providing one for
   * this card this frame.
   *
   * Resolved PER CARD as of Phase 4.9, despite RenderContext otherwise
   * being identical across every renderer the pool drives on a given tick
   * (see the class doc above) — see lib/render/pool.ts's tick(): this
   * card's own uploaded track (lib/sound/track.ts) takes priority when
   * loaded, falling back to a board-wide feed reserved for a possible
   * future shared source (mic-in or similar) that nothing populates yet.
   */
  audio: Float32Array | null;
}

export interface CaptureOpts {
  scale?: number;
  type?: 'image/png' | 'image/webp';
}

export interface AssetRenderer {
  readonly type: AssetType;
  readonly assetId: string;

  /**
   * Attach to a host element. Must respect `signal` — the pool aborts mounts
   * that are evicted before they finish loading, which happens constantly
   * during fast scrolling.
   */
  mount(el: HTMLElement, asset: Asset, signal: AbortSignal): Promise<void>;

  /** Draw one frame. Never called while paused or disposed. */
  render(ctx: RenderContext): void;

  play(): void;
  pause(): void;
  seek?(seconds: number): void;

  /** Runtime schema. Shaders and media return the one parsed at ingest. */
  getControlSchema(): ControlSchema | null;

  setParam(id: string, value: ParamValue): void;
  setParams(params: ParamState): void;
  /** Fire a trigger control. */
  emit(event: string): void;

  setQuality(q: Quality): void;
  capture(opts?: CaptureOpts): Promise<Blob | null>;

  /**
   * Called by lib/render/pool.ts's tick() when the ENTIRE shared render
   * loop just resumed after a large gap — the browser throttling/pausing
   * requestAnimationFrame for the whole tab (a backgrounded tab, a
   * minimized window, laptop sleep, or a native modal like a file picker
   * holding focus), not any one renderer hanging. Optional: only
   * meaningful for a renderer that tracks its own liveness against wall-
   * clock time across a postMessage boundary (P5Renderer's heartbeat
   * watchdog) — most renderer types have nothing to reset here.
   *
   * Without this, a renderer with a wall-clock-based watchdog reads the
   * stall itself as "target stopped responding" the instant the loop
   * resumes, and tears down a perfectly healthy render — see
   * P5Renderer's implementation for the concrete failure this fixes.
   */
  resumeFromStall?(): void;

  dispose(): void;

  /** Non-null when the asset failed to compile, load, or run. */
  readonly error: string | null;
}

export type RendererFactory = (assetId: string) => AssetRenderer;
