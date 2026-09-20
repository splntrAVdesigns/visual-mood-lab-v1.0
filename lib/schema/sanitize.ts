// lib/schema/sanitize.ts
//
// Makes a parsed ControlSchema safe to hand to everything downstream — the
// inspector, modulation, Roll / Mutate, and the save path.
//
// WHY THIS EXISTS. Both parsers (GLSL uniforms, sketch `params`) turn text a
// person typed into controls, and until now they passed through whatever they
// were given. A fuzz of the real pipeline found ordinary mistakes producing
// controls that break the app: reversed or equal ranges, defaults outside
// their range, `step` <= 0, log scale with min <= 0, empty selects, invalid
// colors, and (sketches only) non-finite numbers. The seed library is all
// well-formed, so none of this has bitten yet. Playground re-parses on every
// keystroke, so it will.
//
// POLICY (approved): REPAIR with a warning; drop a control only when it cannot
// be repaired (no options to choose from, no id). Warnings are written for the
// editor's problem list — "u_speed: min is greater than max — swapped".
//
// TWO GUARANTEES, both tested (scripts/verify-schema-fuzz.ts):
//   1. IDENTITY  — a well-formed schema comes back as the SAME object with no
//      warnings. All 99 seed tiles are unchanged by this.
//   2. IDEMPOTENT — sanitizing the output changes nothing.
//
// LIMITS come from the server's own validator (lib/validation/tile-state), so a
// schema that passes here can always be SAVED: no number outside ±1e12 (the
// validator rejects it), no more controls than the 256-key params cap, and — by
// asking the validator itself rather than copying its rules — no control whose
// id or default value the save path would refuse. A control id it refuses (a
// sketch param called "my param") cannot be repaired without silently breaking
// the sketch's own `get('my param')`, so that control is dropped, loudly.

import type { Control, ControlPredicate, ControlSchema } from '@/renderers/control-schema';
import { LIMITS, validateParamState } from '@/lib/validation/tile-state';

export const MAX_CONTROLS = LIMITS.maxKeys;
export const MAX_STORABLE = LIMITS.maxNumber;

export interface SchemaWarning {
  level: 'warn';
  /** The control it is about, or "(schema)" for whole-schema notes. */
  id: string;
  message: string;
}

export interface SanitizeResult {
  schema: ControlSchema;
  warnings: SchemaWarning[];
  /** False => `schema` is the input object, untouched. */
  changed: boolean;
}

type Loose = Record<string, unknown>;

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isObj = (v: unknown): v is Loose => v !== null && typeof v === 'object' && !Array.isArray(v);
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const storable = (n: number) => clamp(n, -MAX_STORABLE, MAX_STORABLE);

/* ------------------------------------------------------------------ *
 * Ranges
 * ------------------------------------------------------------------ */

interface Range {
  lo: number;
  hi: number;
  def: number;
  notes: string[];
}

/** Repair one (min, max, default) triple. Never throws; always returns a usable range. */
function repairRange(min: unknown, max: unknown, def: unknown, integer: boolean): Range {
  const notes: string[] = [];
  let lo: number;
  let hi: number;

  if (!isNum(min) || !isNum(max)) {
    lo = isNum(min) ? min : isNum(max) ? max - 1 : 0;
    hi = isNum(max) ? max : lo + 1;
    notes.push(`range is not a pair of finite numbers — using [${lo}, ${hi}]`);
  } else {
    lo = min;
    hi = max;
  }

  if (storable(lo) !== lo || storable(hi) !== hi) {
    lo = storable(lo);
    hi = storable(hi);
    notes.push(`range exceeds the storable limit of ±${MAX_STORABLE} — clamped`);
  }

  if (lo > hi) {
    [lo, hi] = [hi, lo];
    notes.push('min is greater than max — swapped');
  }

  if (integer && (!Number.isInteger(lo) || !Number.isInteger(hi))) {
    const l = Math.ceil(lo);
    const h = Math.floor(hi);
    if (h >= l) {
      lo = l;
      hi = h;
    } else {
      lo = Math.round(lo);
      hi = Math.round(hi);
    }
    notes.push(`whole-number control has fractional bounds — using [${lo}, ${hi}]`);
  }

  if (lo === hi) {
    if (hi < MAX_STORABLE) hi = lo + 1;
    else lo = hi - 1;
    notes.push(`min equals max — widened to [${lo}, ${hi}]`);
  }

  let d: number;
  if (!isNum(def)) {
    d = (lo + hi) / 2;
    if (integer) d = Math.round(d);
    notes.push('default is not a finite number — using the midpoint');
  } else if (def < lo || def > hi) {
    d = clamp(def, lo, hi);
    notes.push(`default is outside [${lo}, ${hi}] — clamped`);
  } else {
    d = def;
  }
  if (integer && !Number.isInteger(d)) {
    d = Math.round(d);
    notes.push('whole-number control has a fractional default — rounded');
  }
  return { lo, hi, def: d, notes };
}

