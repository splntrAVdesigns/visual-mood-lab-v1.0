/**
 * Visual Mood Lab — GLSL uniform parser
 * -------------------------------------
 * Reads shader source, extracts uniform declarations plus their annotation
 * comments, and emits a ControlSchema. Run this once at ingest time and store
 * the result — never on every render.
 *
 * Annotation syntax (trailing comment, or comment lines directly above):
 *
 *   uniform float u_density;   // @label(Density) @range(1, 64) @default(12) @log
 *   uniform vec3  u_tint;      // @color @default(0.0, 0.83, 1.0)
 *   uniform int   u_mode;      // @select(Grid=0 | Halftone=1 | Dither=2)
 *   uniform vec2  u_center;    // @range(-1, 1) @group(Composition)
 *   uniform bool  u_invert;    // @default(true) @advanced
 *   uniform sampler2D u_src;   // @label(Source)
 *
 *   // @label(Warp amount) @range(0, 2) @mod
 *   uniform float u_warp;
 *
 * Supported annotations:
 *   @label(Text)          display name
 *   @group(Text)          drawer section
 *   @hint(Text)           help text
 *   @unit(px)             suffix on the numeric readout
 *   @range(min, max)      numeric bounds
 *   @default(a[, b, c])   initial value
 *   @step(n)              slider increment
 *   @select(A=0 | B=1)    render as a dropdown
 *   @strip                paired with @select: render as a compact button
 *                          strip instead (same visual language as the
 *                          Sound panel's rate/note strips) — best for a
 *                          small option set someone will tap directly
 *                          rather than open a dropdown for
 *   @color                force vec3/vec4 to a color picker
 *   @log                  logarithmic slider
 *   @advanced             hide behind the Advanced disclosure
 *   @hidden               parse but do not expose a control
 *   @mod / @nomod         force modulation eligibility on or off
 *
 * Location: lib/gl/parse-uniforms.ts
 */

import {
  type Control,
  type ControlSchema,
  type GlslType,
  type RGBA,
  type SelectOption,
  type Vec2,
  type Vec3,
  createSchema,
  BASE_GROUPS,
} from '../../renderers/control-schema';

/* ------------------------------------------------------------------ *
 * Public types
 * ------------------------------------------------------------------ */

export interface Annotations {
  label?: string;
  group?: string;
  hint?: string;
  unit?: string;
  range?: [number, number];
  default?: number[] | boolean | string;
  step?: number;
  select?: SelectOption[];
  color?: boolean;
  log?: boolean;
  advanced?: boolean;
  hidden?: boolean;
  mod?: boolean;
  /** Render a @select as a compact button strip instead of a dropdown —
      same visual language as the Sound panel's rate/note strips, for a
      small (≤6 or so) set of options where tapping directly is more
      natural than opening a dropdown. See SelectControl.displayStyle in
      control-schema.ts. */
  strip?: boolean;
}

export interface ParsedUniform {
  name: string;
  glslType: GlslType | string;
  /** Present for `uniform vec3 palette[5];` */
  arrayLength?: number;
  annotations: Annotations;
  /** 1-based line number of the declaration. */
  line: number;
  /** True when the name matched the reserved set (host-driven, no control). */
  reserved: boolean;
}

export interface ParseWarning {
  level: 'warn' | 'info';
  message: string;
  name?: string;
  line?: number;
}

export interface ParseResult {
  schema: ControlSchema;
  /** Everything found, including reserved and hidden uniforms. */
  uniforms: ParsedUniform[];
  warnings: ParseWarning[];
}

export interface ParseOptions {
  /** Schema id. Defaults to 'shader'. */
  schemaId?: string;
  /** Uniform names driven by the host, not the user. Replaces the default set. */
  reservedNames?: Iterable<string>;
  /** Extra reserved names on top of the defaults. */
  extraReserved?: Iterable<string>;
  /** Group assigned when no @group is given. Defaults to 'params'. */
  defaultGroup?: string;
  /** Sliders are modulatable unless @nomod. Set false to flip the default. */
  modulatableByDefault?: boolean;
}

/**
 * Uniforms the host feeds automatically — time, resolution, pointer, audio,
 * and the Shadertoy equivalents. These never become controls.
 */
