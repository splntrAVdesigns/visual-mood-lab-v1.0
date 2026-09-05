/**
 * Visual Mood Lab — the shared WebGL2 stage.
 *
 * ONE context for the whole application. Browsers cap you at roughly 8–16
 * live WebGL contexts and start silently killing the oldest, so a board of
 * forty shader cards cannot each own one.
 *
 * Instead: a single offscreen WebGL2 canvas renders each live shader in turn,
 * and each card's cheap 2D canvas blits the result with drawImage. That blit
 * is GPU-side and costs far less than a context switch — and context loss
 * stops being a per-card lottery.
 *
 * Location: lib/gl/context-pool.ts
 */

/**
 * The shared canvas is sized to the largest region any single card needs.
 * 1280 was wasteful: a 220px preview card only ever writes a 220px corner,
 * but the buffer allocation, and any full-surface work the driver does, was
 * paying for 1280x1280 regardless.
 *
 * That reasoning is still right, but the implementation it produced — a
 * single flat 900 constant clamping EVERY consumer — capped the focused and
 * fullscreen tile at the same ceiling as a 220px thumbnail. On a 4K display
 * that meant a 900px buffer stretched across 3840 CSS px, a 4.3x upscale,
 * which is the "resolution drops in fullscreen, worse on bigger screens"
 * report. The card-grid economy and the focused tile's sharpness were never
 * actually in tension: `draw()` sets `gl.viewport(0, 0, sw, sh)` per call,
 * so a preview card's fragment cost is set by its own size, not by how big
 * the shared canvas happens to be. Only the one-time buffer allocation
 * scales with the canvas.
 *
 * So the ceiling is now a floor plus on-demand growth instead of a cap:
 * start at STAGE_MIN_DIM (what a board of preview cards ever needs, and the
 * old constant's value, so a board-only session allocates exactly what it
 * did before), grow when a consumer genuinely asks for more, never shrink.
 */
export const STAGE_MIN_DIM = 900;

/**
 * Hard ceiling regardless of what the driver claims it can do. Drivers
 * routinely report MAX_TEXTURE_SIZE of 8192-16384 while being unhappy about
 * actually allocating one, and past 4096 there's nothing left to gain for
 * this product anyway — a 4096 buffer is already native resolution on
 * everything short of a 5K panel, and beyond that the upscale is small
 * enough to be invisible. Capping here rather than trusting the driver
 * keeps the "one large one-shot allocation" risk (the confirmed cause of
 * CONTEXT_LOST_WEBGL on retina fullscreen — see §15 of the implementation
 * plan) bounded to something known-safe rather than open-ended.
 */
const STAGE_ABSOLUTE_MAX_DIM = 4096;

/**
 * Growth granularity. Rounding the target up means a slow drag-resize
 * produces one or two reallocations rather than dozens of near-identical
 * ones — and repeated large reallocations, more than any single big one,
 * are what actually provokes a driver into dropping the context.
 */
const STAGE_GROWTH_STEP = 256;

export interface CompiledProgram {
  program: WebGLProgram;
  uniforms: Map<string, WebGLUniformLocation>;
  /** Declared GLSL type per uniform, so setUniform can dispatch. */
  types: Map<string, string>;
}

export interface CompileResult {
  ok: boolean;
  program: CompiledProgram | null;
  error: string | null;
}

const VERTEX_SHADER = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

/** Fallback so a broken shader shows diagonal hazard stripes, not a blank card. */
const ERROR_SHADER = `#version 300 es
precision mediump float;
uniform vec2 u_resolution;
out vec4 fragColor;
void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float s = step(0.5, fract((uv.x + uv.y) * 6.0));
  fragColor = vec4(mix(vec3(0.06), vec3(0.35, 0.05, 0.05), s), 1.0);
}`;

export class GLStage {
  readonly canvas: HTMLCanvasElement;
  readonly gl: WebGL2RenderingContext;

