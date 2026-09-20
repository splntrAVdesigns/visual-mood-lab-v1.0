/**
 * Tile-state validation verifier.
 *
 * Run with: npm run verify:tile-state
 *
 * Two directions, and the first matters more:
 *
 *   1. LEGITIMATE DATA MUST NEVER BE REJECTED. Persistence failures are silent
 *      to the person using the app, so a validator that is too strict is worse
 *      than none. Vectors are generated from the app's own definitions —
 *      every registered effect, every ModSource, the sound defaults — not
 *      hand-written to match the validator.
 *   2. Hostile / malformed data is refused: wrong types, oversized payloads,
 *      prototype-pollution keys, non-finite numbers, unknown effect fields.
 *
 * Also covers readJsonBody (size cap, malformed JSON) and the 401 mapping.
 */

import { listEffectDefinitions, defaultEffectParams } from '../lib/effects/registry';
import { MAX_EFFECTS_PER_CHAIN } from '../lib/effects/types';
import { DEFAULT_SOUND_STATE, normalizeSoundState } from '../lib/sound/types';
import { MAX_JSON_BODY_BYTES, readJsonBody, unauthorizedResponse } from '../lib/http/api';
import {
  LIMITS,
  validateEffects,
  validateModState,
  validateParamState,
  validateSoundState,
} from '../lib/validation/tile-state';

let passed = 0;
let failed = 0;
function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) passed++;
  else {
    failed++;
    console.error(`  FAIL  ${name}${detail !== undefined ? `  -> ${JSON.stringify(detail)}` : ''}`);
  }
}
function group(title: string): void {
  console.log(`\n${title}`);
}

/** JSON.parse, so hostile keys like __proto__ arrive as OWN properties, exactly as from a real request. */
const J = (text: string): unknown => JSON.parse(text);

const MOD_SOURCES = [
  'time',
  'audio.rms', 'audio.bass', 'audio.mid', 'audio.high',
  'mic.rms', 'mic.bass', 'mic.mid', 'mic.high',
  'lfo.sine', 'lfo.triangle', 'lfo.saw', 'lfo.noise',
  'pointer.x', 'pointer.y',
  'midi.cc',
  // controller-layer sources (lib/control-surface) — must not need a server release
  'midi-slot-3', 'gamepad-left-stick-x',
];

function verifyLegitimate(): void {
  group('legitimate data is accepted');

  // Every ParamValue shape: number | boolean | string | Vec2 | Vec3 | RGBA | null
  const params = {
    speed: 0.35,
    count: 1200,
    negative: -3.5,
    invert: true,
    mode: 'FLUX',
    phrase: 'a fairly long piece of text that a text control could hold '.repeat(20),
    center: [0.25, -0.5],
    tint3: [0, 0.83, 1],
    tint: { r: 0, g: 0.83, b: 1, a: 1 },
    linked: null,
    'u_some.uniform-name:1': 0,
  };
  check('every ParamValue shape', validateParamState(params).ok, validateParamState(params));
  check('empty params', validateParamState({}).ok);

  // Mod: every source, every optional field
  const mod: Record<string, unknown> = {};
  MOD_SOURCES.forEach((source, i) => {
    mod[`control${i}`] = { source, amount: (i % 2 ? -1 : 1) * 0.5, rate: 0.5, smoothing: 0.25, cc: 7 };
  });
  mod.takeover = { source: 'midi-slot-3', amount: 1, takeover: 'pickup' };
  check('every modulation source + optional fields', validateModState(mod).ok, validateModState(mod));
  check('empty mod', validateModState({}).ok);

  // Sound
  check('DEFAULT_SOUND_STATE', validateSoundState(DEFAULT_SOUND_STATE).ok, validateSoundState(DEFAULT_SOUND_STATE));
  const normalized = normalizeSoundState({ enabled: true, presetId: 'field-chime', notes: ['C', 'E', 'G'], scale: 'pentatonic', octave: 1 });
  check('a normalised, populated sound state', validateSoundState(normalized).ok, validateSoundState(normalized));
  check('legacy pre-note-rack row (key, no notes)', validateSoundState({ enabled: true, key: 'D', scale: 'minor' }).ok);
  check('empty sound {}', validateSoundState({}).ok);

  // Effects — generated from the real registry
  const defs = listEffectDefinitions();
  check('registry has effects to test against', defs.length >= 7, defs.length);
  let allInstancesOk = true;
  let firstBad: unknown = null;
  for (const def of defs) {
    const instance = {
      id: '0b7e3c1e-9a52-4d0e-8a51-2f1d6c9b7a10',
      effectType: def.id,
      enabled: true,
      mix: 1,
      params: defaultEffectParams(def.id),
      mod: {},
    };
    const r = validateEffects([instance]);
    if (!r.ok) {
      allInstancesOk = false;
      firstBad ??= { effect: def.id, error: r.error };
    }
  }
  check('a default instance of EVERY registered effect', allInstancesOk, firstBad);

  const chain = defs.slice(0, MAX_EFFECTS_PER_CHAIN).map((d, i) => ({
    id: `fx-${i}`,
    effectType: d.id,
    enabled: i % 2 === 0,
    mix: 0.75,
    params: defaultEffectParams(d.id),
    mod: { mix: { source: 'lfo.sine', amount: 0.4, rate: 0.25 } },
  }));
  check(`a full ${MAX_EFFECTS_PER_CHAIN}-effect chain with modulated mix`, validateEffects(chain).ok, validateEffects(chain));
  check('empty chain [] (how a rack is cleared)', validateEffects([]).ok);
  check('mix a hair over 1 from float arithmetic', validateEffects([{ ...chain[0], mix: 1.0000000002 }]).ok);
  check('MAX_EFFECTS matches lib/effects/types.ts', LIMITS.maxEffects === MAX_EFFECTS_PER_CHAIN);
}