/** Repair a vector of N axes (xy / vec3). Returns patches only for what changed. */
function repairVector(c: Loose, n: 2 | 3, axes: string[]): { patch: Loose; notes: string[] } {
  const notes: string[] = [];
  const min: number[] = [];
  const max: number[] = [];
  const def: number[] = [];
  let changed = false;

  const arr = (v: unknown): unknown[] | null => (Array.isArray(v) && v.length === n ? v : null);
  const [mn, mx, df] = [arr(c.min), arr(c.max), arr(c.default)];
  if (!mn || !mx || !df) {
    notes.push(`min / max / default must each be ${n} numbers — repaired`);
    changed = true;
  }
  for (let i = 0; i < n; i++) {
    const r = repairRange(mn?.[i], mx?.[i], df?.[i], false);
    min.push(r.lo);
    max.push(r.hi);
    def.push(r.def);
    for (const note of r.notes) {
      notes.push(`${axes[i]}: ${note}`);
      changed = true;
    }
  }
  return changed ? { patch: { min, max, default: def }, notes } : { patch: {}, notes };
}

/* ------------------------------------------------------------------ *
 * Per-control repair
 * ------------------------------------------------------------------ */

const okChannel = (v: unknown) => isNum(v) && v >= 0 && v <= 1;
const isRollWindow = (v: unknown): v is { min: number; max: number } => isObj(v) && isNum(v.min) && isNum(v.max) && v.min < v.max;

export interface Repair {
  /** The repaired control — the SAME object when nothing was wrong — or null if it had to be dropped. */
  control: Control | null;
  /** Empty <=> the control was already well-formed. */
  notes: string[];
}