  private vao: WebGLVertexArrayObject | null = null;
  private programs = new Map<string, CompiledProgram>();
  private textures = new Map<string, WebGLTexture>();
  private errorProgram: CompiledProgram | null = null;
  private lost = false;
  /**
   * Bumped every time the context comes back from a loss. Textures
   * self-heal for free — uploadTexture() lazily recreates whatever key it's
   * asked for, and every renderer already calls it every frame — but a
   * compiled WebGLProgram handle does not: the ShaderRenderer holding it
   * has no way to know its `compiled` reference went stale the instant
   * `programs.clear()` ran below, and WebGL silently no-ops draw calls
   * against a dead program rather than throwing, so nothing in the render
   * loop's own try/catch would ever catch it either. Renderers compare
   * this against the generation they last compiled against (see
   * shader.renderer.ts's `render()`) and recompile on mismatch — the
   * actual fix for shader tiles going blank and staying blank after a
   * context loss (GPU driver reset, laptop sleep/wake, mobile Safari
   * reclaiming contexts) until manually scrolled off-screen and back.
   */
  private gen = 0;

  /**
   * Current shared-canvas dimensions. Each axis grows independently and
   * neither ever shrinks.
   *
   * Per-axis rather than a single square edge because the regions that
   * actually need the headroom are widescreen: a square stage sized for a
   * 3840-wide fullscreen surface would be 3840x3840 (~59MB of drawing
   * buffer) to serve a 3840x2160 region (~35MB). The square was harmless
   * when the edge was 900; at fullscreen sizes it is not.
   */
  private dimW = STAGE_MIN_DIM;
  private dimH = STAGE_MIN_DIM;

  /**
   * Upper bound this device has actually proven it can handle. Starts at
   * whatever the driver's own limits allow (capped by
   * STAGE_ABSOLUTE_MAX_DIM) and is lowered permanently if a growth attempt
   * turns out to kill the context — so a machine that can't take the jump
   * pays for the discovery exactly once per session instead of retrying the
   * same doomed allocation on every promote.
   */
  private maxDim = STAGE_ABSOLUTE_MAX_DIM;

  get generation(): number {
    return this.gen;
  }

  /**
   * The largest square edge this stage will ever grow to. Consumers clamp
   * their requested region against this rather than against a module
   * constant, so the clamp reflects what this specific device can do.
   */
  get maxDimension(): number {
    return this.maxDim;
  }

  /** Current shared-canvas dimensions. Exposed mainly for diagnostics. */
  get dimensions(): { width: number; height: number } {
    return { width: this.dimW, height: this.dimH };
  }

  /**
   * Grows the shared canvas so a `w` x `h` region can be rendered at full
   * resolution. No-op when it already fits, which is every call on a board
   * of preview cards.
   *
   * Called from draw() rather than left to each consumer: the compositor
   * (lib/gl/effects-compositor.ts) and any future consumer render through
   * the same entry point, and making capacity a property of "something is
   * about to be drawn at this size" rather than something each caller has
   * to remember means there is no way to add a consumer that silently gets
   * clamped down to the floor.
   */
  ensureCapacity(w: number, h: number): { width: number; height: number } {
    const current = { width: this.dimW, height: this.dimH };
    if (!Number.isFinite(w) || !Number.isFinite(h)) return current;
    if (w <= this.dimW && h <= this.dimH) return current;

    const align = (v: number, floor: number) =>
      Math.min(this.maxDim, Math.max(floor, Math.ceil(v / STAGE_GROWTH_STEP) * STAGE_GROWTH_STEP));

    // Never shrink either axis: a card drawn after a fullscreen session
    // must not force a reallocation back down, both because reallocation
    // is the risky operation and because the next promote would just grow
    // it again.
    const targetW = Math.max(this.dimW, align(w, STAGE_MIN_DIM));
    const targetH = Math.max(this.dimH, align(h, STAGE_MIN_DIM));
    if (targetW === this.dimW && targetH === this.dimH) return current;

    const previousW = this.dimW;
    const previousH = this.dimH;
    try {
      this.canvas.width = targetW;
      this.canvas.height = targetH;
      // Resizing a canvas backed by a live WebGL context reallocates the
      // drawing buffer while leaving programs, textures and the VAO intact
      // — those are context state, not surface state, so nothing needs
      // recompiling here. What it CAN do on a constrained GPU is fail, and
      // WebGL reports that by losing the context rather than throwing, so
      // the explicit check matters more than the try/catch does.
      if (this.gl.isContextLost()) throw new Error('context lost while growing shared stage');
      this.dimW = targetW;
      this.dimH = targetH;
    } catch {
      // Roll back to the last size known to work and never attempt to
      // exceed it again this session. The webglcontextrestored handler
      // below takes care of rebuilding state if the context did actually
      // drop; this just makes sure we don't immediately walk into the same
      // allocation a frame later.
      this.canvas.width = previousW;
      this.canvas.height = previousH;
      this.dimW = previousW;
      this.dimH = previousH;
      this.maxDim = Math.max(STAGE_MIN_DIM, Math.max(previousW, previousH));
    }
    return { width: this.dimW, height: this.dimH };
  }

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = STAGE_MIN_DIM;
    this.canvas.height = STAGE_MIN_DIM;