export const DEFAULT_RESERVED = new Set([
  'u_time', 'u_delta', 'u_frame', 'u_resolution', 'u_mouse', 'u_pointer',
  'u_seed', 'u_pixelRatio', 'u_aspect', 'u_hasSource', 'u_prevFrame', 'u_backbuffer',
  'u_audio', 'u_audioTexture', 'u_bass', 'u_mid', 'u_high', 'u_rms', 'u_fft',
  'iTime', 'iTimeDelta', 'iFrame', 'iResolution', 'iMouse', 'iDate',
  'iChannel0', 'iChannel1', 'iChannel2', 'iChannel3', 'iChannelTime',
  'time', 'resolution', 'mouse',
]);

const KNOWN_TYPES = new Set<string>([
  'float', 'int', 'uint', 'bool',
  'vec2', 'vec3', 'vec4',
  'ivec2', 'ivec3', 'ivec4',
  'uvec2', 'uvec3', 'uvec4',
  'bvec2', 'bvec3', 'bvec4',
  'mat2', 'mat3', 'mat4',
  'mat2x3', 'mat2x4', 'mat3x2', 'mat3x4', 'mat4x2', 'mat4x3',
  'sampler2D', 'sampler3D', 'samplerCube', 'sampler2DArray',
]);

const UNSUPPORTED_TYPES = new Set<string>([
  'mat2', 'mat3', 'mat4',
  'mat2x3', 'mat2x4', 'mat3x2', 'mat3x4', 'mat4x2', 'mat4x3',
  'sampler3D', 'samplerCube', 'sampler2DArray',
]);

const COLOR_NAME = /(color|colour|tint|rgb|albedo|hue|palette|ink|paint)/i;

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

export function parseUniforms(source: string, opts: ParseOptions = {}): ParseResult {
  const warnings: ParseWarning[] = [];
  const reserved = new Set(opts.reservedNames ?? DEFAULT_RESERVED);
  for (const n of opts.extraReserved ?? []) reserved.add(n);

  const defaultGroup = opts.defaultGroup ?? 'params';
  const modDefault = opts.modulatableByDefault ?? true;

  const uniforms = extractUniforms(source, reserved, warnings);
  const controls: Control[] = [];
  const seen = new Set<string>();

  for (const u of uniforms) {
    if (seen.has(u.name)) {
      warnings.push({
        level: 'info', name: u.name, line: u.line,
        message: `Duplicate declaration of "${u.name}" — keeping the first.`,
      });
      continue;
    }
    seen.add(u.name);

    if (u.reserved) {
      // A uniform carrying control annotations (@label, @range, @color, ...)
      // is unambiguously meant to be a user control. If its name also
      // happens to collide with a reserved host name (u_time, u_mid, u_high,
      // ...) it is silently swallowed here and never assigned a value by the
      // renderer — which reads as the shader being broken, with no error
      // anywhere. This is exactly how Noise Field went solid black: its
      // "mid colour" and "high colour" uniforms collided with the audio-band
      // reserved names. Surface it loudly instead of losing it quietly.
      if (hasControlAnnotations(u.annotations)) {
        warnings.push({
          level: 'warn', name: u.name, line: u.line,
          message: `"${u.name}" has control annotations but collides with a reserved host uniform of the same name — it will never receive a value. Rename it.`,
        });
      }
      continue;
    }
    if (u.annotations.hidden) continue;

    const control = controlFor(u, { defaultGroup, modDefault }, warnings);
    if (control) controls.push(control);
  }

  const groups = [...BASE_GROUPS];
  for (const c of controls) {
    if (c.group && !groups.some((g) => g.id === c.group)) {
      groups.push({ id: c.group, label: titleCase(c.group), order: 40 + groups.length });
    }
  }

  return {
    schema: createSchema(opts.schemaId ?? 'shader', controls, { groups }),
    uniforms,
    warnings,
  };
}

/* ------------------------------------------------------------------ *
 * Lexing: comment-aware line scan
 * ------------------------------------------------------------------ */

interface SplitLine {
  code: string;
  comments: string[];
  inBlock: boolean;
}

