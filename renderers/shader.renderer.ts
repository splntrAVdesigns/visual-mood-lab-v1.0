import type { Asset } from '@/types/asset';
import type { ControlSchema, ParamState, ParamValue, RGBA } from './control-schema';
import { defaultsOf } from './control-schema';
import { getGLStage, glUnavailableReason, MAX_DIM, type CompiledProgram, type UniformSetter } from '@/lib/gl/context-pool';
import type { AssetRenderer, CaptureOpts, Quality, RenderContext } from './types';

/**
 * Renders a GLSL fragment shader through the shared WebGL2 stage and blits
 * the result onto its own 2D canvas.
 *
 * Two things this deliberately does NOT do: own a WebGL context (see
 * context-pool for why), and own an animation loop (the pool drives it).
 */
export class ShaderRenderer implements AssetRenderer {
  readonly type = 'shader' as const;
  readonly assetId: string;

  error: string | null = null;

  private canvas: HTMLCanvasElement | null = null;
  private ctx2d: CanvasRenderingContext2D | null = null;
  private compiled: CompiledProgram | null = null;
  private schema: ControlSchema | null = null;
  private params: ParamState = {};
  private quality: Quality = 'preview';
  private paused = false;
  private disposed = false;
  private pendingEvents: string[] = [];
  private seed = 0;

  /** Ping-pong backbuffer for feedback shaders. Allocated lazily. */
  private backbuffer: HTMLCanvasElement | null = null;
  private backCtx: CanvasRenderingContext2D | null = null;
  private usesBackbuffer = false;

  constructor(assetId: string) {
    this.assetId = assetId;
  }

  async mount(el: HTMLElement, asset: Asset, signal: AbortSignal): Promise<void> {
    const stage = getGLStage();
    if (!stage) {
      this.error = glUnavailableReason() ?? 'WebGL2 unavailable';
      return;
    }

    if (!asset.source) {
      this.error = 'Shader has no source';
      return;
    }

    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'width:100%;height:100%;display:block';
    this.canvas = canvas;
    this.ctx2d = canvas.getContext('2d', { alpha: false });

    if (signal.aborted) return;
    el.appendChild(canvas);

    const result = stage.compile(asset.id + ':' + (asset.updatedAt ?? ''), asset.source);

    if (!result.ok || !result.program) {
      this.error = result.error ?? 'Shader failed to compile';
      // Keep rendering: the error program draws hazard stripes, which reads
      // far better on a board than a dead black rectangle.
      this.compiled = stage.getErrorProgram();
    } else {
      this.compiled = result.program;
    }

    this.usesBackbuffer = /\bu_prevFrame\b|\bu_backbuffer\b/.test(asset.source);
    this.schema = asset.schema ?? null;
    this.params = this.schema ? { ...defaultsOf(this.schema), ...(asset.params ?? {}) } : {};
  }

  render(ctx: RenderContext): void {
    if (this.disposed || this.paused || !this.compiled || !this.canvas || !this.ctx2d) return;

    const stage = getGLStage();
    if (!stage || stage.isLost) return;

    const scale = this.quality === 'full' ? Math.min(ctx.pixelRatio, 2) : 1;

    /*
     * Clamp to the shared canvas BEFORE these values become u_resolution.
     *
     * They previously did not agree: stage.draw() clamped the viewport to
     * MAX_DIM internally while u_resolution kept the unclamped size, so on a
     * retina display the enlarged view told shaders the screen was 1800px
     * wide while only 900px were actually drawn. Every centred shader
     * shifted into a corner — which is exactly what SDF Sphere was doing.
     */
    const w = Math.max(1, Math.min(Math.round(ctx.width * scale), MAX_DIM));
    const h = Math.max(1, Math.min(Math.round(ctx.height * scale), MAX_DIM));

    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }

    const region = stage.draw(this.compiled, w, h, (set) => {
      this.applyReserved(set, ctx, w, h, stage);
      this.applyParams(set, stage);
    });

    const c2 = this.ctx2d;
    c2.save();
    // GL renders y-up; the canvas image is y-down. Flip on the way out so
    // shaders behave the way their authors expect.
    c2.setTransform(1, 0, 0, -1, 0, this.canvas.height);
    c2.drawImage(
      stage.canvas,
      region.sx, region.sy, region.sw, region.sh,
      0, 0, this.canvas.width, this.canvas.height,
    );
    c2.restore();