export function repairControl(input: Control): Repair {
  const c = input as unknown as Loose;
  const notes: string[] = [];
  const patch: Loose = {};
  const remove = new Set<string>();

  switch (c.kind) {
    case 'slider':
    case 'stepper': {
      const integer = c.kind === 'stepper';
      const r = repairRange(c.min, c.max, c.default, integer);
      notes.push(...r.notes);
      if (r.notes.length) Object.assign(patch, { min: r.lo, max: r.hi, default: r.def });

      const lo = r.lo;
      const hi = r.hi;
      if (c.step !== undefined) {
        if (!isNum(c.step) || c.step <= 0) {
          remove.add('step');
          notes.push('step must be a positive number — ignored');
        } else if (integer && !Number.isInteger(c.step)) {
          patch.step = Math.max(1, Math.round(c.step));
          notes.push('step of a whole-number control must be a whole number — rounded');
        } else if (c.step > hi - lo) {
          remove.add('step');
          notes.push('step is larger than the range — ignored');
        }
      }
      if (c.kind === 'slider' && c.scale !== undefined) {
        if (c.scale !== 'linear' && c.scale !== 'log') {
          remove.add('scale');
          notes.push('scale must be "linear" or "log" — ignored');
        } else if (c.scale === 'log' && lo <= 0) {
          remove.add('scale');
          notes.push('log scale needs min > 0 — using linear');
        }
      }
      break;
    }

    case 'xy':
    case 'vec3': {
      const v = repairVector(c, c.kind === 'xy' ? 2 : 3, c.kind === 'xy' ? ['x', 'y'] : ['x', 'y', 'z']);
      notes.push(...v.notes);
      Object.assign(patch, v.patch);
      if (c.step !== undefined && (!isNum(c.step) || c.step <= 0)) {
        remove.add('step');
        notes.push('step must be a positive number — ignored');
      }
      break;
    }

    case 'color': {
      const d = c.default;
      // Alpha is REQUIRED (RGBA.a is a number). Leniency here let Roll build
      // {r,g,b,a: undefined}, which the save path rejects as non-finite.
      const ok = isObj(d) && okChannel(d.r) && okChannel(d.g) && okChannel(d.b) && okChannel(d.a);
      if (!ok) {
        const ch = (v: unknown) => (isNum(v) ? clamp(v, 0, 1) : 1);
        patch.default = isObj(d) ? { r: ch(d.r), g: ch(d.g), b: ch(d.b), a: ch(d.a) } : { r: 1, g: 1, b: 1, a: 1 };
        notes.push('default is not a valid color (r, g, b and a, each 0..1) — repaired');
      }
      break;
    }

    case 'select': {
      if (!Array.isArray(c.options)) {
        return { control: null, notes: ['select has no options'] };
      }
      const seen = new Set<string>();
      const options: Loose[] = [];
      let rebuilt = false;
      for (const o of c.options as unknown[]) {
        let opt: Loose | null = null;
        if (typeof o === 'string' || isNum(o)) {
          opt = { label: String(o), value: String(o) };
          rebuilt = true;
        } else if (isObj(o) && (typeof o.value === 'string' || isNum(o.value))) {
          const value = String(o.value);
          if (value.length > LIMITS.maxString) {
            rebuilt = true;
            continue;
          }
          const label = typeof o.label === 'string' ? o.label : value;
          opt = typeof o.value === 'string' && typeof o.label === 'string' ? o : { ...o, value, label };
          if (opt !== o) rebuilt = true;
        } else {
          rebuilt = true;
        }
        if (!opt) continue;
        if (seen.has(opt.value as string)) {
          rebuilt = true;
          continue;
        }
        seen.add(opt.value as string);
        options.push(opt);
      }
      if (options.length === 0) return { control: null, notes: ['select has no usable options'] };
      if (rebuilt) {
        patch.options = options;
        notes.push('options were normalised (bad, duplicate or non-string entries fixed or removed)');
      }
      if (typeof c.default !== 'string' || !seen.has(c.default)) {
        patch.default = options[0].value;
        notes.push(`default is not one of the options — using "${String(options[0].value)}"`);
      }
      break;
    }

    case 'toggle':
      if (typeof c.default !== 'boolean') {
        patch.default = Boolean(c.default);
        notes.push('default must be true or false — converted');
      }
      break;

    case 'text':
      if (typeof c.default !== 'string') {
        patch.default = '';
        notes.push('default must be a string — using an empty string');
      } else if (c.default.length > LIMITS.maxString) {
        patch.default = c.default.slice(0, LIMITS.maxString);
        notes.push(`default is longer than the ${LIMITS.maxString}-character limit — truncated`);
      }
      break;

    case 'texture':
      if (!(typeof c.default === 'string' || c.default === null)) {
        patch.default = null;
        notes.push('default must be a string or null — using none');
      }
      break;

    case 'font':
      if (typeof c.default !== 'string') {
        patch.default = '';
        notes.push('default must be a font id (a string) — using an empty one');
      }
      break;

    case 'trigger':
      // A trigger has no value, and shipped tiles omit `default` entirely (the
      // "Clear ripples" trigger in rippling-table does) — so ABSENT is fine. Only
      // a default that is present and not null is wrong.
      if (c.default !== null && c.default !== undefined) {
        patch.default = null;
        notes.push('default must be null — reset');
      }
      break;

    default:
      break; // future kinds: nothing known to repair
  }

  // The save path is the final authority. Ask it, rather than copying its rules.
  const id = c.id as string;
  if (!validateParamState({ [id]: 0 }).ok) {
    return {
      control: null,
      notes: [...notes, 'the id is not a valid parameter name (letters, digits and _ . : - only, up to 128 characters) and cannot be renamed without breaking the code that reads it'],
    };
  }
  const finalDefault = 'default' in patch ? patch.default : c.default;
  const saved = validateParamState({ [id]: finalDefault === undefined ? null : finalDefault });
  if (!saved.ok) {
    return { control: null, notes: [...notes, `the default value cannot be saved (${saved.error})`] };
  }

  // `roll` — the author's Roll/Mutate hint (see lib/roll/policy.ts).
  if (c.roll !== undefined && c.roll !== false) {
    const numeric = c.kind === 'slider' || c.kind === 'stepper';
    if (!isRollWindow(c.roll)) {
      remove.add('roll');
      notes.push('@roll needs two finite numbers with min < max — ignored');
    } else if (!numeric) {
      remove.add('roll');
      notes.push('@roll(min, max) only applies to sliders and steppers — ignored (use @noroll to exclude a control)');
    }
  }

  if (notes.length === 0) return { control: input, notes };
  const repaired: Loose = { ...c, ...patch };
  for (const k of remove) delete repaired[k];
  return { control: repaired as unknown as Control, notes };
}

const wellFormed = new WeakMap<object, boolean>();

/** True when `repairControl` would change nothing. Cached — controls are treated as immutable. */
export function isWellFormed(control: Control): boolean {
  let known = wellFormed.get(control);
  if (known === undefined) {
    known = repairControl(control).notes.length === 0;
    wellFormed.set(control, known);
  }
  return known;
}

/* ------------------------------------------------------------------ *
 * Predicates (showIf / disabledIf / maxIf)
 * ------------------------------------------------------------------ */