/** Separate code from comments on one line, carrying block-comment state. */
function splitLine(line: string, inBlock: boolean): SplitLine {
  let code = '';
  const comments: string[] = [];
  let i = 0;

  while (i < line.length) {
    if (inBlock) {
      const end = line.indexOf('*/', i);
      if (end === -1) {
        comments.push(line.slice(i));
        return { code, comments, inBlock: true };
      }
      comments.push(line.slice(i, end));
      i = end + 2;
      inBlock = false;
      continue;
    }

    const lineStart = line.indexOf('//', i);
    const blockStart = line.indexOf('/*', i);

    if (lineStart === -1 && blockStart === -1) {
      code += line.slice(i);
      break;
    }

    if (blockStart === -1 || (lineStart !== -1 && lineStart < blockStart)) {
      code += line.slice(i, lineStart);
      comments.push(line.slice(lineStart + 2));
      break;
    }

    code += line.slice(i, blockStart);
    i = blockStart + 2;
    inBlock = true;
  }

  return { code, comments, inBlock };
}

function extractUniforms(
  source: string,
  reserved: Set<string>,
  warnings: ParseWarning[],
): ParsedUniform[] {
  const lines = source.split(/\r?\n/);
  const out: ParsedUniform[] = [];

  let inBlock = false;
  /** Annotation text from comment-only lines directly above a declaration. */
  let pending: string[] = [];
  /** Accumulator for declarations that span multiple lines. */
  let buffer = '';
  let bufferComments: string[] = [];
  let bufferLine = 0;

  for (let n = 0; n < lines.length; n++) {
    const { code, comments, inBlock: nextBlock } = splitLine(lines[n], inBlock);
    inBlock = nextBlock;

    const trimmed = code.trim();

    // Preprocessor lines are skipped, but do not clear pending annotations —
    // `#ifdef FOO` above a uniform is common and harmless here.
    if (trimmed.startsWith('#')) continue;

    if (buffer) {
      buffer += ' ' + trimmed;
      bufferComments.push(...comments);
      if (trimmed.includes(';')) {
        readDeclarations(buffer, bufferComments, bufferLine, reserved, out, warnings);
        buffer = '';
        bufferComments = [];
        pending = [];
      }
      continue;
    }

    if (/\buniform\b/.test(trimmed)) {
      bufferLine = n + 1;
      bufferComments = [...pending, ...comments];
      if (trimmed.includes(';')) {
        readDeclarations(trimmed, bufferComments, bufferLine, reserved, out, warnings);
        bufferComments = [];
        pending = [];
      } else {
        buffer = trimmed;
      }
      continue;
    }

    if (trimmed === '') {
      // A comment-only line accumulates; a truly blank line breaks the chain.
      if (comments.length) pending.push(...comments);
      else pending = [];
    } else {
      pending = [];
    }
  }

  if (buffer) {
    warnings.push({
      level: 'warn', line: bufferLine,
      message: 'Unterminated uniform declaration — missing semicolon.',
    });
  }

  return out;
}

const DECL_RE =
  /\buniform\b\s+(?:(?:highp|mediump|lowp|precise|invariant|flat|smooth)\s+)*([A-Za-z_]\w*)\s+([^;]+);/g;

const DECLARATOR_RE = /^([A-Za-z_]\w*)\s*(?:\[\s*(\d+)\s*\])?\s*(?:=\s*(.+))?$/;

function readDeclarations(
  code: string,
  comments: string[],
  line: number,
  reserved: Set<string>,
  out: ParsedUniform[],
  warnings: ParseWarning[],
): void {
  const annotations = parseAnnotations(comments.join(' '));
  DECL_RE.lastIndex = 0;

  let match: RegExpExecArray | null;
  let found = false;

  while ((match = DECL_RE.exec(code)) !== null) {
    found = true;
    const glslType = match[1];
    const declarators = splitTopLevel(match[2]);

    for (const raw of declarators) {
      const d = DECLARATOR_RE.exec(raw.trim());
      if (!d) {
        warnings.push({ level: 'warn', line, message: `Could not parse declarator "${raw.trim()}".` });
        continue;
      }
      const [, name, arrayLen] = d;
      out.push({
        name,
        glslType,
        arrayLength: arrayLen ? Number(arrayLen) : undefined,
        annotations,
        line,
        reserved: reserved.has(name),
      });
    }
  }

  if (!found) {
    warnings.push({ level: 'warn', line, message: `Unrecognised uniform syntax: "${code.trim()}".` });
  }
}

/** Split on commas that are not inside brackets or parens. */
function splitTopLevel(input: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of input) {
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current);
  return parts;
}

/* ------------------------------------------------------------------ *
 * Annotations
 * ------------------------------------------------------------------ */

const ANNOTATION_RE = /@(\w+)(?:\(([^)]*)\))?/g;

