import { SandboxEffectSurface } from './sandbox-effect-surface';
import { resetEffectHistory } from '@/lib/gl/effects-compositor';
import type { Asset } from '@/types/asset';
import type { ControlSchema, ParamState, ParamValue } from './control-schema';
import { defaultsOf } from './control-schema';
import { paramsToSchema } from '@/lib/sketch/params-to-schema';
import { carryParams } from '@/lib/schema/carry';
import type { SourceSwapResult } from './types';
import { getFontEntry } from '@/lib/fonts/manifest';
import {
  BOOT_TIMEOUT_MS,
  HEARTBEAT_TIMEOUT_MS,
  SANDBOX_RUNTIME_VERSION,
  type HostToSandbox,
  type SandboxToHost,
} from '@/lib/sandbox/protocol';
import { parseSandboxMessage } from '@/lib/sandbox/validate-message';
import type { AssetRenderer, CaptureOpts, Quality, RenderContext } from './types';
import { setTileHovering, pluckTileAudio, setTileEnergy, isTileAudioActive } from '@/lib/sound/engine';
import { getWaveform } from '@/lib/sound/meter';
import { hasTrack, getTrackWaveform, getTrackBand, getTrackFrequencyData } from '@/lib/sound/track';
import { isMicEnabled, getMicWaveform, getMicFrequencyData } from '@/lib/sound/mic';
import { getAudioContext } from '@/lib/sound/context';

/**
 * Fetches a same-origin static asset (this runs on the real page, not
 * inside the sandbox, so there's no origin problem here) and converts it
 * to a base64 `data:` URL — see pushFontsFor()'s doc for why that's the
 * form that actually crosses into the null-origin sandbox usably.
 */
