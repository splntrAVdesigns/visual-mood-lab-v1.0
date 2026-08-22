import type { Asset } from '@/types/asset';
import type { ControlSchema, ParamState, ParamValue } from './control-schema';
import { defaultsOf } from './control-schema';
import { paramsToSchema } from '@/lib/sketch/params-to-schema';
import {
  BOOT_TIMEOUT_MS,
  HEARTBEAT_TIMEOUT_MS,
  SANDBOX_RUNTIME_VERSION,
  type HostToSandbox,
  type SandboxToHost,
} from '@/lib/sandbox/protocol';
import type { AssetRenderer, CaptureOpts, Quality, RenderContext } from './types';
import { setTileHovering, pluckTileAudio, setTileEnergy, isTileAudioActive } from '@/lib/sound/engine';
import { getWaveform } from '@/lib/sound/meter';
import { hasTrack, getTrackWaveform } from '@/lib/sound/track';

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
  /**
   * The board-item id (`asset.itemId`) — NOT `this.assetId`, which is
   * `asset.id`, the underlying content's own id, shared across every board
   * placement of it. lib/render/pool.ts keys everything sound-related
   * (soundState, the active-engine map) by itemId, since createRenderer()
   * is only ever given asset.id — this field exists specifically so the
   * 'hover' handler below can forward to the correct key instead of
   * silently missing every lookup.
   */
  private cardId = '';

  private lastHeartbeat = 0;
  private initSentAt = 0;
  private fps = 0;
  private captureWaiters = new Map<number, (url: string | null) => void>();
  private captureTimers = new Map<number, ReturnType<typeof setTimeout>>();
  private nextRequestId = 1;
  private onMessage: ((e: MessageEvent) => void) | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private resizeDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  /** Tracks the last 'enabled' value actually sent to the sandbox, so the
      falling edge (sound just stopped) sends exactly one explicit
      audioWaveform message rather than either spamming it every frame or
      never announcing the change — see render()'s audio block. */
  private lastAudioActiveSent: boolean | null = null;

  constructor(assetId: string) {
    this.assetId = assetId;
  }

  async mount(el: HTMLElement, asset: Asset, signal: AbortSignal): Promise<void> {
    this.cardId = asset.itemId;

    if (!asset.source) {
      this.error = 'Sketch has no source';
      return;
    }

    this.schema = asset.schema ?? null;
    this.params = this.schema ? { ...defaultsOf(this.schema), ...(asset.params ?? {}) } : {};

    const frame = document.createElement('iframe');
    // Version query param, not a bare static path — public/sandbox/index.html
    // has been edited several times this project (audioWaveform bridge,
    // then setEnergy), and a bare path gives the browser (and any CDN in
    // front of static assets) no signal that the file changed, so it can
    // keep serving a stale cached copy indefinitely. That's a silent
    // failure mode that looks exactly like a code bug — new host-side
    // logic calling a bridge function the currently-loaded sandbox runtime
    // never defined — while every line of actual code is correct. Bump
    // this string any time index.html changes.
    frame.src = `/sandbox/index.html?v=${SANDBOX_RUNTIME_VERSION}`;
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

      case 'key': {
        // Re-dispatch as a genuine host-level keydown. Doing it here rather
        // than wiring every shortcut owner up to the sandbox protocol means
        // existing listeners (FocusedAssetOverlay's F handler, Escape to
        // close) keep working with no knowledge that a sandboxed iframe was
        // ever involved.
        if (!msg.key) break;
        window.dispatchEvent(
          new KeyboardEvent('keydown', { key: msg.key, bubbles: true, cancelable: true }),
        );
        break;
      }

      case 'hover':
        // Interaction-gated sound presets (Field Lines' arp) read this —
        // see lib/sound/engine.ts. Must be cardId (asset.itemId), not
        // this.assetId (asset.id) — see the cardId field's comment for why
        // those are two different strings. Harmless no-op for a card whose
        // active preset isn't an ArpEngine, or that has no sound engine
        // running at all.
        setTileHovering(this.cardId, !!msg.hovering);
        break;

      case 'pluck':
        // Graze-to-pluck: a discrete trigger event from the sketch itself
        // (Field Lines' per-line crossing detection), not continuous
        // hover state. Same cardId-vs-assetId reasoning as 'hover' above.
        if (typeof msg.x === 'number') pluckTileAudio(this.cardId, msg.x);
        break;

      case 'energy':
        // Continuous interaction-intensity signal (Wound Thread's push
        // physics), not a discrete event like pluck. Same cardId-vs-
        // assetId reasoning as 'hover' above. No-op for anything that
        // isn't an interaction-gated AbstractEngine — see setTileEnergy.
        if (typeof msg.energy === 'number') setTileEnergy(this.cardId, msg.energy);
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

    // Forward this card's own live audio, if anything is actually driving
    // it — generic plumbing any sketch can opt into via
    // p.getAudioWaveform() in the sandbox, not something specific to any
    // one sketch. Two possible sources as of Phase 4.9: an uploaded track
    // (lib/sound/track.ts) or the tile's own synth preset
    // (lib/sound/meter.ts's shared analyser tap) — a track takes priority
    // when both are present, same as pool.ts's per-card ctx.audio
    // resolution, since loading a track is the more deliberate, more
    // recent choice. `enabled` is sent explicitly rather than inferred
    // from the buffer, per the protocol doc.
    const trackActive = hasTrack(this.cardId);
    const synthActive = isTileAudioActive(this.cardId);
    if (trackActive || synthActive) {
      const waveform = trackActive ? getTrackWaveform(this.cardId) : getWaveform(this.cardId);
      this.send({ type: 'audioWaveform', enabled: true, waveform: waveform ?? undefined });
      this.lastAudioActiveSent = true;
    } else if (this.lastAudioActiveSent !== false) {
      // Falling edge (or first frame with nothing active) — announce it
      // once rather than every subsequent silent frame.
      this.send({ type: 'audioWaveform', enabled: false });
      this.lastAudioActiveSent = false;
    }
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

  /**
   * Called by the pool after it detects the WHOLE shared render loop just
   * resumed from a large gap — see AssetRenderer.resumeFromStall's doc.
   * A native file-picker dialog (Upload Audio, or any file input) is a
   * confirmed real-world trigger: it takes OS-level focus, and the
   * browser throttles requestAnimationFrame for the backgrounded tab —
   * including this iframe's own heartbeat setInterval, which shares the
   * same throttling. Without this reset, the very first render() after
   * the dialog closes reads `lastHeartbeat` as stale by however long the
   * dialog was open (often well past HEARTBEAT_TIMEOUT_MS), decides the
   * sketch hung, and tears down a perfectly healthy iframe — the
   * intermittent "tile goes blank the moment Upload Audio is clicked"
   * bug. The sketch never actually stopped heartbeating; the whole tab,
   * including the code that would have noticed, was paused right along
   * with it. Just re-arm the clock and let the iframe's own heartbeat
   * catch up normally on its next tick.
   */
  resumeFromStall(): void {
    this.lastHeartbeat = performance.now();
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
