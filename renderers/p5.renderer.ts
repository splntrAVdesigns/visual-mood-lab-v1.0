import type { Asset } from '@/types/asset';
import type { ControlSchema, ParamState, ParamValue } from './control-schema';
import { defaultsOf } from './control-schema';
import { paramsToSchema } from '@/lib/sketch/params-to-schema';
import {
  BOOT_TIMEOUT_MS,
  HEARTBEAT_TIMEOUT_MS,
  type HostToSandbox,
  type SandboxToHost,
} from '@/lib/sandbox/protocol';
import type { AssetRenderer, CaptureOpts, Quality, RenderContext } from './types';

/**
 * Runs a p5 sketch inside a sandboxed iframe.
 *
 * The sketch owns its own p5 draw loop inside the frame — this renderer does
 * not drive frames, it supervises. `render()` only pushes host state (pointer,
 * size) across the boundary and checks the watchdog.
 *
 * The watchdog is the point: if a sketch hangs, the frame stops heartbeating
 * and we tear it down. Without it, one `while(true)` in user code would take
 * the whole tab down along with everything unsaved in it.
 */
export class P5Renderer implements AssetRenderer {
  readonly type = 'p5' as const;
  readonly assetId: string;

  error: string | null = null;

  private frameEl: HTMLIFrameElement | null = null;
  private schema: ControlSchema | null = null;
  private params: ParamState = {};
  private paused = false;
  private disposed = false;
  private ready = false;
  private quality: Quality = 'preview';

  private lastHeartbeat = 0;
  private initSentAt = 0;
  private fps = 0;
  private captureWaiters = new Map<number, (url: string | null) => void>();
  private captureTimers = new Map<number, ReturnType<typeof setTimeout>>();
  private nextRequestId = 1;
  private onMessage: ((e: MessageEvent) => void) | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private resizeDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(assetId: string) {
    this.assetId = assetId;
  }