    if (this.usesBackbuffer) this.captureBackbuffer();
    this.pendingEvents.length = 0;
  }

  private applyReserved(
    set: UniformSetter,
    ctx: RenderContext,
    w: number,
    h: number,
    stage: NonNullable<ReturnType<typeof getGLStage>>,
  ): void {
    set('u_time', ctx.time);
    set('iTime', ctx.time);
    set('u_delta', ctx.delta);
    set('iTimeDelta', ctx.delta);
    set('u_frame', ctx.frame);
    set('iFrame', ctx.frame);
    set('u_resolution', [w, h]);
    set('iResolution', [w, h, 1]);
    set('u_mouse', [ctx.pointer.x * w, ctx.pointer.y * h]);
    set('iMouse', [ctx.pointer.x * w, ctx.pointer.y * h, ctx.pointer.down ? 1 : 0, 0]);
    set('u_pixelRatio', ctx.pixelRatio);
    set('u_aspect', w / Math.max(h, 1));
    set('u_seed', this.seed);

    // Lets a sampler-driven shader generate its own pattern when nothing is
    // linked. Without this, ASCII Mosaic and friends sampled a 1x1 grey
    // fallback, quantised it to a single flat level, and rendered pure black.
    set('u_hasSource', this.hasLinkedSource());

    if (ctx.audio) {
      set('u_bass', avg(ctx.audio, 0, 8));
      set('u_mid', avg(ctx.audio, 8, 32));
      set('u_high', avg(ctx.audio, 32, 64));
      set('u_rms', avg(ctx.audio, 0, 64));
    }

    const back = this.backbuffer
      ? stage.uploadTexture(`${this.assetId}:back`, this.backbuffer)
      : stage.getFallbackTexture();
    if (back) {
      set('u_prevFrame', back);
      set('u_backbuffer', back);
    }
  }

  private applyParams(set: UniformSetter, stage: NonNullable<ReturnType<typeof getGLStage>>): void {
    if (!this.schema) return;

    for (const control of this.schema.controls) {
      const binding = control.binding;
      if (!binding || binding.target !== 'uniform') continue;

      const value = this.params[control.id];

      switch (control.kind) {
        case 'color': {
          const c = (value ?? control.default) as RGBA;
          const isVec4 = binding.glslType === 'vec4';
          set(binding.name, isVec4 ? [c.r, c.g, c.b, c.a] : [c.r, c.g, c.b]);
          break;
        }
        case 'select': {
          const raw = typeof value === 'string' ? value : control.default;
          set(binding.name, control.valueType === 'number' ? Number(raw) : 0);
          break;
        }
        case 'texture': {
          // Phase 3 resolves this to a real asset; until then, a flat fill so
          // sampler-driven shaders still render something coherent.
          const tex = stage.getFallbackTexture();
          if (tex) set(binding.name, tex);
          break;
        }
        case 'trigger':
          break;
        default:
          if (typeof value === 'number' || typeof value === 'boolean' || Array.isArray(value)) {
            set(binding.name, value as number | boolean | number[]);
          }
      }
    }
  }

  /** True once a texture control actually points at an asset. */
  private hasLinkedSource(): boolean {
    if (!this.schema) return false;
    return this.schema.controls.some(
      (c) => c.kind === 'texture' && typeof this.params[c.id] === 'string',
    );
  }

  private captureBackbuffer(): void {
    if (!this.canvas) return;

    if (!this.backbuffer) {
      this.backbuffer = document.createElement('canvas');
      this.backCtx = this.backbuffer.getContext('2d', { alpha: false });
    }
    if (!this.backCtx) return;

    if (
      this.backbuffer.width !== this.canvas.width ||
      this.backbuffer.height !== this.canvas.height
    ) {
      this.backbuffer.width = this.canvas.width;
      this.backbuffer.height = this.canvas.height;
    }

    this.backCtx.drawImage(this.canvas, 0, 0);
  }

  play(): void { this.paused = false; }
  pause(): void { this.paused = true; }

  getControlSchema(): ControlSchema | null { return this.schema; }

  setParam(id: string, value: ParamValue): void {
    this.params[id] = value;
  }

  setParams(params: ParamState): void {
    this.params = { ...this.params, ...params };
  }

  emit(event: string): void {
    this.pendingEvents.push(event);
    // Bumping the seed is what a shader-side "reseed" actually means.
    if (event === 'reseed') this.seed = Math.random() * 1000;
  }

  setQuality(q: Quality): void { this.quality = q; }

  async capture(opts: CaptureOpts = {}): Promise<Blob | null> {
    if (!this.canvas) return null;
    return new Promise((resolve) =>
      this.canvas!.toBlob((b) => resolve(b), opts.type ?? 'image/png'),
    );
  }

  dispose(): void {
    this.disposed = true;
    this.canvas?.remove();
    this.canvas = null;
    this.ctx2d = null;
    this.backbuffer = null;
    this.backCtx = null;
    this.compiled = null;
  }
}

function avg(data: Float32Array, from: number, to: number): number {
  let sum = 0;
  const end = Math.min(to, data.length);
  for (let i = from; i < end; i++) sum += data[i];
  return sum / Math.max(end - from, 1);
}