export function parseAnnotations(text: string): Annotations {
  const a: Annotations = {};
  if (!text.includes('@')) return a;

  ANNOTATION_RE.lastIndex = 0;
  let m: RegExpExecArray | null;

  while ((m = ANNOTATION_RE.exec(text)) !== null) {
    const key = m[1].toLowerCase();
    const arg = (m[2] ?? '').trim();

    switch (key) {
      case 'label': a.label = arg; break;
      case 'group': a.group = arg; break;
      case 'hint': a.hint = arg; break;
      case 'unit': a.unit = arg; break;
      case 'color': case 'colour': a.color = true; break;
      case 'log': a.log = true; break;
      case 'advanced': a.advanced = true; break;
      case 'hidden': a.hidden = true; break;
      case 'mod': a.mod = true; break;
      case 'nomod': a.mod = false; break;
      case 'strip': a.strip = true; break;
      case 'step': {
        const n = Number(arg);
        if (Number.isFinite(n)) a.step = n;
        break;
      }
      case 'range': case 'min_max': {
        const nums = arg.split(',').map((s) => Number(s.trim()));
        if (nums.length === 2 && nums.every(Number.isFinite)) {
          a.range = [nums[0], nums[1]];
        }
        break;
      }
      case 'default': case 'value': {
        if (/^(true|false)$/i.test(arg)) {
          a.default = arg.toLowerCase() === 'true';
          break;
        }
        const nums = arg.split(',').map((s) => Number(s.trim()));
        if (nums.length > 0 && nums.every(Number.isFinite)) a.default = nums;
        else a.default = arg;
        break;
      }
      case 'select': case 'options': {
        const opts: SelectOption[] = [];
        for (const part of arg.split('|')) {
          const [left, right] = part.split('=').map((s) => s.trim());
          if (right !== undefined) opts.push({ label: left, value: right });
          else if (left) opts.push({ label: titleCase(left), value: left });
        }
        if (opts.length) a.select = opts;
        break;
      }
    }
  }

  return a;
}

/* ------------------------------------------------------------------ *
 * Uniform -> Control
 * ------------------------------------------------------------------ */

interface MapContext {
  defaultGroup: string;
  modDefault: boolean;
}

function hasControlAnnotations(a: Annotations): boolean {
  return Boolean(
    a.label || a.range || a.select || a.color || a.default !== undefined || a.step,
  );
}