    const gl = this.canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      /*
       * preserveDrawingBuffer was TRUE here, and it was the single biggest
       * cause of stuttering on the board. It forces the browser to keep a
       * full copy of the drawing buffer every frame and disables compositor
       * optimisations, which costs a full-surface copy per card per frame.
       *
       * It is not needed: ShaderRenderer.render() calls stage.draw() and
       * then drawImage() synchronously within the same requestAnimationFrame
       * callback, so the buffer has not been presented or cleared yet. The
       * blit reads valid pixels without it.
       */
      preserveDrawingBuffer: false,
      desynchronized: true,
      powerPreference: 'high-performance',
    });

    if (!gl) throw new Error('WebGL2 is not available in this browser.');
    this.gl = gl;

    // Narrow the growth ceiling to what this driver actually reports it can
    // allocate. Both limits matter: the drawing buffer is bounded by
    // MAX_RENDERBUFFER_SIZE, and the compositor uploads this same canvas
    // back as a texture, which is bounded by MAX_TEXTURE_SIZE. Either
    // parameter can come back 0 or undefined on an unusual driver, hence
    // the fallbacks — an unreadable limit means "use the absolute cap",
    // not "use zero".
    const maxRenderbuffer = Number(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE)) || 0;
    const maxTexture = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || 0;
    const reported = Math.min(
      maxRenderbuffer || STAGE_ABSOLUTE_MAX_DIM,
      maxTexture || STAGE_ABSOLUTE_MAX_DIM,
    );
    this.maxDim = Math.max(STAGE_MIN_DIM, Math.min(STAGE_ABSOLUTE_MAX_DIM, reported));

    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.lost = true;
      this.programs.clear();
      this.textures.clear();
      this.lastTextureSource.clear();
      this.errorProgram = null;
    });

    this.canvas.addEventListener('webglcontextrestored', () => {
      this.lost = false;
      this.vao = null;
      this.initQuad();
      this.gen++;
    });

    this.initQuad();
  }

  get isLost(): boolean {
    return this.lost || this.gl.isContextLost();
  }

  private initQuad(): void {
    const { gl } = this;
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  }

  /* ---------------------------------------------------------------- *
   * Program cache
   * ---------------------------------------------------------------- */

  /**
   * Compiles and caches by source hash. Two board items sharing one shader —
   * the whole point of param snapshots — compile it once.
   */
  compile(key: string, fragSource: string): CompileResult {
    const cached = this.programs.get(key);
    if (cached) return { ok: true, program: cached, error: null };

    const { gl } = this;
    const vs = this.compileStage(gl.VERTEX_SHADER, VERTEX_SHADER);
    if (typeof vs === 'string') return { ok: false, program: null, error: vs };

    const fs = this.compileStage(gl.FRAGMENT_SHADER, patchSource(fragSource));
    if (typeof fs === 'string') {
      gl.deleteShader(vs);
      return { ok: false, program: null, error: fs };
    }

    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.bindAttribLocation(program, 0, 'aPos');
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program) ?? 'Link failed';
      gl.deleteProgram(program);
      return { ok: false, program: null, error: log.trim() };
    }

    const compiled = this.introspect(program, fragSource);
    this.programs.set(key, compiled);
    return { ok: true, program: compiled, error: null };
  }

  private compileStage(kind: number, source: string): WebGLShader | string {
    const { gl } = this;
    const shader = gl.createShader(kind);
    if (!shader) return 'Could not create shader';

    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader) ?? 'Compile failed';
      gl.deleteShader(shader);
      return formatShaderError(log, source);
    }
    return shader;
  }

  private introspect(program: WebGLProgram, source: string): CompiledProgram {
    const { gl } = this;
    const uniforms = new Map<string, WebGLUniformLocation>();
    const types = new Map<string, string>();

    const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number;
    for (let i = 0; i < count; i++) {
      const info = gl.getActiveUniform(program, i);
      if (!info) continue;
      const name = info.name.replace(/\[0\]$/, '');
      const loc = gl.getUniformLocation(program, name);
      if (loc) uniforms.set(name, loc);
    }

    // GL reports numeric types; the declared name is easier to dispatch on.
    const declRe = /\buniform\s+(?:(?:highp|mediump|lowp)\s+)?(\w+)\s+([^;]+);/g;
    let m: RegExpExecArray | null;
    while ((m = declRe.exec(source)) !== null) {
      for (const part of m[2].split(',')) {
        const name = part.trim().replace(/\[\d*\]/, '').split('=')[0].trim();
        if (name) types.set(name, m[1]);
      }
    }

    return { program, uniforms, types };
  }

  getErrorProgram(): CompiledProgram | null {
    if (this.errorProgram) return this.errorProgram;
    const res = this.compile('__error__', ERROR_SHADER);
    this.errorProgram = res.program;
    return this.errorProgram;
  }

  /* ---------------------------------------------------------------- *
   * Textures
   * ---------------------------------------------------------------- */

  /** Last source handed to uploadTexture() per key, by reference. Lets a
      static texture-linked control skip its texImage2D re-upload on every
      one of the ~60 frames/sec it's unchanged — see uploadTexture's doc. */
  private lastTextureSource = new Map<string, TexImageSource>();

  /**
   * Uploads `source` to the texture cached at `key`, creating it on first
   * use. By default, skips the actual `texImage2D` call when `source` is
   * reference-identical to what this key was last uploaded — the common
   * case for a texture control linked to a static poster image, which was
   * otherwise being re-uploaded at full resolution on every single frame
   * for no reason, whether or not it had actually changed.
   *
   * `force: true` opts out for feedback-shader backbuffers: those pass the
   * exact same HTMLCanvasElement object every frame by design (only its
   * pixel content changes, via drawImage in captureBackbuffer), so
   * reference equality alone would wrongly look "unchanged" and the
   * feedback effect would freeze after its first frame.
   */
  uploadTexture(key: string, source: TexImageSource, opts?: { force?: boolean }): WebGLTexture | null {
    const { gl } = this;
    let tex = this.textures.get(key) ?? null;

    if (tex && !opts?.force && this.lastTextureSource.get(key) === source) {
      return tex;
    }

    if (!tex) {
      tex = gl.createTexture();
      if (!tex) return null;
      this.textures.set(key, tex);
    }

    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    this.lastTextureSource.set(key, source);
    return tex;
  }

  /** 1x1 mid-grey, bound wherever a sampler has no asset linked yet. */
  private fallbackTexture: WebGLTexture | null = null;

  getFallbackTexture(): WebGLTexture | null {
    if (this.fallbackTexture) return this.fallbackTexture;
    const { gl } = this;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
      new Uint8Array([40, 40, 46, 255]),
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    this.fallbackTexture = tex;
    return tex;
  }

  /* ---------------------------------------------------------------- *
   * Draw
   * ---------------------------------------------------------------- */

  /**
   * Renders one full-viewport triangle at (w, h) in the bottom-left of the
   * shared canvas, then hands back the region for the caller to blit.
   */
  draw(
    compiled: CompiledProgram,
    w: number,
    h: number,
    apply: (set: UniformSetter) => void,
  ): { sx: number; sy: number; sw: number; sh: number } {
    const { gl } = this;

    // Grow first, then clamp — so the clamp below is against the size we
    // actually just secured rather than a fixed constant. On a board of
    // preview cards this is a no-op comparison and the canvas stays at
    // STAGE_MIN_DIM exactly as before.
    const capacity = this.ensureCapacity(Math.round(w), Math.round(h));

    const sw = Math.max(1, Math.min(Math.round(w), capacity.width));
    const sh = Math.max(1, Math.min(Math.round(h), capacity.height));

    gl.useProgram(compiled.program);
    gl.bindVertexArray(this.vao);
    gl.viewport(0, 0, sw, sh);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);

    apply(makeSetter(gl, compiled));

    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);

    // GL's origin is bottom-left; the canvas image origin is top-left, so the
    // rendered region lives at the bottom of the shared canvas.
    return { sx: 0, sy: this.canvas.height - sh, sw, sh };
  }

  dispose(): void {
    const { gl } = this;
    for (const p of this.programs.values()) gl.deleteProgram(p.program);
    for (const t of this.textures.values()) gl.deleteTexture(t);
    this.programs.clear();
    this.textures.clear();
    this.lastTextureSource.clear();
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}