  async mount(el: HTMLElement, asset: Asset, signal: AbortSignal): Promise<void> {

    if (!asset.source) {
      this.error = 'Sketch has no source';
      return;
    }

    this.schema = asset.schema ?? null;
    this.params = this.schema ? { ...defaultsOf(this.schema), ...(asset.params ?? {}) } : {};

    const frame = document.createElement('iframe');
    frame.src = '/sandbox/index.html';
    frame.style.cssText = 'width:100%;height:100%;border:0;display:block;background:#000';
    // allow-scripts WITHOUT allow-same-origin: the frame gets a null origin
    // and cannot reach this document, its storage, or its cookies.
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.setAttribute('title', `Sketch: ${asset.title}`);

    this.frameEl = frame;

    this.onMessage = (e: MessageEvent) => {
      if (e.source !== frame.contentWindow) return;
      this.handle(e.data as SandboxToHost);
    };
    window.addEventListener('message', this.onMessage);

    // Debounced on top of ResizeObserver's own batching because a fullscreen
    // transition can still report several intermediate sizes as it animates
    // — but ResizeObserver only fires on the host's ACTUAL layout box
    // changing, which is a real settle signal in a way the iframe's own
    // internal resize events were not. This is what drives the sandbox's
    // explicit 'resize' message now, rather than the sandbox inferring
    // "done resizing" from its own noisy event stream.
    this.resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (width <= 0 || height <= 0) return;

      if (this.resizeDebounceTimer) clearTimeout(this.resizeDebounceTimer);
      this.resizeDebounceTimer = setTimeout(() => {
        this.resizeDebounceTimer = null;
        this.send({
          type: 'resize',
          width: Math.round(width),
          height: Math.round(height),
          pixelRatio: window.devicePixelRatio || 1,
        });
      }, 200);
    });
    this.resizeObserver.observe(el);

    if (signal.aborted) return;
    el.appendChild(frame);

    await new Promise<void>((resolve) => {
      frame.addEventListener('load', () => resolve(), { once: true });
      // Never hang the pool on a frame that fails to load.
      setTimeout(resolve, 4000);
    });

    if (signal.aborted || this.disposed) return;

    this.lastHeartbeat = performance.now();
    this.initSentAt = performance.now();
    this.send({ type: 'init', source: asset.source, params: this.params as Record<string, unknown> });
  }

  private handle(msg: SandboxToHost): void {
    switch (msg.type) {
      case 'ready':
        this.ready = true;
        this.error = null;
        // Push quality now rather than at mount: setQuality() runs before the
        // iframe exists, so that message went nowhere. Without this every
        // sketch stayed at the default density.
        this.send({ type: 'quality', quality: this.quality });
        break;

      case 'schema': {
        // The sandbox reports the sketch's real params object. Prefer it over
        // the ingest-time scrape, which had to be conservative.
        if (msg.params) {
          const { schema } = paramsToSchema(msg.params, { schemaId: `sketch:${this.assetId}` });
          this.schema = schema;
          this.params = { ...defaultsOf(schema), ...this.params };
          this.send({ type: 'params', params: this.params as Record<string, unknown> });
        }
        break;
      }

      case 'error':
        this.error = msg.message ?? 'Sketch error';
        break;

      case 'heartbeat':
        this.lastHeartbeat = performance.now();
        this.fps = msg.fps ?? 0;
        break;

      case 'captured': {
        const waiter = msg.requestId ? this.captureWaiters.get(msg.requestId) : undefined;
        if (waiter && msg.requestId) {
          waiter(msg.dataUrl ?? null);
          this.captureWaiters.delete(msg.requestId);
          const timer = this.captureTimers.get(msg.requestId);
          if (timer) {
            clearTimeout(timer);
            this.captureTimers.delete(msg.requestId);
          }
        }
        break;
      }
    }
  }

  private send(msg: HostToSandbox): void {
    this.frameEl?.contentWindow?.postMessage(msg, '*');
  }

  render(ctx: RenderContext): void {
    if (this.disposed) return;

    // A sandbox that never reports ready previously returned early here
    // forever and never set an error, so the card just sat blank with no
    // indication anything was wrong. Fail loudly instead.
    if (!this.ready) {
      if (this.initSentAt > 0 && performance.now() - this.initSentAt > BOOT_TIMEOUT_MS) {
        this.error =
          this.error ??
          'Sketch did not start. The sandbox loaded but the sketch never signalled ready — check the browser console for a syntax or API error.';
        this.initSentAt = 0;
      }
      return;
    }

    if (performance.now() - this.lastHeartbeat > HEARTBEAT_TIMEOUT_MS) {
      this.error = 'Sketch stopped responding and was halted.';
      this.frameEl?.remove();
      this.frameEl = null;
      this.ready = false;
      return;
    }

    void ctx;
  }

  play(): void {
    this.paused = false;
    this.send({ type: 'play' });
  }

  pause(): void {
    this.paused = true;
    this.send({ type: 'pause' });
  }

  getControlSchema(): ControlSchema | null {
    return this.schema;
  }

  setParam(id: string, value: ParamValue): void {
    this.params[id] = value;
    this.send({ type: 'params', id, value });
  }

  setParams(params: ParamState): void {
    this.params = { ...this.params, ...params };
    this.send({ type: 'params', params: this.params as Record<string, unknown> });
  }

  emit(event: string): void {
    this.send({ type: 'event', event });
  }

  setQuality(q: Quality): void {
    this.quality = q;
    this.send({ type: 'quality', quality: q });
  }

  async capture(_opts?: CaptureOpts): Promise<Blob | null> {
    if (!this.frameEl) return null;
    const requestId = this.nextRequestId++;

    const dataUrl = await new Promise<string | null>((resolve) => {
      this.captureWaiters.set(requestId, resolve);
      this.send({ type: 'capture', requestId });
      const timer = setTimeout(() => {
        this.captureTimers.delete(requestId);
        this.captureWaiters.delete(requestId);
        resolve(null);
      }, 3000);
      this.captureTimers.set(requestId, timer);
    });

    if (!dataUrl) return null;
    return (await fetch(dataUrl)).blob();
  }

  get currentFps(): number {
    return this.fps;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  dispose(): void {
    this.disposed = true;
    if (this.onMessage) window.removeEventListener('message', this.onMessage);
    this.onMessage = null;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (this.resizeDebounceTimer) clearTimeout(this.resizeDebounceTimer);
    this.resizeDebounceTimer = null;
    this.frameEl?.remove();
    this.frameEl = null;
    for (const timer of this.captureTimers.values()) clearTimeout(timer);
    this.captureTimers.clear();
    this.captureWaiters.clear();
  }
}
