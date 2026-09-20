// lib/roll/engine.ts
//
// Roll (a new look) and Mutate (a nudge from the current one) for a tile's
// parameters. Pure: schema + current params + options in, params out. No store,
// no React, no DOM — see scripts/verify-roll.ts, which runs this against every
// seed tile thousands of times.
//
// ORDER MATTERS. About 7% of controls are conditionally shown (`showIf`), 18
// controls (in 15 tiles) drive another control's visibility or limit, and one
// has a `maxIf` cap that depends on a sibling. So a Roll works in passes:
//   1. controls that DRIVE others, repeated to a fixpoint (a driver can itself
//      be hidden until another driver changes);
//   2. everything else, judged against the state the drivers just produced —
//      so only controls that are actually visible are rolled;
//   3. colors as a group (a palette, not independent picks);
//   4. a final sweep that reverts anything that ended up hidden and re-applies
//      `maxIf` caps, exactly as the inspector store's setParam does.

import type {
  Control,
  ControlPredicate,
  ControlSchema,
  ParamState,
  ParamValue,
  RGBA,
  SliderControl,
  StepperControl,
  XYControl,
} from '@/renderers/control-schema';
import { coerce, effectiveMax, isDisabledByState, isVisible } from '@/renderers/control-schema';
import { isWellFormed } from '@/lib/schema/sanitize';
import { isRoleColor, mutateColor, rollPalette } from './color';
import { policyFor, ROLLABLE_KINDS } from './policy';
import { clamp, gaussian, logUniform, pick, reflect, uniform, type Rng } from './rng';

export interface RollOptions {
  /** Control ids the person has locked — never touched. */
  locked?: ReadonlySet<string>;
  /** Roll only: also flip toggles. Off by default (they are mode switches). */
  includeToggles?: boolean;
  rng?: Rng;
  /** Asset id, for per-asset policy overrides. */
  assetId?: string | null;
}

export interface MutateOptions extends RollOptions {
  /** 0..1 — how far to nudge. 0 changes nothing. */
  strength: number;
}

export interface RollResult {
  /** The FULL next state (untouched controls included). */
  params: ParamState;
  /** Ids whose value actually differs from `current`. */
  changed: string[];
  /** How many controls were eligible this time. */
  eligible: number;
  /** Why controls were skipped: reason -> count. */
  skipped: Record<string, number>;
}

type Mode = { kind: 'roll' } | { kind: 'mutate'; strength: number };

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function collectRefs(p: ControlPredicate, out: Set<string>): void {
  if ('equals' in p) out.add(p.equals[0]);
  else if ('notEquals' in p) out.add(p.notEquals[0]);
  else if ('truthy' in p) out.add(p.truthy);
  else if ('all' in p) p.all.forEach((x) => collectRefs(x, out));
  else if ('any' in p) p.any.forEach((x) => collectRefs(x, out));
}

/** Ids referenced by any showIf / disabledIf / maxIf predicate in the schema. */
export function driverIds(schema: ControlSchema): Set<string> {
  const out = new Set<string>();
  for (const c of schema.controls) {
    if (c.showIf) collectRefs(c.showIf, out);
    if (c.disabledIf) collectRefs(c.disabledIf, out);
    for (const m of c.maxIf ?? []) collectRefs(m.if, out);
  }
  return out;
}

export function sameValue(a: ParamValue | undefined, b: ParamValue | undefined): boolean {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) return false;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => x === b[i]);
  if (!Array.isArray(a) && !Array.isArray(b)) {
    const x = a as RGBA;
    const y = b as RGBA;
    return x.r === y.r && x.g === y.g && x.b === y.b && x.a === y.a;
  }
  return false;
}

function decimals(n: number): number {
  const s = String(n);
  if (s.includes('e-')) return Number(s.split('e-')[1]);
  const i = s.indexOf('.');
  return i < 0 ? 0 : s.length - i - 1;
}

/**
 * Snap to the control's step grid (anchored at `min`), staying inside [lo, hi].
 * Steppers always snap to integers. If the window is narrower than one step the
 * value is returned unsnapped rather than pushed outside the window.
 */
function snap(control: SliderControl | StepperControl, v: number, lo: number, hi: number): number {
  const step = control.kind === 'stepper' ? Math.max(1, control.step ?? 1) : control.step;
  if (!step || step <= 0) return clamp(v, lo, hi);

  const places = Math.min(10, Math.max(decimals(step), decimals(control.min)));
  const at = (x: number) => Number((control.min + Math.round((x - control.min) / step) * step).toFixed(places));

  let s = at(clamp(v, lo, hi));
  for (let i = 0; i < 3 && s > hi; i++) s = Number((s - step).toFixed(places));
  for (let i = 0; i < 3 && s < lo; i++) s = Number((s + step).toFixed(places));
  return s >= lo && s <= hi ? s : clamp(v, lo, hi);
}