/* ------------------------------------------------------------------ *
 * Uniform dispatch
 * ------------------------------------------------------------------ */

export type UniformValue = number | boolean | number[] | WebGLTexture;

export interface UniformSetter {
  (name: string, value: UniformValue): void;
}

function makeSetter(gl: WebGL2RenderingContext, compiled: CompiledProgram): UniformSetter {
  let textureUnit = 0;

  return (name, value) => {
    const loc = compiled.uniforms.get(name);
    if (!loc) return;

    const type = compiled.types.get(name) ?? '';

    if (type.startsWith('sampler')) {
      gl.activeTexture(gl.TEXTURE0 + textureUnit);
      gl.bindTexture(gl.TEXTURE_2D, value as WebGLTexture);
      gl.uniform1i(loc, textureUnit);
      textureUnit++;
      return;
    }

    if (typeof value === 'boolean') {
      gl.uniform1i(loc, value ? 1 : 0);
      return;
    }

    if (typeof value === 'number') {
      if (type === 'int' || type === 'uint' || type === 'bool') gl.uniform1i(loc, Math.round(value));
      else gl.uniform1f(loc, value);
      return;
    }

    if (Array.isArray(value)) {
      const isInt = type.startsWith('i') || type.startsWith('u') || type.startsWith('b');
      switch (value.length) {
        case 2: isInt ? gl.uniform2iv(loc, value) : gl.uniform2fv(loc, value); break;
        case 3: isInt ? gl.uniform3iv(loc, value) : gl.uniform3fv(loc, value); break;
        case 4: isInt ? gl.uniform4iv(loc, value) : gl.uniform4fv(loc, value); break;
        default: if (value.length === 1) gl.uniform1fv(loc, value); break;
      }
    }
  };
}

