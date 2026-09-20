// lib/validation/tile-state.ts
//
// Server-side validation for the JSON a tile persists: params, modulation
// routing, sound state and the VFX chain. Pure functions, no I/O.
//
// Why this exists: the PATCH routes used to do `(await req.json()) as {...}`
// — a TypeScript cast, not a check — and write the result straight into a
// JSONB column. Anything an authenticated caller sent was stored, at any size,
// and read back by the client into the render loop. A malformed shape saved
// once (by a bug, a stale tab, or on purpose) then broke that tile on every
// reload: a poison pill sitting in the account's own data.
//
// Design rule: STRICT ON SAFETY, LENIENT ON SHAPE. These validators bound
// everything that could hurt (size, depth, key names, prototype-pollution
// keys, non-finite numbers, wrong top-level type) but do not try to
// re-implement each tile's schema — a control added to a tile tomorrow must
// not need a server release to be savable. Rejecting legitimate data would be
// worse than the problem being solved, because persistence failures are
// silent to the person using the app; scripts/verify-tile-state.ts therefore
// checks these against every ParamValue shape, every registered effect, and
// the saved defaults of every seeded asset.
//
// Every validator returns the SAME object it was given on success (it is
// already plain JSON from JSON.parse) — nothing is copied or rewritten.

export type Validated<T> = { ok: true; value: T } | { ok: false; error: string };

const KEY_RE = /^[A-Za-z0-9_.:\-]{1,128}$/;
const SOURCE_RE = /^[A-Za-z0-9_.:\-]{1,64}$/;
const EFFECT_TYPE_RE = /^[A-Za-z0-9_\-]{1,64}$/;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export const LIMITS = {
  /** Controls on one tile. The largest seeded tile has ~40. */
  maxKeys: 256,
  /** A text control can legitimately hold a paragraph. */
  maxString: 10_000,
  /** Vec2 / Vec3 / RGBA are 2–4; headroom for anything array-shaped. */
  maxArray: 16,
  /** RGBA-style {r,g,b,a} objects. */
  maxObjectKeys: 8,
  maxNumber: 1e12,
  /** Matches lib/effects/types.ts MAX_EFFECTS_PER_CHAIN. */
  maxEffects: 3,
  soundMaxDepth: 3,
  soundMaxKeys: 64,
  soundMaxString: 200,
  soundMaxArray: 32,
} as const;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= LIMITS.maxNumber;
}

/** Own keys only, all safe to use as property names later. */
function badKey(key: string): boolean {
  return FORBIDDEN_KEYS.has(key) || !KEY_RE.test(key);
}

/* ------------------------------------------------------------------ *
 * Params
 * ------------------------------------------------------------------ */

function paramValueError(v: unknown): string | null {
  if (v === null || typeof v === 'boolean') return null;
  if (typeof v === 'number') return isFiniteNumber(v) ? null : 'number is not finite / out of range';
  if (typeof v === 'string') return v.length <= LIMITS.maxString ? null : 'string too long';
  if (Array.isArray(v)) {
    if (v.length > LIMITS.maxArray) return 'array too long';
    return v.every(isFiniteNumber) ? null : 'array must hold only finite numbers';
  }
  if (isPlainObject(v)) {
    const keys = Object.keys(v);
    if (keys.length > LIMITS.maxObjectKeys) return 'object has too many keys';
    for (const k of keys) {
      if (badKey(k)) return `bad key "${k.slice(0, 40)}"`;
      if (!isFiniteNumber(v[k])) return 'object must hold only finite numbers';
    }
    return null;
  }
  return 'unsupported value type';
}

export function validateParamState(input: unknown): Validated<Record<string, unknown>> {
  if (!isPlainObject(input)) return { ok: false, error: 'must be an object' };
  const keys = Object.keys(input);
  if (keys.length > LIMITS.maxKeys) return { ok: false, error: 'too many keys' };

  for (const key of keys) {
    if (badKey(key)) return { ok: false, error: `bad key "${key.slice(0, 40)}"` };
    const err = paramValueError(input[key]);
    if (err) return { ok: false, error: `"${key}": ${err}` };
  }
  return { ok: true, value: input };
}

/* ------------------------------------------------------------------ *
 * Modulation routing
 * ------------------------------------------------------------------ */

const MOD_NUMERIC = ['amount', 'rate', 'cc', 'smoothing'] as const;
const MOD_MAX_KEYS = 12;