interface Bounds {
  lo: number;
  hi: number;
  log: boolean;
  safety: 'speed' | 'count' | 'override' | 'author' | null;
}

/**
 * The window a numeric control may be sampled from.
 *  - Roll, ordinary control: the middle 80% of its range (the extreme 10% at
 *    each end — max particle count, zero alpha — are rarely what "a new look"
 *    means). Log-scale sliders are windowed in log space.
 *  - Safety-class control: the policy window around its default.
 *  - Mutate: the full range, or for a safety-class control the policy window
 *    widened to include where the value already is, so a Mutate can never push
 *    it beyond the window (or beyond where the person already put it).
 */
function boundsFor(
  control: SliderControl | StepperControl,
  state: ParamState,
  assetId: string | null | undefined,
  mutateFrom: number | null,
): Bounds {
  const lo0 = control.min;
  const hi0 = effectiveMax(control, state) ?? control.max;
  const log = control.kind === 'slider' && control.scale === 'log' && lo0 > 0;
  const policy = policyFor(control, assetId);

  if (policy.safety) {
    const w = policy.safety.window;
    let a = policy.safety.absolute ? w[0] : control.default * w[0];
    let b = policy.safety.absolute ? w[1] : control.default * w[1];
    a = Math.max(lo0, a);
    b = Math.min(hi0, b);
    if (a >= b) {
      a = lo0;
      b = hi0;
    }
    if (mutateFrom !== null) {
      a = Math.min(a, mutateFrom);
      b = Math.max(b, mutateFrom);
    }
    return { lo: a, hi: b, log: a > 0, safety: policy.safety.kind };
  }

  if (mutateFrom !== null) return { lo: lo0, hi: hi0, log, safety: null };

  if (log) {
    const r = hi0 / lo0;
    return { lo: lo0 * Math.pow(r, 0.1), hi: lo0 * Math.pow(r, 0.9), log: true, safety: null };
  }
  const span = hi0 - lo0;
  return { lo: lo0 + 0.1 * span, hi: hi0 - 0.1 * span, log: false, safety: null };
}

function rollNumber(control: SliderControl | StepperControl, b: Bounds, rng: Rng): number {
  const v = b.log && b.lo > 0 ? logUniform(rng, b.lo, b.hi) : uniform(rng, b.lo, b.hi);
  return snap(control, v, b.lo, b.hi);
}

function mutateNumber(control: SliderControl | StepperControl, b: Bounds, current: number, strength: number, rng: Rng): number {
  const cur = clamp(current, b.lo, b.hi);
  if (b.log && b.lo > 0 && cur > 0) {
    const sigma = strength * (Math.log(b.hi) - Math.log(b.lo));
    const x = reflect(Math.log(cur) + gaussian(rng) * sigma, Math.log(b.lo), Math.log(b.hi));
    return snap(control, Math.exp(x), b.lo, b.hi);
  }
  const x = reflect(cur + gaussian(rng) * strength * (b.hi - b.lo), b.lo, b.hi);
  return snap(control, x, b.lo, b.hi);
}

