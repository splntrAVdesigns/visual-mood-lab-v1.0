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
  /** 64-bin FFT from the shared analyser, or null when audio is off. Phase 4. */
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

  dispose(): void;

  /** Non-null when the asset failed to compile, load, or run. */
  readonly error: string | null;
}

export type RendererFactory = (assetId: string) => AssetRenderer;