export function validateModState(input: unknown): Validated<Record<string, unknown>> {
  if (!isPlainObject(input)) return { ok: false, error: 'must be an object' };
  const controlIds = Object.keys(input);
  if (controlIds.length > LIMITS.maxKeys) return { ok: false, error: 'too many routings' };

  for (const controlId of controlIds) {
    if (badKey(controlId)) return { ok: false, error: `bad control id "${controlId.slice(0, 40)}"` };
    const routing = input[controlId];
    if (!isPlainObject(routing)) return { ok: false, error: `"${controlId}": routing must be an object` };

    const fields = Object.keys(routing);
    if (fields.length > MOD_MAX_KEYS) return { ok: false, error: `"${controlId}": too many fields` };

    // Sources are validated by SHAPE, not against a fixed list: the bus and
    // the controller layer add sources (midi-slot-3, gamepad-*) without the
    // server needing to know them. An unknown source is inert at apply time.
    if (typeof routing.source !== 'string' || !SOURCE_RE.test(routing.source)) {
      return { ok: false, error: `"${controlId}": bad source` };
    }
    if (!isFiniteNumber(routing.amount)) return { ok: false, error: `"${controlId}": amount must be a finite number` };

    for (const name of MOD_NUMERIC) {
      if (routing[name] !== undefined && !isFiniteNumber(routing[name])) {
        return { ok: false, error: `"${controlId}": ${name} must be a finite number` };
      }
    }
    for (const f of fields) {
      if (badKey(f)) return { ok: false, error: `"${controlId}": bad field "${f.slice(0, 40)}"` };
      const v = routing[f];
      const scalar = typeof v === 'boolean' || isFiniteNumber(v) || (typeof v === 'string' && v.length <= 64);
      if (!scalar) return { ok: false, error: `"${controlId}": field "${f}" must be a small scalar` };
    }
  }
  return { ok: true, value: input };
}

/* ------------------------------------------------------------------ *
 * Sound state — bounded JSON, no schema
 * ------------------------------------------------------------------ */

function boundedJsonError(v: unknown, depth: number): string | null {
  if (v === null || typeof v === 'boolean') return null;
  if (typeof v === 'number') return isFiniteNumber(v) ? null : 'number is not finite / out of range';
  if (typeof v === 'string') return v.length <= LIMITS.soundMaxString ? null : 'string too long';

  if (depth >= LIMITS.soundMaxDepth) return 'nested too deeply';

  if (Array.isArray(v)) {
    if (v.length > LIMITS.soundMaxArray) return 'array too long';
    for (const item of v) {
      const err = boundedJsonError(item, depth + 1);
      if (err) return err;
    }
    return null;
  }
  if (isPlainObject(v)) {
    const keys = Object.keys(v);
    if (keys.length > LIMITS.soundMaxKeys) return 'too many keys';
    for (const k of keys) {
      if (badKey(k)) return `bad key "${k.slice(0, 40)}"`;
      const err = boundedJsonError(v[k], depth + 1);
      if (err) return err;
    }
    return null;
  }
  return 'unsupported value type';
}

/**
 * Sound state is normalised on read by normalizeSoundState() (which is why old
 * rows never needed a migration), so the server only guarantees it is a small,
 * safe object — not that it is a *complete* one.
 */
export function validateSoundState(input: unknown): Validated<Record<string, unknown>> {
  if (!isPlainObject(input)) return { ok: false, error: 'must be an object' };
  const err = boundedJsonError(input, 0);
  return err ? { ok: false, error: err } : { ok: true, value: input };
}

/* ------------------------------------------------------------------ *
 * VFX chain
 * ------------------------------------------------------------------ */

const EFFECT_FIELDS = new Set(['id', 'effectType', 'enabled', 'mix', 'params', 'mod']);

export function validateEffects(input: unknown): Validated<unknown[]> {
  if (!Array.isArray(input)) return { ok: false, error: 'must be an array' };
  if (input.length > LIMITS.maxEffects) return { ok: false, error: `at most ${LIMITS.maxEffects} effects` };

  for (let i = 0; i < input.length; i++) {
    const fx = input[i];
    const at = `effect ${i}`;
    if (!isPlainObject(fx)) return { ok: false, error: `${at}: must be an object` };

    for (const k of Object.keys(fx)) {
      if (!EFFECT_FIELDS.has(k)) return { ok: false, error: `${at}: unknown field "${k.slice(0, 40)}"` };
    }
    if (typeof fx.id !== 'string' || fx.id.length < 1 || fx.id.length > 64) return { ok: false, error: `${at}: bad id` };
    if (typeof fx.effectType !== 'string' || !EFFECT_TYPE_RE.test(fx.effectType)) {
      return { ok: false, error: `${at}: bad effectType` };
    }
    if (typeof fx.enabled !== 'boolean') return { ok: false, error: `${at}: enabled must be a boolean` };
    // Not clamped to 0..1: a value a hair over 1 from float arithmetic must
    // never make a save fail. Finite and sane is the whole requirement.
    if (!isFiniteNumber(fx.mix) || Math.abs(fx.mix) > 10) return { ok: false, error: `${at}: bad mix` };

    const params = validateParamState(fx.params);
    if (!params.ok) return { ok: false, error: `${at} params: ${params.error}` };
    const mod = validateModState(fx.mod);
    if (!mod.ok) return { ok: false, error: `${at} mod: ${mod.error}` };
  }
  return { ok: true, value: input };
}