function ineligibleReason(
  control: Control,
  state: ParamState,
  mode: Mode,
  opts: RollOptions,
): string | null {
  if (!ROLLABLE_KINDS.has(control.kind)) return 'kind';
  // Defence in depth: the parsers sanitize, but Roll must never turn a malformed
  // control (reversed range, NaN, empty select…) into NaN or an unsaveable value,
  // whoever built the schema. Skipped, never guessed at.
  if (!isWellFormed(control)) return 'malformed';
  if (control.kind === 'toggle' && !(mode.kind === 'roll' && opts.includeToggles)) return 'toggle';
  if (control.advanced) return 'advanced';
  if (control.disabled) return 'disabled';
  if (opts.locked?.has(control.id)) return 'locked';
  if (policyFor(control, opts.assetId).skip) return 'policy';
  if (!isVisible(control, state)) return 'hidden';
  if (isDisabledByState(control, state)) return 'inert';
  if (control.kind === 'color' && isRoleColor(control.default)) return 'role-color';
  if (control.kind === 'slider' || control.kind === 'stepper') {
    const hi = effectiveMax(control, state) ?? control.max;
    if (hi <= control.min) return 'fixed';
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * The engine
 * ------------------------------------------------------------------ */

function run(schema: ControlSchema, current: ParamState, mode: Mode, opts: RollOptions): RollResult {
  const rng = opts.rng ?? Math.random;
  const state: ParamState = { ...current };
  const drivers = driverIds(schema);
  const skipped: Record<string, number> = {};
  const touched = new Set<string>();
  const strength = mode.kind === 'mutate' ? clamp(mode.strength, 0, 1) : 1;

  // Mutate at strength 0 is defined as "change nothing" — return early rather
  // than let float round-trips (snapping, HSV) nudge values that were meant to stay put.
  if (mode.kind === 'mutate' && strength <= 0) {
    return { params: state, changed: [], eligible: 0, skipped };
  }

  const sample = (control: Control): void => {
    const cur = state[control.id];
    switch (control.kind) {
      case 'slider':
      case 'stepper': {
        const curNum = typeof cur === 'number' ? cur : control.default;
        const b = boundsFor(control, state, opts.assetId, mode.kind === 'mutate' ? curNum : null);
        state[control.id] = mode.kind === 'roll' ? rollNumber(control, b, rng) : mutateNumber(control, b, curNum, strength, rng);
        return;
      }
      case 'select': {
        if (control.options.length < 2) return;
        if (mode.kind === 'roll') {
          state[control.id] = pick(rng, control.options).value;
        } else if (rng() < strength * 0.5) {
          const others = control.options.filter((o) => o.value !== String(cur));
          if (others.length) state[control.id] = pick(rng, others).value;
        }
        return;
      }
      case 'xy': {
        const c = control as XYControl;
        const v = Array.isArray(cur) && cur.length === 2 ? (cur as [number, number]) : c.default;
        const axis = (i: 0 | 1): number => {
          const lo = c.min[i];
          const hi = c.max[i];
          const span = hi - lo;
          if (mode.kind === 'roll') return uniform(rng, lo + 0.2 * span, hi - 0.2 * span); // central 60%
          return reflect(v[i] + gaussian(rng) * strength * span, lo, hi);
        };
        state[control.id] = [axis(0), axis(1)];
        return;
      }
      case 'toggle':
        state[control.id] = rng() < 0.5;
        return;
      default:
        return;
    }
  };

  const consider = (control: Control): void => {
    if (touched.has(control.id)) return;
    const reason = ineligibleReason(control, state, mode, opts);
    if (reason) return;
    touched.add(control.id);
    if (control.kind !== 'color') sample(control);
  };

  // 1. Drivers, to a fixpoint (a driver can be hidden until another driver moves).
  for (let pass = 0; pass < 3; pass++) {
    const before = touched.size;
    for (const c of schema.controls) if (drivers.has(c.id)) consider(c);
    if (touched.size === before) break;
  }
  // 2. Everything else, against the state the drivers produced.
  for (const c of schema.controls) if (!drivers.has(c.id)) consider(c);

  // 3. Colors, as a palette.
  const colors = schema.controls.filter(
    (c): c is Extract<Control, { kind: 'color' }> => c.kind === 'color' && touched.has(c.id),
  );
  if (colors.length > 0) {
    if (mode.kind === 'roll') {
      const palette = rollPalette(colors.map((c) => c.default), rng);
      colors.forEach((c, i) => {
        state[c.id] = palette[i];
      });
    } else {
      const shift = (gaussian(rng) * strength * 60) / 360;
      for (const c of colors) {
        const cur = state[c.id];
        const base = cur && typeof cur === 'object' && !Array.isArray(cur) ? (cur as RGBA) : c.default;
        state[c.id] = mutateColor(base, shift, strength, rng);
      }
    }
  }

  // 4. Final sweep: revert anything that ended up hidden / inert, then coerce
  //    everything we touched and re-apply maxIf caps like setParam does.
  for (const c of schema.controls) {
    if (!touched.has(c.id)) continue;
    if (!isVisible(c, state) || isDisabledByState(c, state)) {
      state[c.id] = current[c.id];
      touched.delete(c.id);
    } else {
      state[c.id] = coerce(c, state[c.id] ?? null, state);
    }
  }
  for (const c of schema.controls) {
    if (!c.maxIf) continue;
    const cap = effectiveMax(c, state);
    const v = state[c.id];
    if (cap !== undefined && typeof v === 'number' && v > cap) state[c.id] = cap;
  }

  // Tally — reasons are computed against the FINAL state so the numbers match what the person sees.
  let eligible = 0;
  for (const c of schema.controls) {
    const reason = ineligibleReason(c, state, mode, opts);
    if (reason === null) eligible++;
    else skipped[reason] = (skipped[reason] ?? 0) + 1;
  }

  const changed = schema.controls.filter((c) => !sameValue(state[c.id], current[c.id])).map((c) => c.id);
  return { params: state, changed, eligible, skipped };
}

/** A new look. */
export function rollParams(schema: ControlSchema, current: ParamState, opts: RollOptions = {}): RollResult {
  return run(schema, current, { kind: 'roll' }, opts);
}

/** A nudge from the current look. `strength` 0..1. */
export function mutateParams(schema: ControlSchema, current: ParamState, opts: MutateOptions): RollResult {
  return run(schema, current, { kind: 'mutate', strength: opts.strength }, opts);
}