function controlFor(
  u: ParsedUniform,
  ctx: MapContext,
  warnings: ParseWarning[],
): Control | null {
  const a = u.annotations;
  const type = u.glslType;

  if (!KNOWN_TYPES.has(type)) {
    warnings.push({
      level: 'warn', name: u.name, line: u.line,
      message: `Unknown type "${type}" — likely a struct. Declare its members individually to expose controls.`,
    });
    return null;
  }

  if (UNSUPPORTED_TYPES.has(type)) {
    warnings.push({
      level: 'info', name: u.name, line: u.line,
      message: `"${type}" has no control mapping — set it from the renderer instead.`,
    });
    return null;
  }

  if (u.arrayLength !== undefined) {
    warnings.push({
      level: 'info', name: u.name, line: u.line,
      message: `Array uniform "${u.name}[${u.arrayLength}]" skipped — arrays need a bespoke control.`,
    });
    return null;
  }

  const common = {
    id: u.name,
    label: a.label ?? humanise(u.name),
    group: a.group ?? ctx.defaultGroup,
    hint: a.hint,
    advanced: a.advanced,
    binding: { target: 'uniform' as const, name: u.name, glslType: type as GlslType },
  };

  const modulatable = a.mod ?? ctx.modDefault;

  // A @select on a numeric uniform wins over the type's usual mapping.
  if (a.select && (type === 'float' || type === 'int' || type === 'uint')) {
    const fallback = a.select[0].value;
    return {
      ...common, kind: 'select',
      options: a.select, valueType: 'number',
      default: numericDefault(a) !== undefined ? String(numericDefault(a)) : fallback,
      displayStyle: a.strip ? 'strip' : undefined,
    };
  }

  switch (type) {
    case 'float': {
      const [min, max] = a.range ?? [0, 1];
      return {
        ...common, kind: 'slider', min, max,
        step: a.step ?? niceStep(min, max),
        scale: a.log ? 'log' : 'linear',
        unit: a.unit,
        modulatable,
        default: clamp(numericDefault(a) ?? preferredZero(min, max), min, max),
      };
    }

    case 'int':
    case 'uint': {
      const [min, max] = a.range ?? [0, 10];
      return {
        ...common, kind: 'stepper',
        min: Math.round(min), max: Math.round(max), step: Math.round(a.step ?? 1),
        modulatable,
        default: Math.round(clamp(numericDefault(a) ?? preferredZero(min, max), min, max)),
      };
    }

    case 'bool':
      return {
        ...common, kind: 'toggle',
        default: typeof a.default === 'boolean' ? a.default : false,
      };

    case 'vec2':
    case 'ivec2':
    case 'uvec2': {
      const [min, max] = a.range ?? [0, 1];
      const d = vectorDefault(a, 2, [0, 0]) as Vec2;
      return {
        ...common, kind: 'xy',
        min: [min, min], max: [max, max],
        step: a.step ?? niceStep(min, max),
        lockAspect: true, modulatable,
        default: [clamp(d[0], min, max), clamp(d[1], min, max)],
      };
    }

    case 'vec3':
    case 'ivec3':
    case 'uvec3': {
      if (a.color || COLOR_NAME.test(u.name)) {
        const d = vectorDefault(a, 3, [1, 1, 1]);
        return {
          ...common, kind: 'color', alpha: false,
          default: toRGBA(d, 1),
        };
      }
      const [min, max] = a.range ?? [0, 1];
      const d = vectorDefault(a, 3, [0, 0, 0]) as Vec3;
      return {
        ...common, kind: 'vec3',
        min: [min, min, min], max: [max, max, max],
        step: a.step ?? niceStep(min, max),
        modulatable,
        default: [clamp(d[0], min, max), clamp(d[1], min, max), clamp(d[2], min, max)],
      };
    }

    case 'vec4':
    case 'ivec4':
    case 'uvec4': {
      if (!a.color && !COLOR_NAME.test(u.name)) {
        warnings.push({
          level: 'info', name: u.name, line: u.line,
          message: `vec4 "${u.name}" mapped to an RGBA picker. Add @label/@color to confirm, or split it into two uniforms.`,
        });
      }
      const d = vectorDefault(a, 4, [1, 1, 1, 1]);
      return { ...common, kind: 'color', alpha: true, default: toRGBA(d, d[3] ?? 1) };
    }

    case 'bvec2':
    case 'bvec3':
    case 'bvec4':
      warnings.push({
        level: 'info', name: u.name, line: u.line,
        message: `"${type}" skipped — split it into individual bool uniforms to get toggles.`,
      });
      return null;

    case 'sampler2D':
      return {
        ...common, kind: 'texture',
        accept: ['image', 'video', 'svg'],
        allowSelf: true,
        default: null,
      };

    default:
      return null;
  }
}

/* ------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------ */

function numericDefault(a: Annotations): number | undefined {
  if (Array.isArray(a.default) && typeof a.default[0] === 'number') return a.default[0];
  return undefined;
}

function vectorDefault(a: Annotations, n: number, fallback: number[]): number[] {
  if (!Array.isArray(a.default)) return fallback;
  if (a.default.length === 1) return new Array(n).fill(a.default[0]);
  if (a.default.length >= n) return a.default.slice(0, n);
  return fallback;
}

function toRGBA(v: number[], alpha: number): RGBA {
  return {
    r: clamp(v[0] ?? 0, 0, 1),
    g: clamp(v[1] ?? 0, 0, 1),
    b: clamp(v[2] ?? 0, 0, 1),
    a: clamp(alpha, 0, 1),
  };
}

/** Land on 0 when it sits inside the range — otherwise start at the floor. */
function preferredZero(min: number, max: number): number {
  return min <= 0 && 0 <= max ? 0 : min;
}

function niceStep(min: number, max: number): number {
  const span = Math.abs(max - min);
  if (span <= 2) return 0.001;
  if (span <= 20) return 0.01;
  if (span <= 200) return 0.1;
  return 1;
}

function clamp(n: number, min: number, max: number): number {
  return n < min ? min : n > max ? max : n;
}

/** u_gridDensity -> "Grid density", iChannelMix -> "Channel mix" */
export function humanise(name: string): string {
  const stripped = name.replace(/^(u_|i_|_)/, '').replace(/^i(?=[A-Z])/, '');
  const spaced = stripped
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

function titleCase(s: string): string {
  return s.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
