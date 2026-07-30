import type { Asset, AssetType } from '@/types/asset';
import type { ControlSchema, ParamState, ParamValue, RGBA } from './control-schema';
import { defaultsOf, withBaseControls } from './control-schema';
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

  private el: HTMLImageElement | HTMLVideoElement | null = null;
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

    this.schema = asset.schema ?? withBaseControls(asset.id, [], {
      omit: this.type === 'video' ? [] : ['speed', 'loop', 'paused'],
    });
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
    host.appendChild(el);
    this.applyStyle();
  }

  render(_ctx: RenderContext): void {
    // Images and video are driven by the browser, not by our loop. Style is
    // only reapplied when a param actually changes.
  }

  private applyStyle(): void {
    const el = this.el;
    if (!el || !this.schema) return;

    const num = (id: string, fallback: number) => {
      const v = this.params[id];
      return typeof v === 'number' ? v : fallback;
    };

    const offset = this.params.offset;
    const [ox, oy] = Array.isArray(offset) ? offset : [0, 0];

    el.style.opacity = String(num('opacity', 1));
    el.style.mixBlendMode = String(this.params.blendMode ?? 'normal');
    el.style.transform = [
      `translate(${(ox as number) * 100}%, ${(oy as number) * 100}%)`,
      `scale(${num('scale', 1)})`,
      `rotate(${num('rotation', 0)}deg)`,
    ].join(' ');

    if (el instanceof HTMLVideoElement) {
      el.playbackRate = Math.max(0.0625, num('speed', 1));
      el.loop = this.params.loop !== false;
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
    canvas.getContext('2d')?.drawImage(el, 0, 0, canvas.width, canvas.height);

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
    this.el?.remove();
    this.el = null;
  }
}

export function rgbaToCss(c: RGBA): string {
  return `rgba(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)}, ${c.a})`;
}