function verifyHostile(): void {
  group('hostile / malformed data is refused');

  for (const [name, fn] of [
    ['params', validateParamState],
    ['mod', validateModState],
    ['sound', validateSoundState],
  ] as const) {
    check(`${name}: null`, !fn(null).ok);
    check(`${name}: array`, !fn([]).ok);
    check(`${name}: string`, !fn('x').ok);
    check(`${name}: number`, !fn(1).ok);
  }
  check('effects: object instead of array', !validateEffects({}).ok);
  check('effects: null', !validateEffects(null).ok);

  // Prototype pollution — arrives as an OWN key via JSON.parse
  check('params: __proto__ key', !validateParamState(J('{"__proto__": 1}')).ok);
  check('params: constructor key', !validateParamState(J('{"constructor": 1}')).ok);
  check('mod: __proto__ as a control id', !validateModState(J('{"__proto__": {"source":"time","amount":1}}')).ok);
  check('sound: nested __proto__', !validateSoundState(J('{"a": {"__proto__": 1}}')).ok);
  check('effect params: __proto__', !validateEffects([{ id: 'a', effectType: 'grain', enabled: true, mix: 1, params: J('{"__proto__":1}'), mod: {} }]).ok);

  // Bad key names
  check('params: key with a space', !validateParamState({ 'a b': 1 }).ok);
  check('params: key with a slash', !validateParamState({ 'a/b': 1 }).ok);
  check('params: empty key', !validateParamState({ '': 1 }).ok);
  check('params: 129-char key', !validateParamState({ ['k'.repeat(129)]: 1 }).ok);

  // Non-finite numbers (JSON.parse turns 1e999 into Infinity)
  check('params: Infinity', !validateParamState(J('{"a": 1e999}')).ok);
  check('params: beyond the numeric ceiling', !validateParamState({ a: 1e13 }).ok);
  check('params: NaN', !validateParamState({ a: NaN }).ok);
  check('params: array containing Infinity', !validateParamState({ a: [1, J('1e999')] }).ok);
  check('mod: NaN amount', !validateModState({ c: { source: 'time', amount: NaN } }).ok);

  // Wrong value types
  check('params: nested object of objects', !validateParamState({ a: { b: { c: 1 } } }).ok);
  check('params: object holding a string', !validateParamState({ a: { r: 'x' } }).ok);
  check('params: array of strings', !validateParamState({ a: ['x'] }).ok);
  check('params: array over the length limit', !validateParamState({ a: new Array(LIMITS.maxArray + 1).fill(0) }).ok);
  check('params: string over the length limit', !validateParamState({ a: 'x'.repeat(LIMITS.maxString + 1) }).ok);
  check('params: object over the key limit', !validateParamState({ a: Object.fromEntries(Array.from({ length: LIMITS.maxObjectKeys + 1 }, (_, i) => [`k${i}`, 0])) }).ok);
  check('params: undefined value', !validateParamState({ a: undefined }).ok);

  // Size
  const many = Object.fromEntries(Array.from({ length: LIMITS.maxKeys + 1 }, (_, i) => [`p${i}`, 0]));
  check('params: too many keys', !validateParamState(many).ok);
  check('params: exactly the key limit is fine', validateParamState(Object.fromEntries(Array.from({ length: LIMITS.maxKeys }, (_, i) => [`p${i}`, 0]))).ok);
  check('mod: too many routings', !validateModState(Object.fromEntries(Array.from({ length: LIMITS.maxKeys + 1 }, (_, i) => [`c${i}`, { source: 'time', amount: 0 }]))).ok);

  // Mod routing shape
  check('mod: routing is not an object', !validateModState({ c: 5 }).ok);
  check('mod: missing source', !validateModState({ c: { amount: 1 } }).ok);
  check('mod: source with illegal characters', !validateModState({ c: { source: 'a b<script>', amount: 1 } }).ok);
  check('mod: source too long', !validateModState({ c: { source: 's'.repeat(65), amount: 1 } }).ok);
  check('mod: missing amount', !validateModState({ c: { source: 'time' } }).ok);
  check('mod: amount is a string', !validateModState({ c: { source: 'time', amount: '1' } }).ok);
  check('mod: smoothing is a string', !validateModState({ c: { source: 'time', amount: 1, smoothing: 'x' } }).ok);
  check('mod: nested object field', !validateModState({ c: { source: 'time', amount: 1, extra: { a: 1 } } }).ok);
  check('mod: too many fields', !validateModState({ c: { source: 'time', amount: 1, ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`f${i}`, 1])) } }).ok);

  // Sound
  check('sound: nested too deeply', !validateSoundState({ a: { b: { c: { d: 1 } } } }).ok);
  check('sound: array too long', !validateSoundState({ notes: new Array(LIMITS.soundMaxArray + 1).fill('C') }).ok);
  check('sound: string too long', !validateSoundState({ s: 'x'.repeat(LIMITS.soundMaxString + 1) }).ok);
  check('sound: too many keys', !validateSoundState(Object.fromEntries(Array.from({ length: LIMITS.soundMaxKeys + 1 }, (_, i) => [`k${i}`, 0]))).ok);

  // Effects
  const fx = { id: 'a', effectType: 'grain', enabled: true, mix: 1, params: {}, mod: {} };
  check('effects: over the chain limit', !validateEffects(new Array(MAX_EFFECTS_PER_CHAIN + 1).fill(fx)).ok);
  check('effects: unknown field', !validateEffects([{ ...fx, evil: 1 }]).ok);
  check('effects: enabled is a string', !validateEffects([{ ...fx, enabled: 'yes' }]).ok);
  check('effects: missing id', !validateEffects([{ ...fx, id: '' }]).ok);
  check('effects: effectType with illegal characters', !validateEffects([{ ...fx, effectType: '../../etc/passwd' }]).ok);
  check('effects: absurd mix', !validateEffects([{ ...fx, mix: 1e6 }]).ok);
  check('effects: non-finite mix', !validateEffects([{ ...fx, mix: NaN }]).ok);
  check('effects: an element that is not an object', !validateEffects(['grain']).ok);
  check('effects: bad nested params', !validateEffects([{ ...fx, params: { a: { b: { c: 1 } } } }]).ok);
  check('effects: bad nested mod', !validateEffects([{ ...fx, mod: { c: { source: 'time' } } }]).ok);
}