async function fetchAsDataUrl(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Font fetch failed: ${res.status} ${url}`);
  const blob = await res.blob();
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'));
    reader.readAsDataURL(blob);
  });
}

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
  /** A setSource() waiting for the sandbox to report the new sketch's schema (or an error). */
  private swap: { resolve: (r: SourceSwapResult) => void; timer: ReturnType<typeof setTimeout> } | null = null;
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
  private drawP95Ms: number | null = null;
  private captureP95Ms: number | null = null;
  private profileActive: boolean | null = null;
  private captureWaiters = new Map<number, (url: string | null) => void>();
  private captureTimers = new Map<number, ReturnType<typeof setTimeout>>();
  private nextRequestId = 1;
  private onMessage: ((e: MessageEvent) => void) | null = null;
  private effectSurface: SandboxEffectSurface | null = null;
  private frameWrap: HTMLDivElement | null = null;

  private resizeObserver: ResizeObserver | null = null;
  private resizeDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  /** Tracks the last 'enabled' value actually sent to the sandbox, so the
      falling edge (sound just stopped) sends exactly one explicit
      audioWaveform message rather than either spamming it every frame or
      never announcing the change — see render()'s audio block. */
  private lastAudioActiveSent: boolean | null = null;

  /** Font ids already sent to THIS iframe instance — see pushFontsFor()'s
      doc. A fresh iframe per mount means this always starts empty; no
      need to persist it beyond the instance's own lifetime. */
  private sentFontIds = new Set<string>();

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
    const profileRequested = new URLSearchParams(window.location.search).has('perf');
    frame.src = `/sandbox/index.html?v=${SANDBOX_RUNTIME_VERSION}${profileRequested ? '&profile=1' : ''}`;
    frame.style.cssText = 'width:100%;height:100%;border:0;display:block;background:#000';
    // allow-scripts WITHOUT allow-same-origin: the frame gets a null origin
    // and cannot reach this document, its storage, or its cookies.
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.setAttribute('title', `Sketch: ${asset.title}`);

    this.frameEl = frame;

    this.onMessage = (e: MessageEvent) => {
      if (e.source !== frame.contentWindow) return;
      // The frame is a null-origin iframe, but sketch code runs in the same
      // realm as the runtime and can postMessage anything. Nothing reaches
      // handle() without passing the gate — see lib/sandbox/validate-message.ts.
      const msg = parseSandboxMessage(e.data);
      if (msg) this.handle(msg);
      else if (e.data?.type === 'vfx-frame' && typeof ImageBitmap !== 'undefined' && e.data.bitmap instanceof ImageBitmap) e.data.bitmap.close();
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
    const wrap=document.createElement('div');
    wrap.style.cssText='position:relative;width:100%;height:100%;overflow:hidden';
    wrap.appendChild(frame);el.appendChild(wrap);this.frameWrap=wrap;
    this.effectSurface=new SandboxEffectSurface(frame,wrap,msg=>this.send(msg));

    await new Promise<void>((resolve) => {
      frame.addEventListener('load', () => resolve(), { once: true });
      // Never hang the pool on a frame that fails to load.
      setTimeout(resolve, 4000);
    });

    if (signal.aborted || this.disposed) return;

    this.lastHeartbeat = performance.now();
    this.initSentAt = performance.now();
    this.send({ type: 'init', source: asset.source, params: this.params as Record<string, unknown>, profile: new URLSearchParams(window.location.search).has('perf') });
    void this.pushFontsFor(this.params);
  }

  private handle(msg: SandboxToHost): void {
    switch (msg.type) {
      case 'vfx-frame':
        this.effectSurface?.accept(msg);
        break;
      case 'ready':
        this.ready = true;
        this.error = null;
        // Push quality now rather than at mount: setQuality() runs before the
        // iframe exists, so that message went nowhere. Without this every
        // sketch stayed at the default density.
        this.send({ type: 'quality', quality: this.quality });
        break;

      case 'schema': {
        // The sandbox posts this after EVERY successful run of a sketch, with
        // null params when it exports none. Ordinarily only a real params
        // object matters; while a setSource() is waiting, null counts too (the
        // new sketch has no controls) and this message is what settles it.
        const swapping = this.swap !== null;
        if (msg.params || swapping) {
          // The sandbox reports the sketch's real params object. Prefer it over
          // the ingest-time scrape, which had to be conservative.
          const { schema, warnings } = paramsToSchema(msg.params ?? undefined, { schemaId: `sketch:${this.assetId}` });
          const previous = this.schema;
          this.schema = schema;
          this.params = swapping ? carryParams(previous, schema, this.params) : { ...defaultsOf(schema), ...this.params };
          this.send({ type: 'params', params: this.params as Record<string, unknown> });
          void this.pushFontsFor(this.params);
          if (swapping) {
            this.settleSwap({
              ok: true,
              schema,
              warnings: warnings.filter((w) => w.level === 'warn').map((w) => ({ message: w.message, id: w.id })),
            });
          }
        }
        break;
      }

      case 'error':
        this.error = msg.message ?? 'Sketch error';
        this.effectSurface?.reset();
        this.settleSwap({ ok: false, error: this.error });
        break;

      case 'heartbeat':
        this.lastHeartbeat = performance.now();
        this.fps = msg.fps ?? 0;
        this.drawP95Ms = msg.drawP95Ms ?? null;
        this.captureP95Ms = msg.captureP95Ms ?? null;
        this.profileActive = msg.profileActive ?? null;
        break;

      case 'key': {
        // Re-dispatch as a genuine host-level keydown. Doing it here rather
        // than wiring every shortcut owner up to the sandbox protocol means
        // existing listeners (FocusedAssetOverlay's F handler, Escape to
        // close) keep working with no knowledge that a sandboxed iframe was
        // ever involved.
        if (!msg.key) break;
        // Dispatched on `document`, NOT `window`. The two are not equivalent:
        // an event fired at `window` is delivered only to window's own
        // listeners — it never travels DOWN to `document`. The focus overlay
        // and the drawers listen on `document`, so with this on `window`
        // Escape (forwarded whenever focus is inside the sketch, i.e. after any
        // click or drag on it) reached AppShell's window listener but never the
        // overlay or the inspector: the overlay would not close. Fired at
        // `document` with bubbles:true it reaches document listeners first and
        // then window listeners — every existing shortcut owner, once each.
        document.dispatchEvent(
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

  private isFontControl(controlId: string): boolean {
    return this.schema?.controls.some((c) => c.id === controlId && c.kind === 'font') ?? false;
  }

  /**
   * Resolves every `font`-kind control referenced in `changed` against
   * the shared manifest (lib/fonts/manifest.ts), fetches whichever of
   * those font ids haven't already been sent to this iframe instance,
   * and pushes them across as base64 data URLs — see protocol.ts's
   * `fonts` field doc for why data URLs specifically (the sandbox's
   * null origin breaks a plain fetch of `/fonts/...` from inside it).
   *
   * Fire-and-forget by design: setParam()/setParams() are synchronous in
   * the AssetRenderer contract (types.ts) and this shouldn't change
   * that. The param value itself is already sent synchronously above,
   * same as before — this only affects when the sketch's font visually
   * swaps in, a little after the param write, exactly like a web font
   * loading anywhere else.
   *
   * Only scans `changed`, not the full `this.params` — mount() and the
   * 'schema' handler both pass the complete params object so nothing is
   * missed on first load, while setParam() passes just the one control
   * that changed so an unrelated slider tweak doesn't re-scan every font
   * control on the schema.
   */
  private async pushFontsFor(changed: Partial<Record<string, unknown>>): Promise<void> {
    if (!this.schema) return;

    const toFetch: string[] = [];
    for (const control of this.schema.controls) {
      if (control.kind !== 'font') continue;
      if (!(control.id in changed)) continue;
      const value = changed[control.id];
      const fontId = typeof value === 'string' ? value : null;
      if (!fontId || this.sentFontIds.has(fontId)) continue;
      toFetch.push(fontId);
    }
    if (toFetch.length === 0) return;

    const resolved: Array<{ id: string; dataUrl: string }> = [];
    for (const fontId of toFetch) {
      const entry = getFontEntry(fontId);
      const file = entry?.files[0];
      if (!file) continue;
      try {
        const dataUrl = await fetchAsDataUrl(file.url);
        resolved.push({ id: fontId, dataUrl });
        this.sentFontIds.add(fontId);
      } catch {
        // A failed font fetch shouldn't take the sketch down — it just
        // keeps whatever fallback the sketch's own p.getEmbeddedFont()
        // resolution falls back to (see the sandbox-side contract doc).
      }
    }
    if (resolved.length === 0 || this.disposed) return;
    this.send({ type: 'fonts', fonts: resolved });
  }

  setEffectsActive(active: boolean): void { this.effectSurface?.setActive(active); }
  getEffectsNotice(): string | null { return this.effectSurface?.getNotice() ?? null; }
  getEffectsFrameVersion(): number { return this.effectSurface?.getFrameVersion() ?? -1; }
  restoreEffectsSource(): void { this.effectSurface?.restoreCleanFrame(); }
  getCanvas(): HTMLCanvasElement | null { return this.effectSurface?.getCanvas() ?? null; }

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
      this.effectSurface?.reset();
      this.frameEl?.remove();
      this.frameEl = null;
      this.ready = false;
      return;
    }

    this.effectSurface?.render(ctx);

    // Forward this card's own live audio, if anything is actually driving
    // it — generic plumbing any sketch can opt into via
    // p.getAudioWaveform() in the sandbox, not something specific to any
    // one sketch. Three possible sources as of Phase 4.9.2: an uploaded
    // track (lib/sound/track.ts), the shared mic input (lib/sound/mic.ts),
    // or the tile's own synth preset (lib/sound/meter.ts's shared
    // analyser tap) — Track > Mic > synth preset, same priority order
    // pool.ts's per-card ctx.audio resolution uses, since loading a track
    // is the most deliberate, most recent choice, mic is "react to
    // whatever's happening right now," and the synth preset is the
    // ambient default. `enabled` is sent explicitly rather than inferred
    // from the buffer, per the protocol doc.
    const trackActive = hasTrack(this.cardId);
    const micActive = !trackActive && isMicEnabled(this.cardId);
    const synthActive = !trackActive && !micActive && isTileAudioActive(this.cardId);
    if (trackActive || micActive || synthActive) {
      const waveform = trackActive
        ? getTrackWaveform(this.cardId)
        : micActive
          ? getMicWaveform()
          : getWaveform(this.cardId);
      // Track-only, per the field's own doc in protocol.ts — omitted
      // entirely (not zeroed) for mic/synth-preset audio, which have no
      // per-band split anywhere else in this codebase either.
      const bands = trackActive
        ? {
            bass: getTrackBand(this.cardId, 'bass') ?? 0,
            mid: getTrackBand(this.cardId, 'mid') ?? 0,
            high: getTrackBand(this.cardId, 'high') ?? 0,
          }
        : undefined;
      // Track OR mic (unlike `bands` above) — see protocol.ts's
      // `spectrum` doc. Both getTrackFrequencyData()/getMicFrequencyData()
      // already exist and return this exact shape; synth-preset audio has
      // no frequency-domain tap anywhere in this codebase, so it's the
      // one case that stays undefined here, same as `bands`.
      const spectrum = trackActive
        ? getTrackFrequencyData(this.cardId) ?? undefined
        : micActive
          ? getMicFrequencyData() ?? undefined
          : undefined;
      // 128, not a dynamically-read fftSize: both track.ts's and mic.ts's
      // frequency analysers hardcode fftSize = 128 inline (64 bins) —
      // matching that literal here rather than adding a new exported
      // constant neither file currently has, since this is the same
      // number they'd both need to change together if it ever moved.
      const spectrumBinHz = spectrum ? getAudioContext().sampleRate / 128 : undefined;
      this.send({ type: 'audioWaveform', enabled: true, waveform: waveform ?? undefined, bands, spectrum, spectrumBinHz });
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
    if (this.isFontControl(id)) void this.pushFontsFor({ [id]: value });
  }

  setParams(params: ParamState): void {
    this.params = { ...this.params, ...params };
    this.send({ type: 'params', params: this.params as Record<string, unknown> });
    void this.pushFontsFor(params);
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
    const surface=this.getCanvas();
    if(surface) return new Promise(resolve=>surface.toBlob(resolve,_opts?.type ?? 'image/png'));
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

  get currentDrawP95Ms(): number | null { return this.drawP95Ms; }
  get currentCaptureP95Ms(): number | null { return this.captureP95Ms; }
  getSketchProfile(): { drawP95Ms: number | null; captureP95Ms: number | null; profileActive: boolean | null } {
    return { drawP95Ms: this.drawP95Ms, captureP95Ms: this.captureP95Ms, profileActive: this.profileActive };
  }

  get isPaused(): boolean {
    return this.paused;
  }

  /**
   * Hot-swap the running sketch. The sandbox re-runs on a second `init` — no
   * iframe teardown — and answers with `schema` (success) or `error`. One swap
   * at a time: a newer call supersedes an unanswered older one. Unlike a shader,
   * a sketch that fails to evaluate has already torn its predecessor down inside
   * the sandbox, so the caller keeps the last good source to send again.
   */
  setSource(source: string): Promise<SourceSwapResult> {
    if (this.disposed || !this.frameEl) return Promise.resolve({ ok: false, error: 'This sketch is not mounted.' });
    this.settleSwap({ ok: false, error: 'Superseded by a newer edit.' });
    return new Promise<SourceSwapResult>((resolve) => {
      const timer = setTimeout(() => this.settleSwap({ ok: false, error: 'The sketch did not respond.' }), 4000);
      this.swap = { resolve, timer };
      this.effectSurface?.reset();
      resetEffectHistory(this.cardId);
      this.send({ type: 'init', source, params: this.params as Record<string, unknown>, profile: new URLSearchParams(window.location.search).has('perf') });
    });
  }

  private settleSwap(result: SourceSwapResult): void {
    const pending = this.swap;
    if (!pending) return;
    this.swap = null;
    clearTimeout(pending.timer);
    pending.resolve(result);
  }

  dispose(): void {
    this.settleSwap({ ok: false, error: 'This sketch was disposed.' });
    this.disposed = true;
    if (this.onMessage) window.removeEventListener('message', this.onMessage);
    this.onMessage = null;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (this.resizeDebounceTimer) clearTimeout(this.resizeDebounceTimer);
    this.resizeDebounceTimer = null;
    this.effectSurface?.dispose();
    this.effectSurface=null;
    this.frameWrap?.remove();
    this.frameWrap=null;
    this.frameEl?.remove();
    this.frameEl = null;
    for (const timer of this.captureTimers.values()) clearTimeout(timer);
    this.captureTimers.clear();
    this.captureWaiters.clear();
    this.sentFontIds.clear();
  }
}