/* ------------------------------------------------------------------ *
 * Source patching
 * ------------------------------------------------------------------ */

/**
 * Seed shaders declare `out vec4 fragColor`. Shadertoy-style pastes use
 * `mainImage` and `gl_FragColor`. Normalising here means both work without
 * the author thinking about it.
 */
function patchSource(source: string): string {
  let out = source;

  if (!/#version/.test(out)) {
    out = `#version 300 es\nprecision highp float;\n${out}`;
  }

  if (/\bmainImage\s*\(/.test(out) && !/\bvoid\s+main\s*\(/.test(out)) {
    out += `
out vec4 fragColor;
void main() { mainImage(fragColor, gl_FragCoord.xy); }`;
  }

  if (/gl_FragColor/.test(out) && !/\bout\s+vec4\b/.test(out)) {
    out = out.replace(/gl_FragColor/g, 'fragColor');
    out = out.replace(/(precision[^;]+;)/, '$1\nout vec4 fragColor;');
  }

  return out;
}

/** Turns a raw GLSL log into something with the offending line in it. */
function formatShaderError(log: string, source: string): string {
  const lines = source.split('\n');
  return log
    .trim()
    .split('\n')
    .slice(0, 4)
    .map((entry) => {
      const m = /^\w+:\s*\d+:(\d+):/.exec(entry);
      if (!m) return entry;
      const lineNo = Number(m[1]);
      const src = lines[lineNo - 1]?.trim();
      return src ? `${entry}\n    ${lineNo} | ${src}` : entry;
    })
    .join('\n');
}

/* ------------------------------------------------------------------ *
 * Singleton
 * ------------------------------------------------------------------ */

let stage: GLStage | null = null;
let failure: string | null = null;

export function getGLStage(): GLStage | null {
  if (stage) return stage;
  if (failure) return null;
  try {
    stage = new GLStage();
    return stage;
  } catch (err) {
    failure = err instanceof Error ? err.message : String(err);
    return null;
  }
}

export function glUnavailableReason(): string | null {
  return failure;
}
