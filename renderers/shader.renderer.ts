import type { Asset } from '@/types/asset';
import { resetEffectHistory } from '@/lib/gl/effects-compositor';
import type { ControlSchema, ParamState, ParamValue, RGBA } from './control-schema';
import { defaultsOf } from './control-schema';
import type { SourceSwapResult } from './types';
import { parseUniforms } from '@/lib/gl/parse-uniforms';
import { carryParams } from '@/lib/schema/carry';
import { getGLStage, glUnavailableReason, peekGLStage, type CompiledProgram, type UniformSetter } from '@/lib/gl/context-pool';
import { getTextureImage } from '@/lib/gl/texture-source';
import { getShapeCanvas, getShapeDepth, specKey, type ShapeSpec, type ShapeKey } from '@/lib/shape-source';
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
  private cardId: string | null = null;
  private ctx2d: CanvasRenderingContext2D | null = null;
  private compiled: CompiledProgram | null = null;
  private schema: ControlSchema | null = null;
  private params: ParamState = {};
  private quality: Quality = 'preview';
  private paused = false;
  private disposed = false;
  private pendingEvents: string[] = [];
  private seed = 0;

  /** Source + cache key, kept around so render() can recompile after a
      context loss — see compiledGeneration's doc below. */
  private source: string | null = null;
  private compileKey: string | null = null;
  /** The compile key of the last successful setSource() — the only key this instance may release. */
  private liveKey: string | null = null;
  /** The stage's `generation` at the time `compiled` was last produced.
      GLStage.generation only ticks on webglcontextrestored (see its doc);
      a mismatch here means this instance's `compiled` program handle
      predates the loss and is dead, even though nothing has told this
      instance so — WebGL doesn't throw on a stale handle, it silently
      no-ops, so this check is the only thing that catches it. */
  private compiledGeneration = -1;

  /** Ping-pong backbuffer for feedback shaders. Allocated lazily. */
  private backbuffer: HTMLCanvasElement | null = null;
  private backCtx: CanvasRenderingContext2D | null = null;
  private usesBackbuffer = false;

  /**
   * assetId -> poster URL, for resolving texture controls.
   *
   * Injected rather than read from the board store directly: renderers run
   * inside the pool with no React context and no store subscription, and
   * giving one a direct dependency on the board store would make it
   * untestable and couple the rendering layer to app state. The pool sets
   * this when it mounts a renderer.
   */
  textureSources: Record<string, string> = {};

  /**
   * `@trigger` vec2 uniforms: fire count + when it last fired. Written as
   * [count, secondsSinceFire] every frame so a shader can ease out of a fire
   * (Shapeshift's Re-cut snaps its shards back in over ~250 ms).
   */
  private triggers = new Map<string, { count: number; firedAt: number }>();
  /** Transient detector for `@trigger(toggleId)` beat auto-fire. */
  private beat = { baseline: 0, prev: 0, lastFire: 0 };

  /** `@shape` sampler state — see bindShape(). */
  private shape: {
    canvas: HTMLCanvasElement | null;
    shownKey: string | null;
    wantKey: string | null;
    wantSince: number;
  } = { canvas: null, shownKey: null, wantKey: null, wantSince: 0 };

  constructor(assetId: string) {
    this.assetId = assetId;
  }

  async mount(el: HTMLElement, asset: Asset, signal: AbortSignal): Promise<void> {
    this.cardId = asset.itemId;
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

    this.source = asset.source;
    this.compileKey = asset.id + ':' + (asset.updatedAt ?? '');
    this.compileFromSource(stage);

    this.usesBackbuffer = /\bu_prevFrame\b|\bu_backbuffer\b/.test(asset.source);
    this.schema = asset.schema ?? null;
    this.params = this.schema ? { ...defaultsOf(this.schema), ...(asset.params ?? {}) } : {};
  }

  /** Compiles (or fetches the cached program for) this shader's current
      source and records the stage generation it was compiled against.
      Shared by mount() and render()'s post-context-loss recompile so the
      two paths can't drift — same fallback-to-hazard-stripes behavior
      either way. */
  private compileFromSource(stage: NonNullable<ReturnType<typeof getGLStage>>): void {
    if (!this.source || !this.compileKey) return;

    const result = stage.compile(this.compileKey, this.source);

    if (!result.ok || !result.program) {
      this.error = result.error ?? 'Shader failed to compile';
      // Keep rendering: the error program draws hazard stripes, which reads
      // far better on a board than a dead black rectangle.
      this.compiled = stage.getErrorProgram();
    } else {
      this.compiled = result.program;
    }
    this.compiledGeneration = stage.generation;
  }

  /**
   * Hot-swap the fragment source. Compiles FIRST, off to the side: if the new
   * source doesn't compile the previous program keeps rendering, so a typo
   * mid-edit never blanks the preview. On success the program, the schema and
   * the parameter values all move together (values carried by id + kind).
   */
  async setSource(source: string): Promise<SourceSwapResult> {
    const stage = getGLStage();
    if (this.disposed || !this.canvas) return { ok: false, error: 'This shader is not mounted.' };
    if (!stage || stage.isLost) return { ok: false, error: glUnavailableReason() ?? 'WebGL2 is unavailable' };

    // compile() caches by key alone, so the key must change whenever the source does.
    const key = `${this.assetId}:live:${hashSource(source)}`;
    const result = stage.compile(key, source);
    if (!result.ok || !result.program) return { ok: false, error: result.error ?? 'Shader failed to compile' };

    const parsed = parseUniforms(source, { schemaId: this.schema?.id ?? `shader:${this.assetId}` });
    const retired = this.liveKey;

    this.source = source;
    this.compileKey = key;
    this.compiled = result.program;
    this.compiledGeneration = stage.generation;
    this.liveKey = key;
    this.error = null;
    this.usesBackbuffer = /\bu_prevFrame\b|\bu_backbuffer\b/.test(source);
    this.params = carryParams(this.schema, parsed.schema, this.params);
    this.schema = parsed.schema;
    if (this.cardId) resetEffectHistory(this.cardId);

    if (retired && retired !== key) stage.releaseProgram(retired);
    return {
      ok: true,
      schema: parsed.schema,
      warnings: parsed.warnings.filter((w) => w.level === 'warn').map((w) => ({ message: w.message, line: w.line, id: w.name })),
    };
  }

  render(ctx: RenderContext): void {
    if (this.disposed || this.paused || !this.compiled || !this.canvas || !this.ctx2d) return;

    const stage = getGLStage();
    if (!stage || stage.isLost) return;

    // The context came back from a loss since this instance last compiled
    // — `this.compiled` is a dead WebGLProgram handle at this point (see
    // compiledGeneration's doc). Recompile before touching it; textures
    // don't need the same treatment, since uploadTexture() already
    // recreates whatever key it's asked for lazily, every frame, in
    // applyReserved/applyParams below.
    if (stage.generation !== this.compiledGeneration) {
      this.compileFromSource(stage);
      if (!this.compiled) return;
    }

    const scale = this.quality === 'full' ? Math.min(ctx.pixelRatio, 2) : 1;

    /*
     * Clamp to the shared canvas BEFORE these values become u_resolution.
     *
     * They previously did not agree: stage.draw() clamped the viewport to
     * the stage's ceiling internally while u_resolution kept the unclamped
     * size, so on a retina display the enlarged view told shaders the
     * screen was 1800px wide while only 900px were actually drawn. Every
     * centred shader shifted into a corner — which is exactly what SDF
     * Sphere was doing. That agreement is preserved below.
     *
     * WHAT CHANGED: the clamp is now UNIFORM rather than per-axis, and it
     * clamps against the stage's live ceiling rather than a fixed
     * constant.
     *
     * Per-axis clamping quietly destroyed the aspect ratio of any
     * non-square region whose long edge exceeded the ceiling. A 3840x2160
     * fullscreen surface became a 900x900 SQUARE buffer, which was then
     * drawImage'd into a 16:9 canvas below — a 1.78x horizontal stretch on
     * every shader in fullscreen on a widescreen display, with
     * u_resolution additionally telling the shader its surface was square
     * so anything doing its own aspect correction compensated the wrong
     * way. Invisible in the enlarged panel (aspect-ratio: 1, so the region
     * is genuinely square there) and invisible on the card grid (nowhere
     * near the ceiling), which is why it survived this long.
     *
     * Scaling both axes by the same factor keeps the region's shape
     * whatever its size, and keeps u_resolution honest about it.
     */
    const stageMax = stage.maxDimension;
    const rawW = Math.max(1, Math.round(ctx.width * scale));
    const rawH = Math.max(1, Math.round(ctx.height * scale));
    const fit = Math.min(1, stageMax / Math.max(rawW, rawH));
    const w = Math.max(1, Math.round(rawW * fit));
    const h = Math.max(1, Math.round(rawH * fit));

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
      this.detectBeat(avg(ctx.audio, 0, 8));
    }

    const back = this.backbuffer
      // force: true — this canvas is the same object reference every
      // frame by design (captureBackbuffer mutates it in place), so the
      // cache's default "skip if the source reference is unchanged"
      // optimization would misread that as nothing to upload and freeze
      // the feedback effect after its first frame. See uploadTexture's
      // doc in context-pool.ts.
      ? stage.uploadTexture(`${this.assetId}:back`, this.backbuffer, { force: true })
      : stage.getFallbackTexture();
    if (back) {
      set('u_prevFrame', back);
      set('u_backbuffer', back);
    }
  }

  private applyParams(set: UniformSetter, stage: NonNullable<ReturnType<typeof getGLStage>>): void {
    if (!this.schema) return;

    this.bindShape(set, stage);

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
          /*
           * A texture control stores an asset id; the board resolves that to
           * that asset's poster URL and hands it over as `textureSources`.
           * Until an image has decoded (or if nothing is linked at all) this
           * falls back to a flat fill, which is what keeps sampler-driven
           * shaders rendering something coherent rather than sampling
           * garbage on their first few frames.
           */
          const assetId = typeof value === 'string' ? value : null;
          const url = assetId ? this.textureSources[assetId] : undefined;
          const image = url ? getTextureImage(url) : null;

          const tex = image
            ? stage.uploadTexture(`${this.assetId}:${control.id}`, image)
            : stage.getFallbackTexture();

          if (tex) set(binding.name, tex);
          break;
        }
        case 'trigger': {
          // Only `@trigger` vec2 uniforms reach here (a plain trigger has no
          // uniform binding and was skipped above).
          const t = this.triggers.get(binding.name);
          const age = t ? (performance.now() - t.firedAt) / 1000 : 1e4;
          set(binding.name, [t?.count ?? 0, Math.min(age, 1e4)]);
          break;
        }
        default:
          if (typeof value === 'number' || typeof value === 'boolean' || Array.isArray(value)) {
            set(binding.name, value as number | boolean | number[]);
          }
      }
    }
  }

  /**
   * Feeds a `@shape` sampler from Shape Source (lib/shape-source). The spec is
   * rebuilt from this tile's shape* params every frame (cheap: a string key),
   * but a NEW distance field is only requested once the key has been stable
   * for SHAPE_SETTLE_MS — so typing a word builds one shape, not one per
   * keystroke — and the previous shape keeps rendering until the new one is
   * ready, so the tile never blanks mid-edit.
   */
  private bindShape(set: UniformSetter, stage: NonNullable<ReturnType<typeof getGLStage>>): void {
    const control = this.schema?.controls.find(
      (c) => c.binding?.target === 'host' && c.binding.property.startsWith('shape:'),
    );
    if (!control || control.binding?.target !== 'host') return;
    const sampler = control.binding.property.slice('shape:'.length);

    const spec = this.shapeSpec();
    const key = specKey(spec);
    const now = performance.now();
    const st = this.shape;

    if (key !== st.wantKey) {
      st.wantKey = key;
      st.wantSince = now;
    }
    const settled = !st.canvas || now - st.wantSince >= SHAPE_SETTLE_MS;
    if (key !== st.shownKey && settled) {
      const canvas = getShapeCanvas(spec);
      if (canvas) {
        st.canvas = canvas;
        st.shownKey = key;
      }
    }

    const tex = st.canvas
      ? stage.uploadTexture(`${this.assetId}:shape:${sampler}`, st.canvas)
      : stage.getFallbackTexture();
    if (tex) set(sampler, tex);
    // `<sampler>Depth` (e.g. u_shapeDepth), if the shader declares it: the
    // shape's deepest inside distance, so depth effects normalise per shape.
    set(`${sampler}Depth`, st.canvas ? getShapeDepth(st.canvas) : 0);
  }

  private shapeSpec(): ShapeSpec {
    const p = this.params;
    const str = (id: string, d: string) => (typeof p[id] === 'string' ? (p[id] as string) : d);
    const num = (id: string, d: number) => (typeof p[id] === 'number' ? (p[id] as number) : d);
    const bool = (id: string, d: boolean) => (typeof p[id] === 'boolean' ? (p[id] as boolean) : d);

    switch (str('shapeSource', 'text')) {
      case 'upload': {
        const url = str('shapeFile', '');
        if (!url) return { kind: 'empty' };
        const key = str('shapeKey', 'auto');
        return {
          kind: 'file', url,
          key: (key === 'alpha' || key === 'luma' ? key : 'auto') as ShapeKey,
          threshold: num('shapeThreshold', 0.5),
          invert: bool('shapeKeyInvert', false),
        };
      }
      case 'library':
        return { kind: 'library', id: str('shapeLibrary', 'vessel') };
      default:
        return {
          kind: 'text',
          text: str('shapeText', ''),
          fontId: str('shapeFont', 'inter'),
          upper: bool('shapeUpper', true),
          justify: bool('shapeJustify', true),
          leading: num('shapeLeading', 0.92),
        };
    }
  }

  private fireTrigger(uniform: string): void {
    const t = this.triggers.get(uniform) ?? { count: 0, firedAt: 0 };
    t.count += 1;
    t.firedAt = performance.now();
    this.triggers.set(uniform, t);
  }

  /**
   * Bass transient -> fire every `@trigger(toggleId)` whose toggle is on.
   * Baseline-deviation, not ratio-to-peak (see BandAutoGain for why): a hit
   * is a rise well above the slow running level, with a cooldown so one kick
   * drum is one fire.
   */
  private detectBeat(bass: number): void {
    const b = this.beat;
    const now = performance.now();
    const rising = bass > b.prev;
    const onset = rising && bass > b.baseline * 1.35 + 0.04 && now - b.lastFire > BEAT_COOLDOWN_MS;
    b.baseline += (bass - b.baseline) * 0.03;
    b.prev = bass;
    if (!onset || !this.schema) return;

    let fired = false;
    for (const c of this.schema.controls) {
      if (c.kind !== 'trigger' || !c.autoFire || c.binding?.target !== 'uniform') continue;
      if (this.params[c.autoFire] !== true) continue;
      this.fireTrigger(c.binding.name);
      fired = true;
    }
    if (fired) b.lastFire = now;
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

  /** Phase 4.96 — see AssetRenderer.getCanvas's doc. Shader tiles already
      own a real `<canvas>` with the current frame drawn onto it every
      tick (render() above), so this is a plain accessor, not new work. */
  getCanvas(): HTMLCanvasElement | null {
    return this.canvas;
  }

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
    // `@trigger` uniforms dispatch as `trigger:<uniformName>`.
    else if (event.startsWith('trigger:')) this.fireTrigger(event.slice('trigger:'.length));
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
    // Free this asset's cached GL textures — the feedback backbuffer
    // (`<assetId>:back`) and any texture-linked control's image
    // (`<assetId>:<controlId>`). See GLStage.releaseTexture(): nothing
    // released these before, so every feedback/texture shader ever promoted
    // kept its texture resident on the GPU for the life of the tab.
    peekGLStage()?.releaseTexturesWithPrefix(`${this.assetId}:`);
    if (this.liveKey) peekGLStage()?.releaseProgram(this.liveKey);
    this.canvas?.remove();
    this.canvas = null;
    this.ctx2d = null;
    this.backbuffer = null;
    this.backCtx = null;
    this.compiled = null;
  }
}

/** Settle time before a changed shape source is rebuilt (typing debounce). */
const SHAPE_SETTLE_MS = 140;
/** Minimum gap between beat auto-fires. */
const BEAT_COOLDOWN_MS = 280;

function avg(data: Float32Array, from: number, to: number): number {
  let sum = 0;
  const end = Math.min(to, data.length);
  for (let i = from; i < end; i++) sum += data[i];
  return sum / Math.max(end - from, 1);
}

/** FNV-1a — a short, stable cache key for a source string. */
function hashSource(source: string): string {
  let h = 2166136261;
  for (let i = 0; i < source.length; i++) h = Math.imul(h ^ source.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}
