import type { Asset, AssetType } from '@/types/asset';
import type { ControlSchema, ParamState, ParamValue, RGBA } from './control-schema';
import { defaultSchemaFor, defaultsOf } from './control-schema';
import type { AssetRenderer, CaptureOpts, Quality, RenderContext } from './types';

/**
 * One renderer for image, svg, and video.
 *
 * These three differ only in which element they mount; everything else —
 * opacity, blend mode, transform, playback — is the shared base schema
 * applied to element style. Splitting them into three files would have
 * duplicated all of that to express a one-line difference.
 */
export class MediaRenderer implements AssetRenderer {
  readonly type: AssetType;
  readonly assetId: string;

  error: string | null = null;

  /** Sized 1:1 with the host; carries transform + opacity so the media
      element and the tint overlay move and fade together as one unit. */
  private wrap: HTMLDivElement | null = null;
  private el: HTMLImageElement | HTMLVideoElement | null = null;
  /**
   * Tint overlay — a solid-colour layer blended against the real media
   * beneath it via `mix-blend-mode: color`. This is the working
   * substitute for Blend mode (see that control's `disabled` doc in
   * control-schema.ts): Blend mode on the media element itself has
   * nothing real to composite against once the poster fades out behind
   * it (just the black board stage), so most of its options render solid
   * black and the rest render unchanged. A swatch blended against the
   * image *does* have real content underneath it, so it actually works.
   */
  private tintEl: HTMLDivElement | null = null;
  private schema: ControlSchema | null = null;
  private params: ParamState = {};
  private paused = false;
  private disposed = false;

  constructor(assetId: string, type: AssetType) {
    this.assetId = assetId;
    this.type = type;
  }

  async mount(host: HTMLElement, asset: Asset, signal: AbortSignal): Promise<void> {
    const src = asset.srcUrl ?? asset.posterUrl;
    if (!src) {
      this.error = 'Asset has no source';
      return;
    }

    this.schema = asset.schema ?? defaultSchemaFor(asset.id, this.type);
    this.params = { ...defaultsOf(this.schema), ...(asset.params ?? {}) };

    const el =
      this.type === 'video'
        ? Object.assign(document.createElement('video'), {
            muted: true,
            loop: true,
            playsInline: true,
            autoplay: true,
          })
        : document.createElement('img');

    el.src = src;
    el.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block';
    if (el instanceof HTMLImageElement) {
      el.decoding = 'async';
      el.alt = '';
    }

    this.el = el;

    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:relative;width:100%;height:100%;overflow:hidden';
    wrap.appendChild(el);
    this.wrap = wrap;

    const tintEl = document.createElement('div');
    tintEl.style.cssText = 'position:absolute;inset:0;pointer-events:none';
    wrap.appendChild(tintEl);
    this.tintEl = tintEl;

    await new Promise<void>((resolve) => {
      const done = () => resolve();
      el.addEventListener(this.type === 'video' ? 'loadeddata' : 'load', done, { once: true });
      el.addEventListener('error', () => {
        this.error = 'Failed to load media';
        resolve();
      }, { once: true });
      setTimeout(resolve, 8000);
    });

    if (signal.aborted || this.disposed) return;
    host.appendChild(wrap);
    this.applyStyle();
  }

  render(_ctx: RenderContext): void {
    // Images and video are driven by the browser, not by our loop. Style is
    // only reapplied when a param actually changes.
  }

  private applyStyle(): void {
    const el = this.el;
    const wrap = this.wrap;
    if (!el || !wrap || !this.schema) return;

    const num = (id: string, fallback: number) => {
      const v = this.params[id];
      return typeof v === 'number' ? v : fallback;
    };

    const offset = this.params.offset;
    const [ox, oy] = Array.isArray(offset) ? offset : [0, 0];

    // Opacity and transform move to the wrapper, not the media element
    // itself, so the tint overlay — a sibling, not a child of `el` —
    // fades and moves in lockstep with it rather than staying pinned in
    // place while the image underneath scales or slides away from it.
    wrap.style.opacity = String(num('opacity', 1));
    wrap.style.transform = [
      `translate(${(ox as number) * 100}%, ${(oy as number) * 100}%)`,
      `scale(${num('scale', 1)})`,
      `rotate(${num('rotation', 0)}deg)`,
    ].join(' ');

    // Left wired even though the control is disabled in the UI (see its
    // schema doc) — a value saved before this fix shipped still applies
    // rather than silently reverting, and it costs nothing since new
    // params can only ever be 'normal' with the control inert.
    el.style.mixBlendMode = String(this.params.blendMode ?? 'normal');

    if (this.tintEl) {
      const amount = Math.max(0, Math.min(1, num('tintAmount', 0)));
      const tint = (this.params.tint ?? { r: 1, g: 1, b: 1, a: 1 }) as RGBA;
      this.tintEl.style.mixBlendMode = 'color';
      this.tintEl.style.backgroundColor = rgbaToCss({ ...tint, a: 1 });
      this.tintEl.style.opacity = String(amount);
    }

    if (el instanceof HTMLVideoElement) {
      el.playbackRate = Math.max(0.0625, num('speed', 1));
      el.loop = this.params.loop !== false;

      // FIX (Video Export Foundation follow-up): this block previously
      // ended after setting `.loop` — the Inspector's Paused toggle wrote
      // to `this.params.paused` via setParam() same as any other control,
      // but nothing here ever read it back, so the control changed state
      // that had no effect on the actual <video> element. `play()`/
      // `pause()` below are the pool's own global "pause all" methods
      // (called directly by lib/render/pool.ts, not through params) —
      // a completely separate path from this per-tile schema value, which
      // is exactly how the two ended up disconnected from each other.
      const shouldPause = this.params.paused === true;
      if (shouldPause) {
        if (!el.paused) el.pause();
      } else if (el.paused) {
        // A video that played to its end while `loop` was off sits at its
        // last frame with `.paused === true` and `.ended === true`.
        // Re-enabling `.loop` alone does not resume it — a browser only
        // auto-restarts a video on `ended` if `.loop` was ALREADY true at
        // that moment, not retroactively. Explicitly rewinding before
        // play() is what actually un-freezes it, rather than leaving a
        // dead last frame on screen with Paused (still broken until this
        // same fix) as the only apparent way to recover it.
        if (el.ended) el.currentTime = 0;
        void el.play().catch(() => {});
      }
    }
  }