/** null => malformed or refers to a control that does not exist. */
function checkPredicate(p: unknown, ids: ReadonlySet<string>): ControlPredicate | null {
  if (!isObj(p)) return null;
  const pair = (v: unknown) => Array.isArray(v) && v.length === 2 && typeof v[0] === 'string' && ids.has(v[0]);
  if ('equals' in p) return pair(p.equals) ? (p as unknown as ControlPredicate) : null;
  if ('notEquals' in p) return pair(p.notEquals) ? (p as unknown as ControlPredicate) : null;
  if ('truthy' in p) return typeof p.truthy === 'string' && ids.has(p.truthy) ? (p as unknown as ControlPredicate) : null;
  for (const key of ['all', 'any'] as const) {
    if (key in p) {
      const list = p[key];
      return Array.isArray(list) && list.length > 0 && list.every((x) => checkPredicate(x, ids)) ? (p as unknown as ControlPredicate) : null;
    }
  }
  return null;
}

function fixPredicates(control: Control, ids: ReadonlySet<string>, warn: (id: string, m: string) => void): Control {
  const c = control as unknown as Loose;
  const patch: Loose = {};
  const remove: string[] = [];

  for (const key of ['showIf', 'disabledIf'] as const) {
    if (c[key] !== undefined && checkPredicate(c[key], ids) === null) {
      remove.push(key);
      warn(control.id, `${key} refers to a control that does not exist (or is malformed) — condition ignored`);
    }
  }
  if (c.maxIf !== undefined) {
    const list = Array.isArray(c.maxIf) ? (c.maxIf as unknown[]) : [];
    // A cap at or below the control's own min would collapse its range (min..cap
    // is empty), so Roll's re-clamp — like the inspector's — would push the value
    // below min. Such an entry is malformed, not merely unusual.
    const floor = isNum(c.min) ? c.min : -Infinity;
    const kept: unknown[] = [];
    let dirty = !Array.isArray(c.maxIf);
    for (const m of list) {
      if (!(isObj(m) && isNum(m.max) && checkPredicate(m.if, ids) !== null)) {
        dirty = true;
        continue;
      }
      // maxIf can RAISE a control's ceiling as well as lower it, so its cap needs
      // the same storable bound as any other number, on BOTH sides (a 1e13 cap let
      // Roll sample a value the save path refuses).
      const cap = storable(m.max);
      if (!(cap > floor)) {
        dirty = true;
        continue;
      }
      if (cap !== m.max) {
        kept.push({ ...m, max: cap });
        dirty = true;
      } else {
        kept.push(m);
      }
    }
    if (dirty) {
      warn(control.id, `maxIf had entries that were malformed, cap at or below the control min, refer to a missing control, or exceed ±${MAX_STORABLE} — fixed or removed`);
      if (kept.length) patch.maxIf = kept;
      else remove.push('maxIf');
    }
  }
  if (remove.length === 0 && Object.keys(patch).length === 0) return control;
  const fixed: Loose = { ...c, ...patch };
  for (const k of remove) delete fixed[k];
  return fixed as unknown as Control;
}

/* ------------------------------------------------------------------ *
 * The schema
 * ------------------------------------------------------------------ */

export function sanitizeSchema(schema: ControlSchema): SanitizeResult {
  const warnings: SchemaWarning[] = [];
  const warn = (id: string, message: string) => warnings.push({ level: 'warn', id, message: `${id}: ${message}` });

  let changed = false;
  const seen = new Set<string>();
  let controls: Control[] = [];

  for (const raw of schema.controls) {
    const id = isObj(raw) ? (raw as unknown as Loose).id : undefined;
    if (typeof id !== 'string' || id === '') {
      warn('(unnamed)', 'a control without an id was removed');
      changed = true;
      continue;
    }
    if (seen.has(id)) {
      warn(id, 'duplicate id — keeping the first');
      changed = true;
      continue;
    }
    seen.add(id);

    const r = repairControl(raw);
    if (r.control === null) {
      warn(id, `${r.notes.join('; ')} — control removed`);
      changed = true;
      continue;
    }
    if (r.notes.length) {
      changed = true;
      for (const n of r.notes) warn(id, n);
    }
    controls.push(r.control);
  }

  if (controls.length > MAX_CONTROLS) {
    const dropped = controls.slice(MAX_CONTROLS).map((c) => c.id);
    controls = controls.slice(0, MAX_CONTROLS);
    warn('(schema)', `${dropped.length} control${dropped.length === 1 ? '' : 's'} beyond the ${MAX_CONTROLS}-control limit ${dropped.length === 1 ? 'was' : 'were'} removed (${dropped.slice(0, 5).join(', ')}${dropped.length > 5 ? ', …' : ''})`);
    changed = true;
  }

  // Predicates last: they may refer to controls the passes above removed.
  const ids = new Set(controls.map((c) => c.id));
  const fixed = controls.map((c) => fixPredicates(c, ids, warn));
  if (fixed.some((c, i) => c !== controls[i])) changed = true;

  if (!changed) return { schema, warnings: [], changed: false };
  return { schema: { ...schema, controls: fixed }, warnings, changed: true };
}