async function verifyHttp(): Promise<void> {
  group('readJsonBody / 401 mapping');

  const post = (body: string, headers: Record<string, string> = {}) =>
    new Request('http://localhost/x', { method: 'POST', body, headers });

  const ok = await readJsonBody(post('{"params":{"a":1}}'));
  check('valid JSON is parsed', ok.ok && JSON.stringify(ok.body) === '{"params":{"a":1}}');

  const bad = await readJsonBody(post('{not json'));
  check('malformed JSON -> 400 (was a 500 from the catch-all)', !bad.ok && bad.response.status === 400);

  const empty = await readJsonBody(post(''));
  check('empty body -> 400', !empty.ok && empty.response.status === 400);

  const big = await readJsonBody(post(JSON.stringify({ a: 'x'.repeat(2000) })), 1000);
  check('body over the cap -> 413', !big.ok && big.response.status === 413);

  const lied = await readJsonBody(post(JSON.stringify({ a: 'x'.repeat(2000) }), { 'content-length': '10' }), 1000);
  check('a lying Content-Length is still caught by the real length check', !lied.ok && lied.response.status === 413);

  const declared = await readJsonBody(post('{}', { 'content-length': String(MAX_JSON_BODY_BYTES + 1) }));
  check('oversized Content-Length rejected before reading', !declared.ok && declared.response.status === 413);

  const notSigned = Object.assign(new Error('Not signed in'), { status: 401 });
  const r401 = unauthorizedResponse(notSigned);
  check('an error with status 401 -> a 401 response', r401?.status === 401);
  check('an ordinary Error -> null (falls through to the 500)', unauthorizedResponse(new Error('boom')) === null);
  check('a non-Error -> null', unauthorizedResponse('nope') === null && unauthorizedResponse(null) === null);
  check('status 500 is not mistaken for auth', unauthorizedResponse(Object.assign(new Error('x'), { status: 500 })) === null);
}

async function main(): Promise<void> {
  verifyLegitimate();
  verifyHostile();
  await verifyHttp();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