  play(): void {
    this.paused = false;
    if (this.el instanceof HTMLVideoElement) void this.el.play().catch(() => {});
  }

  pause(): void {
    this.paused = true;
    if (this.el instanceof HTMLVideoElement) this.el.pause();
  }

  seek(seconds: number): void {
    if (this.el instanceof HTMLVideoElement) this.el.currentTime = seconds;
  }

  getControlSchema(): ControlSchema | null {
    return this.schema;
  }

  /** Phase 4.96 — see AssetRenderer.getCanvas's doc. Correction from the
      Part 1 batch's original notes: `svg` mounts through the exact same
      `<img>` branch as `image` above (see mount()), not inline SVG DOM —
      so this covers image, svg, AND video, not just image/video. Capture
      works for all three; there's just no destination canvas yet to draw
      a composited result back onto (see lib/render/pool.ts's tick() doc
      on the same gap) — that's the remaining piece, not this accessor. */
  getCanvas(): HTMLImageElement | HTMLVideoElement | null {
    return this.el;
  }

  setParam(id: string, value: ParamValue): void {
    this.params[id] = value;
    this.applyStyle();
  }

  setParams(params: ParamState): void {
    this.params = { ...this.params, ...params };
    this.applyStyle();
  }

  emit(_event: string): void {}

  setQuality(_q: Quality): void {}

  async capture(opts: CaptureOpts = {}): Promise<Blob | null> {
    const el = this.el;
    if (!el) return null;

    const w = el instanceof HTMLVideoElement ? el.videoWidth : el.naturalWidth;
    const h = el instanceof HTMLVideoElement ? el.videoHeight : el.naturalHeight;
    if (!w || !h) return null;

    const scale = opts.scale ?? 1;
    const canvas = document.createElement('canvas');
    canvas.width = w * scale;
    canvas.height = h * scale;
    const ctx2d = canvas.getContext('2d');
    ctx2d?.drawImage(el, 0, 0, canvas.width, canvas.height);

    // Bake the tint into the exported file — without this, a snapshot's
    // downloaded PNG would silently drop the one appearance control that
    // actually works (see Blend mode's `disabled` doc for why it isn't
    // this one), which would read as the tint itself being broken.
    // 'color' is a standard globalCompositeOperation value and matches
    // the CSS mix-blend-mode applied on screen exactly, so what's
    // downloaded matches what was on the board.
    const amount = typeof this.params.tintAmount === 'number' ? this.params.tintAmount : 0;
    if (ctx2d && amount > 0) {
      const tint = (this.params.tint ?? { r: 1, g: 1, b: 1, a: 1 }) as RGBA;
      ctx2d.save();
      ctx2d.globalCompositeOperation = 'color';
      ctx2d.globalAlpha = Math.max(0, Math.min(1, amount));
      ctx2d.fillStyle = rgbaToCss({ ...tint, a: 1 });
      ctx2d.fillRect(0, 0, canvas.width, canvas.height);
      ctx2d.restore();
    }

    return new Promise((resolve) => canvas.toBlob(resolve, opts.type ?? 'image/png'));
  }

  get isPaused(): boolean {
    return this.paused;
  }

  dispose(): void {
    this.disposed = true;
    if (this.el instanceof HTMLVideoElement) {
      this.el.pause();
      this.el.removeAttribute('src');
      this.el.load();
    }
    this.el = null;
    this.tintEl = null;
    this.wrap?.remove();
    this.wrap = null;
  }
}

export function rgbaToCss(c: RGBA): string {
  return `rgba(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)}, ${c.a})`;
}
