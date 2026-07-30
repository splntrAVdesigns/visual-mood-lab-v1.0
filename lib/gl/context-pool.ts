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
 */
export const MAX_DIM = 900;

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

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = MAX_DIM;
    this.canvas.height = MAX_DIM;

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

    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.lost = true;
      this.programs.clear();
      this.textures.clear();
      this.errorProgram = null;
    });

    this.canvas.addEventListener('webglcontextrestored', () => {
      this.lost = false;
      this.vao = null;
      this.initQuad();
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

  uploadTexture(key: string, source: TexImageSource): WebGLTexture | null {
    const { gl } = this;
    let tex = this.textures.get(key) ?? null;

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
    const sw = Math.max(1, Math.min(Math.round(w), MAX_DIM));
    const sh = Math.max(1, Math.min(Math.round(h), MAX_DIM));

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
