/**
 * Schema sanitizer + author-hint verifier (Playground groundwork).
 *
 * Run with: npm run verify:schema-fuzz
 *
 * Playground re-parses source on every keystroke, so the parsers now meet
 * input nobody at the keyboard reviewed: reversed ranges, NaN, an empty
 * @select, a typo'd @roll. This proves, against the real parsers, engine and
 * the SERVER's own validator, that whatever is typed:
 *
 *   1. the seed library is untouched (identity + zero repairs, all 99 tiles);
 *   2. every repair rule does what it says, and only when needed;
 *   3. a fuzz of random descriptors and random annotation soup never throws,
 *      always yields controls that satisfy an INDEPENDENT well-formedness
 *      check, is idempotent, survives a JSON round trip, and fits the limits
 *      the save path enforces (±1e12, 256 controls);
 *   4. Roll / Mutate on those schemas always produce values that are finite,
 *      in range, coerce-stable AND accepted by validateParamState — i.e. can
 *      actually be saved;
 *   5. the engine refuses a malformed control even when a schema skipped the
 *      sanitizer entirely;
 *   6. @roll / @noroll parse and behave as approved: an explicit window beats
 *      the automatic speed/count windows, and nothing an author writes can lift
 *      the flash exclusion (only a maintainer's `allowFlash` can);
 *   7. one carry rule decides what survives a schema change.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { parseUniforms } from '../lib/gl/parse-uniforms';
import { paramsToSchema } from '../lib/sketch/params-to-schema';
import { MAX_CONTROLS, MAX_STORABLE, isWellFormed, repairControl, sanitizeSchema } from '../lib/schema/sanitize';
import { carryParams } from '../lib/schema/carry';
import { LIMITS, validateParamState } from '../lib/validation/tile-state';
import { coerce, createSchema, defaultsOf, effectiveMax } from '../renderers/control-schema';
import type { Control, ControlSchema, ParamState } from '../renderers/control-schema';
import { mutateParams, rollParams, sameValue } from '../lib/roll/engine';
import { OVERRIDES, isRollableControl, policyFor } from '../lib/roll/policy';
import { mulberry32, type Rng } from '../lib/roll/rng';

let passed = 0;
let failed = 0;
function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) passed++;
  else {
    failed++;
    process.stderr.write(`  FAIL  ${name}${detail !== undefined ? `  -> ${JSON.stringify(detail)?.slice(0, 260)}` : ''}\n`);
  }
}
const group = (t: string) => console.log(`\n${t}`);

const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const storable = (x: unknown) => isNum(x) && Math.abs(x) <= MAX_STORABLE;

/* ------------------------------------------------------------------ *
 * An independent statement of "well-formed" — deliberately NOT built on
 * sanitize.ts, so the sanitizer is checked against a second opinion.
 * ------------------------------------------------------------------ */
function violations(schema: ControlSchema): string[] {
  const v: string[] = [];
  const ids = new Set(schema.controls.map((c) => c.id));
  if (schema.controls.length > MAX_CONTROLS) v.push(`more than ${MAX_CONTROLS} controls`);
  if (ids.size !== schema.controls.length) v.push('duplicate ids');

  const predOk = (p: any): boolean => {
    if (!p || typeof p !== 'object') return false;
    if (p.equals) return Array.isArray(p.equals) && ids.has(p.equals[0]);
    if (p.notEquals) return Array.isArray(p.notEquals) && ids.has(p.notEquals[0]);
    if (p.truthy !== undefined) return ids.has(p.truthy);
    if (p.all) return Array.isArray(p.all) && p.all.every(predOk);
    if (p.any) return Array.isArray(p.any) && p.any.every(predOk);
    return false;
  };

  for (const c of schema.controls as any[]) {
    const at = (m: string) => v.push(`${c.kind} "${c.id}": ${m}`);
    if (typeof c.id !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(c.id) || ['__proto__', 'constructor', 'prototype'].includes(c.id)) at('id the save path would refuse');
    if (c.kind === 'texture' && !(typeof c.default === 'string' || c.default === null)) at('texture default not string|null');
    if (c.kind === 'font' && typeof c.default !== 'string') at('font default not a string');
    if (c.kind === 'trigger' && c.default !== null && c.default !== undefined) at('trigger default present but not null');
    if (c.kind === 'text' && typeof c.default === 'string' && c.default.length > LIMITS.maxString) at('text default too long');
    if (c.kind === 'slider' || c.kind === 'stepper') {
      if (![c.min, c.max, c.default].every(storable)) at('non-finite / unstorable min|max|default');
      else {
        if (!(c.min < c.max)) at(`min >= max (${c.min}, ${c.max})`);
        if (c.default < c.min || c.default > c.max) at('default outside range');
        if (c.kind === 'stepper' && !(Number.isInteger(c.min) && Number.isInteger(c.max) && Number.isInteger(c.default))) at('stepper not whole-number');
        if (c.step !== undefined && !(isNum(c.step) && c.step > 0 && c.step <= c.max - c.min)) at(`bad step ${c.step}`);
        if (c.kind === 'stepper' && c.step !== undefined && !Number.isInteger(c.step)) at('stepper step not whole');
        if (c.scale === 'log' && !(c.min > 0)) at('log with min <= 0');
        if (c.scale !== undefined && c.scale !== 'log' && c.scale !== 'linear') at('bad scale');
      }
    } else if (c.kind === 'xy' || c.kind === 'vec3') {
      const n = c.kind === 'xy' ? 2 : 3;
      const arr = (a: any) => Array.isArray(a) && a.length === n && a.every(storable);
      if (!arr(c.min) || !arr(c.max) || !arr(c.default)) at('vector not finite / wrong length');
      else for (let i = 0; i < n; i++) {
        if (!(c.min[i] < c.max[i])) at(`axis ${i} min >= max`);
        if (c.default[i] < c.min[i] || c.default[i] > c.max[i]) at(`axis ${i} default outside`);
      }
    } else if (c.kind === 'color') {
      const d = c.default;
      const ch = (x: any) => isNum(x) && x >= 0 && x <= 1;
      if (!d || typeof d !== 'object' || !ch(d.r) || !ch(d.g) || !ch(d.b) || !ch(d.a)) at('invalid color default (alpha required)');
    } else if (c.kind === 'select') {
      if (!Array.isArray(c.options) || c.options.length === 0) at('select without options');
      else {
        const vals = c.options.map((o: any) => o?.value);
        if (!vals.every((x: any) => typeof x === 'string')) at('non-string option value');
        if (new Set(vals).size !== vals.length) at('duplicate option values');
        if (!vals.includes(c.default)) at('default not among options');
      }
    } else if (c.kind === 'toggle') {
      if (typeof c.default !== 'boolean') at('toggle default not boolean');
    } else if (c.kind === 'text') {
      if (typeof c.default !== 'string') at('text default not a string');
    }
    if (c.roll !== undefined && c.roll !== false) {
      if (!(c.roll && isNum(c.roll.min) && isNum(c.roll.max) && c.roll.min < c.roll.max)) at('bad roll window');
      if (c.kind !== 'slider' && c.kind !== 'stepper') at('roll window on a non-numeric control');
    }
    if (c.midi !== undefined && c.midi !== false) at('midi is not false');
    for (const key of ['showIf', 'disabledIf']) if (c[key] !== undefined && !predOk(c[key])) at(`${key} dangling / malformed`);
    if (c.maxIf !== undefined) {
      if (!Array.isArray(c.maxIf)) at('maxIf not an array');
      else for (const m of c.maxIf) if (!(m && isNum(m.max) && predOk(m.if) && (!isNum(c.min) || m.max > c.min) && Math.abs(m.max) <= MAX_STORABLE)) at('maxIf entry dangling / malformed / cap not above min / unstorable');
    }
  }
  return v;
}

/* ------------------------------------------------------------------ */

async function loadSeeds() {
  const seed = join(process.cwd(), 'seed');
  const manifest = JSON.parse(readFileSync(join(seed, 'manifest.json'), 'utf8')).assets as Array<{ slug: string; type: string; file: string }>;
  const out: Array<{ slug: string; schema: ControlSchema; warnings: Array<{ level: string; message: string; name?: string; id?: string }> }> = [];
  for (const e of manifest) {
    const path = join(seed, e.file);
    if (e.type === 'shader') {
      const r = parseUniforms(readFileSync(path, 'utf8'), { schemaId: `shader:${e.slug}` });
      out.push({ slug: e.slug, schema: r.schema, warnings: r.warnings });
    } else {
      const mod = (await import(pathToFileURL(path).href)) as { params?: unknown };
      const r = paramsToSchema(mod.params, { schemaId: `sketch:${e.slug}` });
      out.push({ slug: e.slug, schema: r.schema, warnings: r.warnings });
    }
  }
  return out;
}

const GLSL_HEAD = '#version 300 es\nprecision highp float;\nout vec4 o;\n';
const GLSL_TAIL = '\nvoid main(){o=vec4(1.);}';
const glsl = (lines: string[]) => GLSL_HEAD + lines.join('\n') + GLSL_TAIL;
const oneGlsl = (type: string, ann: string, name = 'u_x') => parseUniforms(glsl([`uniform ${type} ${name}; // ${ann}`]));
const only = (r: { schema: ControlSchema }) => r.schema.controls[0] as any;
const sl = (o: Record<string, unknown>) => ({ id: 'a', label: 'A', kind: 'slider', min: 0, max: 10, default: 5, ...o }) as unknown as Control;
const fixed = (c: Control) => repairControl(c);

async function main(): Promise<void> {
  /* ================================================================ *
   * 1. Seeds untouched
   * ================================================================ */
  group('1. the seed library is untouched');
  const seeds = await loadSeeds();
  check('all seed tiles loaded', seeds.length >= 99, seeds.length);
  let untouched = 0;
  let sanitizerWarnings = 0;
  for (const s of seeds) {
    const again = sanitizeSchema(s.schema);
    if (!again.changed && again.schema === s.schema) untouched++;
    sanitizerWarnings += s.warnings.filter((w) => w.level === 'warn' && (w.name ?? w.id) && w.message.startsWith(`${w.name ?? w.id}: `)).length;
    const bad = violations(s.schema);
    if (bad.length) check(`seed ${s.slug} is well-formed by the independent check`, false, bad.slice(0, 2));
  }
  console.log(`  ${untouched}/${seeds.length} sanitize to the SAME object; sanitizer-originated warnings across the library: ${sanitizerWarnings}`);
  check('every seed tile sanitizes to the identical object (no repair needed)', untouched === seeds.length, untouched);
  check('no seed tile produces a sanitizer warning', sanitizerWarnings === 0, sanitizerWarnings);
  check('every seed control satisfies the independent well-formedness check', seeds.every((s) => violations(s.schema).length === 0));
  check('every seed control passes isWellFormed (the engine guard)', seeds.every((s) => s.schema.controls.every(isWellFormed)));

  /* ================================================================ *
   * 2. Repair rules
   * ================================================================ */
  group('2. each repair rule');
  {
    const r = fixed(sl({ min: 10, max: 1, default: 5 })).control as any;
    check('reversed range is swapped', r.min === 1 && r.max === 10);
    const e = fixed(sl({ min: 5, max: 5, default: 5 })).control as any;
    check('min == max is widened to [x, x+1]', e.min === 5 && e.max === 6 && e.default === 5, [e.min, e.max]);
    const nf = fixed(sl({ min: 'a', max: Infinity, default: NaN })).control as any;
    check('non-finite bounds become a finite range; NaN default becomes the midpoint', isNum(nf.min) && isNum(nf.max) && nf.min < nf.max && isNum(nf.default), nf);
    const oneSided = fixed(sl({ min: NaN, max: 4, default: 1 })).control as any;
    check('one good bound is kept (min replaced by max - 1)', oneSided.max === 4 && oneSided.min === 3, oneSided);
    const big = fixed(sl({ min: -1e308, max: 1e308, default: 0 })).control as any;
    check(`bounds beyond ±${MAX_STORABLE} are clamped to the storable range`, big.min === -MAX_STORABLE && big.max === MAX_STORABLE, [big.min, big.max]);
    check('default outside the range is clamped', (fixed(sl({ default: 99 })).control as any).default === 10 && (fixed(sl({ default: -3 })).control as any).default === 0);
    check('step <= 0 is removed', !('step' in (fixed(sl({ step: 0 })).control as any)) && !('step' in (fixed(sl({ step: -1 })).control as any)));
    check('step larger than the range is removed', !('step' in (fixed(sl({ step: 50 })).control as any)));
    check('a valid step is left alone', (fixed(sl({ step: 0.5 })).control as any) === undefined ? false : (fixed(sl({ step: 0.5 })).notes.length === 0));
    check('log scale with min <= 0 falls back to linear', !('scale' in (fixed(sl({ scale: 'log', min: 0 })).control as any)) && !('scale' in (fixed(sl({ scale: 'log', min: -2 })).control as any)));
    check('log scale with min > 0 is kept', fixed(sl({ scale: 'log', min: 0.1 })).notes.length === 0);
    check('an unknown scale is removed', !('scale' in (fixed(sl({ scale: 'exp' })).control as any)));

    const st = fixed({ id: 's', label: 'S', kind: 'stepper', min: 0.5, max: 2.5, default: 1.4, step: 0.5 } as unknown as Control).control as any;
    check('stepper bounds become whole numbers ([0.5, 2.5] -> [1, 2])', st.min === 1 && st.max === 2, [st.min, st.max]);
    check('stepper default is rounded, step made whole', Number.isInteger(st.default) && st.step === 1, [st.default, st.step]);

    const xy = fixed({ id: 'x', label: 'X', kind: 'xy', min: [1, 1], max: [0, 0], default: [0.5, 0.5] } as unknown as Control).control as any;
    check('xy reversed axes are swapped per axis', xy.min[0] === 0 && xy.max[0] === 1 && xy.min[1] === 0 && xy.max[1] === 1, xy);
    const xy2 = fixed({ id: 'x', label: 'X', kind: 'xy', min: 'a', max: [0, 1, 2], default: null } as unknown as Control).control as any;
    check('xy with the wrong shape is rebuilt', Array.isArray(xy2.min) && xy2.min.length === 2 && xy2.default.length === 2);
    const v3 = fixed({ id: 'v', label: 'V', kind: 'vec3', min: [-1, -1, -1], max: [1, 1, 1], default: [0, 9, 0] } as unknown as Control).control as any;
    check('vec3 default outside its axis range is clamped', v3.default[1] === 1, v3.default);

    const col = (d: unknown) => fixed({ id: 'c', label: 'C', kind: 'color', default: d } as unknown as Control).control as any;
    check('color default "red" becomes white', JSON.stringify(col('red').default) === JSON.stringify({ r: 1, g: 1, b: 1, a: 1 }));
    check('color channels are clamped to 0..1, NaN channel -> 1', (() => { const d = col({ r: 9, g: -9, b: NaN, a: 5 }).default; return d.r === 1 && d.g === 0 && d.b === 1 && d.a === 1; })());
    check('a valid color is untouched', fixed({ id: 'c', label: 'C', kind: 'color', default: { r: 0.2, g: 0.3, b: 0.4, a: 1 } } as unknown as Control).notes.length === 0);
    check('a color with no alpha gets a = 1 (Roll would otherwise build {a: undefined}, which cannot be saved)', JSON.stringify((fixed({ id: 'c', label: 'C', kind: 'color', default: { r: 0.2, g: 0.3, b: 0.4 } } as unknown as Control).control as any).default) === JSON.stringify({ r: 0.2, g: 0.3, b: 0.4, a: 1 }));

    const sel = (o: unknown, d: unknown) => fixed({ id: 's', label: 'S', kind: 'select', options: o, default: d } as unknown as Control);
    check('select with no options is DROPPED (unrecoverable)', sel([], 'a').control === null && sel(undefined, 'a').control === null);
    check('select with only garbage options is dropped', sel([null, {}, 5.5 === 5.5 ? undefined : 1], 'a').control === null);
    const s1 = sel(['a', 'b'], 'a').control as any;
    check('string options are normalised to { label, value }', s1.options[0].value === 'a' && s1.options[0].label === 'a' && s1.options.length === 2);
    const s2 = sel([{ label: 'A', value: 'a' }, { label: 'A2', value: 'a' }], 'a').control as any;
    check('duplicate option values are removed (first wins)', s2.options.length === 1 && s2.options[0].label === 'A');
    check('a default that is not an option becomes the first option', (sel([{ label: 'A', value: 'a' }, { label: 'B', value: 'b' }], 'zzz').control as any).default === 'a');
    check('numeric option values become strings', (sel([{ label: 'A', value: 1 }], '1').control as any).options[0].value === '1');

    check('toggle default is coerced to a boolean', (fixed({ id: 't', label: 'T', kind: 'toggle', default: 'yes' } as unknown as Control).control as any).default === true);
    check('text default is coerced to a string', (fixed({ id: 't', label: 'T', kind: 'text', default: 5 } as unknown as Control).control as any).default === '');

    for (const badId of ['a b', 'my param', 'a/b', 'é', 'x'.repeat(129), 'constructor', '__proto__', 'prototype', '']) {
      const r = fixed({ id: badId, label: 'x', kind: 'toggle', default: true } as unknown as Control);
      check(`an id the save path refuses ("${badId.slice(0, 12)}") is DROPPED with the reason`, r.control === null && /parameter name|id/.test(r.notes.join(' ')) || badId === '');
    }
    check('valid unusual ids are kept (dots, colons, dashes, digits)', ['a.b', 'a:b', 'a-b', 'A1_2'].every((id) => fixed({ id, label: 'x', kind: 'toggle', default: true } as unknown as Control).notes.length === 0));
    check('a texture default that is not a string/null becomes null', (fixed({ id: 't', label: 'T', kind: 'texture', default: {} } as unknown as Control).control as any).default === null);
    check('a font default that is not a string becomes ""', (fixed({ id: 'f', label: 'F', kind: 'font', default: [] } as unknown as Control).control as any).default === '');
    check('a trigger default that is present and not null is reset', (fixed({ id: 'g', label: 'G', kind: 'trigger', default: 5 } as unknown as Control).control as any).default === null);
    // REGRESSION (found by the seed check): rippling-table's "Clear ripples" trigger has no `default` at all.
    const bareTrigger = { id: 'clearRipples', label: 'Clear ripples', kind: 'trigger', event: 'clear' } as unknown as Control;
    check('a trigger with NO default (as shipped in rippling-table) is left exactly alone', fixed(bareTrigger).control === bareTrigger && fixed(bareTrigger).notes.length === 0);
    check(`a text default over ${LIMITS.maxString} characters is truncated (it could not be saved)`, (fixed({ id: 't', label: 'T', kind: 'text', default: 'x'.repeat(LIMITS.maxString + 50) } as unknown as Control).control as any).default.length === LIMITS.maxString);
    check('a select option whose value is too long to save is removed', (fixed({ id: 's', label: 'S', kind: 'select', options: [{ label: 'ok', value: 'a' }, { label: 'huge', value: 'y'.repeat(LIMITS.maxString + 1) }], default: 'a' } as unknown as Control).control as any).options.length === 1);
    for (const [kind, def] of [['trigger', null], ['texture', null], ['texture', 'blob:x'], ['font', 'sans']] as const) {
      check(`a well-formed ${kind} control (default ${JSON.stringify(def)}) is left alone`, fixed({ id: 'k', label: 'K', kind, default: def } as unknown as Control).notes.length === 0);
    }

    const clean = sl({});
    const rc = fixed(clean);
    check('a well-formed control comes back as the SAME object with no notes (identity)', rc.control === clean && rc.notes.length === 0);
    const once = fixed(sl({ min: 10, max: 1, step: 0, default: NaN })).control as Control;
    const twice = fixed(once);
    check('repair is idempotent (a repaired control needs no further repair)', twice.control === once && twice.notes.length === 0);
    check('isWellFormed agrees with repair', isWellFormed(clean) && !isWellFormed(sl({ min: 10, max: 1 })));
  }

  group('2b. roll hints, predicates, duplicates, the cap');
  {
    const rr = (roll: unknown, extra: Record<string, unknown> = {}) => fixed(sl({ roll, ...extra }));
    check('a valid @roll window is kept', rr({ min: 2, max: 3 }).notes.length === 0);
    check('@noroll (false) is kept', rr(false).notes.length === 0);
    check('a reversed / equal / NaN / non-object roll window is removed', [{ min: 3, max: 2 }, { min: 2, max: 2 }, { min: NaN, max: NaN }, 'x', 5, null].every((r) => !('roll' in (rr(r).control as any))));
    check('a roll WINDOW on a non-numeric control is removed (false is still fine)', !('roll' in (fixed({ id: 'c', label: 'C', kind: 'color', default: { r: 1, g: 1, b: 1, a: 1 }, roll: { min: 0, max: 1 } } as unknown as Control).control as any)) && fixed({ id: 'c', label: 'C', kind: 'color', default: { r: 1, g: 1, b: 1, a: 1 }, roll: false } as unknown as Control).notes.length === 0);

    const mk = (cs: any[]) => sanitizeSchema(createSchema('t', cs));
    const a = { id: 'a', label: 'A', kind: 'toggle', default: true };
    const b = (extra: Record<string, unknown>) => ({ id: 'b', label: 'B', kind: 'slider', min: 0, max: 1, default: 0.5, ...extra });
    check('showIf that refers to a real control is kept', mk([a, b({ showIf: { truthy: 'a' } })]).changed === false);
    const dangling = mk([a, b({ showIf: { truthy: 'ghost' } })]);
    check('showIf that refers to a MISSING control is removed with a warning', dangling.changed && !('showIf' in (dangling.schema.controls[1] as any)) && dangling.warnings.some((w) => /showIf/.test(w.message)));
    check('a malformed / partly-dangling all[] predicate is removed', !('showIf' in (mk([a, b({ showIf: { all: [{ truthy: 'a' }, { truthy: 'nope' }] } })]).schema.controls[1] as any)) && !('showIf' in (mk([a, b({ showIf: { bogus: 1 } })]).schema.controls[1] as any)));
    const mi = mk([a, b({ maxIf: [{ if: { truthy: 'a' }, max: 1 }, { if: { truthy: 'ghost' }, max: 1 }, { if: { truthy: 'a' }, max: NaN }] })]);
    check('maxIf keeps only its valid entries', (mi.schema.controls[1] as any).maxIf.length === 1);
    const floorCase = mk([a, b({ min: 5, max: 10, default: 6, maxIf: [{ if: { truthy: 'a' }, max: 3 }, { if: { truthy: 'a' }, max: 5 }, { if: { truthy: 'a' }, max: 8 }] })]);
    const bigCap = mk([a, b({ maxIf: [{ if: { truthy: 'a' }, max: 1e13 }] })]);
    check(`a maxIf cap above ±${MAX_STORABLE} is clamped (it can raise a ceiling, so it must stay storable)`, (bigCap.schema.controls[1] as any).maxIf[0].max === MAX_STORABLE);
    check("maxIf entries whose cap is at or below the control's own min are removed (they would collapse its range)", (floorCase.schema.controls[1] as any).maxIf.length === 1 && (floorCase.schema.controls[1] as any).maxIf[0].max === 8);
    check('a control removed by the sanitizer orphans no predicate (predicates are checked last)', !('showIf' in (mk([{ id: 's', label: 'S', kind: 'select', options: [], default: '' }, b({ showIf: { equals: ['s', 'x'] } })]).schema.controls[0] as any)));

    const dup = mk([b({}), b({ min: 5, max: 6, default: 5 })]);
    check('duplicate ids keep the first', dup.schema.controls.length === 1 && (dup.schema.controls[0] as any).max === 1);
    check('a control without an id is removed', mk([{ label: 'x', kind: 'slider', min: 0, max: 1, default: 0 }, { id: '', kind: 'toggle', default: true }]).schema.controls.length === 0);

    const many = Array.from({ length: 300 }, (_, i) => ({ id: `c${i}`, label: `C${i}`, kind: 'slider', min: 0, max: 1, default: 0.5 }));
    const capped = mk(many);
    check(`a schema over ${MAX_CONTROLS} controls is truncated to ${MAX_CONTROLS}`, capped.schema.controls.length === MAX_CONTROLS);
    check('...with ONE warning that names how many were dropped', capped.warnings.filter((w) => /limit/.test(w.message)).length === 1 && /44 controls/.test(capped.warnings[0].message), capped.warnings[0]?.message);
    check('...and exactly MAX_CONTROLS is left untouched', mk(many.slice(0, MAX_CONTROLS)).changed === false);
    check("the cap is the SERVER's params limit (a 256-key state saves, 257 does not)", MAX_CONTROLS === LIMITS.maxKeys && validateParamState(Object.fromEntries(Array.from({ length: 256 }, (_, i) => [`k${i}`, 1]))).ok === true && validateParamState(Object.fromEntries(Array.from({ length: 257 }, (_, i) => [`k${i}`, 1]))).ok === false);
    check("the storable range is the SERVER's number limit", MAX_STORABLE === LIMITS.maxNumber);
    check('warnings are written for a person: they start with the control id', capped.warnings.length > 0 && dangling.warnings.every((w) => w.message.startsWith(`${w.id}: `)));
  }

  /* ================================================================ *
   * 3. Parsers: the warnings reach the editor with a line number
   * ================================================================ */
  group('3. through the real parsers');
  {
    const r = parseUniforms(glsl(['uniform float u_ok; // @range(0,1)', 'uniform float u_bad; // @range(10,1) @default(99)']));
    const c = (r.schema.controls as any[]).find((x) => x.id === 'u_bad');
    check('GLSL: a reversed @range is repaired end to end (range swapped, default kept inside it)', c.min === 1 && c.max === 10 && c.default >= 1 && c.default <= 10, [c.min, c.max, c.default]);
    const w = r.warnings.filter((x) => x.name === 'u_bad');
    check('GLSL: the warning names the uniform and its SOURCE LINE', w.length >= 1 && w.every((x) => x.line === 5) && w.some((x) => /swapped/.test(x.message)), w);
    check('GLSL: a clean uniform gets no warning', r.warnings.filter((x) => x.name === 'u_ok').length === 0);

    const p = paramsToSchema({ ok: { kind: 'slider', min: 0, max: 1, default: 0 }, bad: { kind: 'slider', min: 5, max: 5, default: 5 } });
    check('sketch: an equal range is widened end to end', (p.schema.controls.find((x: any) => x.id === 'bad') as any).max === 6);
    check('sketch: the warning carries the control id', p.warnings.some((x) => x.id === 'bad' && /widened/.test(x.message)));
    const q = paramsToSchema({ x: { kind: 'select', options: [], default: 'a' } });
    check('sketch: an unrecoverable control is dropped and says so', q.schema.controls.length === 0 && q.warnings.some((x) => /removed/.test(x.message)));
    check('sketch: a `roll` field the author wrote passes through (and is validated)', (paramsToSchema({ s: { kind: 'slider', min: 0, max: 9, default: 1, roll: { min: 2, max: 4 } } }).schema.controls[0] as any).roll.max === 4 && !('roll' in (paramsToSchema({ s: { kind: 'slider', min: 0, max: 9, default: 1, roll: { min: 4, max: 2 } } }).schema.controls[0] as any)));
    check('sketch: `roll: false` is kept', (paramsToSchema({ s: { kind: 'slider', min: 0, max: 9, default: 1, roll: false } }).schema.controls[0] as any).roll === false);
  }

  /* ================================================================ *
   * 4. Fuzz: random descriptors and random annotation soup
   * ================================================================ */
  group('4. fuzz — parser -> schema -> Roll/Mutate -> the server validator');
  const GARBAGE: unknown[] = [0, 1, -1, 0.5, 2, 3, 10, 100, 1e-9, 1e13, -1e13, 1e308, -1e308, Infinity, -Infinity, NaN, '5', 'abc', '', null, undefined, true, false, [], {}, [1], [1, 2], [1, 2, 3], { r: 2, g: -1, b: NaN }, { r: 0.2, g: 0.4, b: 0.6 }, { r: 0.2, g: 0.4, b: 0.6, a: 7 }, 'red'];
  const pick = <T,>(rng: Rng, a: readonly T[]): T => a[Math.floor(rng() * a.length)];
  const val = (rng: Rng, good: () => unknown) => (rng() < 0.55 ? good() : pick(rng, GARBAGE));
  const KINDS = ['slider', 'slider', 'slider', 'stepper', 'toggle', 'color', 'color', 'select', 'select', 'xy', 'vec3', 'text', 'trigger', 'texture', 'font', 'nope', 'slider'] as const;

  function randomParams(rng: Rng, nameOf: (i: number) => string): Record<string, unknown> {
    const n = 2 + Math.floor(rng() * 38);
    const names = Array.from({ length: n + 3 }, (_, i) => nameOf(i));
    const out: Record<string, unknown> = {};
    for (let i = 0; i < n; i++) {
      const kind = pick(rng, KINDS);
      const d: Record<string, unknown> = { kind };
      const lo = () => Math.round(rng() * 20 - 5);
      const numeric = () => ({ min: val(rng, lo), max: val(rng, () => lo() + 5), default: val(rng, () => rng() * 10) });
      if (kind === 'slider' || kind === 'stepper') Object.assign(d, numeric());
      if (kind === 'slider' && rng() < 0.3) d.scale = pick(rng, ['log', 'linear', 'exp', 5]);
      if ((kind === 'slider' || kind === 'stepper' || kind === 'xy' || kind === 'vec3') && rng() < 0.4) d.step = val(rng, () => pick(rng, [0.1, 1, 2, 0.25]));
      if (kind === 'xy') Object.assign(d, { min: val(rng, () => [0, 0]), max: val(rng, () => [1, 1]), default: val(rng, () => [0.5, 0.5]) });
      if (kind === 'vec3') Object.assign(d, { min: val(rng, () => [-1, -1, -1]), max: val(rng, () => [1, 1, 1]), default: val(rng, () => [0, 0, 0]) });
      if (kind === 'toggle') d.default = val(rng, () => rng() < 0.5);
      if (kind === 'color') d.default = val(rng, () => ({ r: rng(), g: rng(), b: rng(), a: 1 }));
      if (kind === 'select') { d.options = val(rng, () => [{ label: 'A', value: 'a' }, { label: 'B', value: 'b' }]); d.default = val(rng, () => pick(rng, ['a', 'b'])); }
      if (kind === 'text') d.default = val(rng, () => 'hi');
      if (kind === 'trigger') d.event = 'go';
      if (rng() < 0.25) d.roll = val(rng, () => (rng() < 0.4 ? false : { min: 1, max: 4 }));
      if (rng() < 0.15) d.midi = val(rng, () => false);
      if (rng() < 0.15) d.showIf = val(rng, () => ({ truthy: pick(rng, names) }));
      if (rng() < 0.1) d.maxIf = val(rng, () => [{ if: { truthy: pick(rng, names) }, max: val(rng, () => 3) }]);
      if (rng() < 0.1) d.disabledIf = val(rng, () => ({ equals: [pick(rng, names), 'a'] }));
      out[names[i]] = d;
    }
    return out;
  }

  const NUM = ['0', '1', '-1', '0.5', '2', '10', '100', '1e-9', '1e13', '-1e13', '1e308', 'abc', '', 'nan', 'inf', '-0'];
  function randomGlsl(rng: Rng): string {
    const n = 2 + Math.floor(rng() * 28);
    const lines: string[] = [];
    for (let i = 0; i < n; i++) {
      const type = pick(rng, ['float', 'float', 'float', 'int', 'uint', 'vec2', 'vec3', 'vec4', 'bool']);
      const tags: string[] = [];
      const num = () => pick(rng, NUM);
      const tagPool = [
        () => `@range(${num()},${num()})`, () => `@range(${num()})`, () => `@step(${num()})`, () => `@default(${num()})`,
        () => `@default(${num()},${num()})`, () => `@default(${num()},${num()},${num()})`, () => '@log', () => '@color',
        () => `@select(${pick(rng, ['A=0|B=1', '', 'A=0', 'A=0|A=1|B=1', 'A|B|C'])})`, () => `@roll(${num()},${num()})`, () => '@roll', () => '@noroll',
        () => '@advanced', () => '@mod', () => '@nomod', () => '@label(x)', () => '@strip', () => '@hidden',
      ];
      for (let t = Math.floor(rng() * 5); t > 0; t--) tags.push(pick(rng, tagPool)());
      lines.push(`uniform ${type} u_${i}; // ${tags.join(' ')}`);
    }
    return glsl(lines);
  }

  function assertPipeline(label: string, make: () => { schema: ControlSchema }, rng: Rng, runEngine: boolean, sink: { schemas: number; controls: number; bad: string[]; runs: number; drops: number }): void {
    let schema: ControlSchema;
    try {
      schema = make().schema;
    } catch (e) {
      sink.bad.push(`${label}: THROWS ${(e as Error).message}`);
      return;
    }
    sink.schemas++;
    sink.controls += schema.controls.length;
    const v = violations(schema);
    if (v.length) sink.bad.push(`${label}: ${v[0]}`);
    if (!schema.controls.every(isWellFormed)) sink.bad.push(`${label}: isWellFormed disagrees with the independent check`);
    const again = sanitizeSchema(schema);
    if (again.changed) sink.bad.push(`${label}: NOT idempotent (${again.warnings[0]?.message})`);
    const round = sanitizeSchema(JSON.parse(JSON.stringify(schema)));
    if (round.changed) sink.bad.push(`${label}: does not survive a JSON round trip (${round.warnings[0]?.message})`);
    const base = defaultsOf(schema);
    const vb = validateParamState(base);
    if (!vb.ok) sink.bad.push(`${label}: default state not saveable: ${JSON.stringify(vb)}`);

    if (!runEngine) return;
    for (let i = 0; i < 4; i++) {
      for (const mode of ['roll', 'mutate', 'strong'] as const) {
        let res;
        try {
          const start: ParamState = i % 2 ? base : rollParams(schema, base, { rng }).params;
          res = mode === 'roll' ? rollParams(schema, start, { rng, includeToggles: i === 2 }) : mutateParams(schema, start, { strength: mode === 'strong' ? 1 : 0.3, rng });
        } catch (e) {
          sink.bad.push(`${label}: ${mode} THROWS ${(e as Error).message}`);
          continue;
        }
        sink.runs++;
        const saved = validateParamState(res.params);
        if (!saved.ok) {
          // Name the offender — a bare "unsaveable" is useless when a fuzz case fails.
          const key = /"([^"]+)"/.exec((saved as { error?: string }).error ?? '')?.[1];
          const ctl = schema.controls.find((c) => c.id === key);
          sink.bad.push(`${label}: ${mode} produced an UNSAVEABLE state ${JSON.stringify(saved)} :: control=${JSON.stringify(ctl)} value=${JSON.stringify(key ? res.params[key] : undefined)} changed=${key ? res.changed.includes(key) : '?'}`);
        }
        for (const c of schema.controls as any[]) {
          if (!res.changed.includes(c.id)) continue;
          const x = res.params[c.id];
          if (c.kind === 'slider' || c.kind === 'stepper') {
            const hi = effectiveMax(c, res.params) ?? c.max;
            if (!(x as number >= c.min - 1e-9 && (x as number) <= hi + 1e-9)) sink.bad.push(`${label}: ${mode} value out of range on ${c.id}`);
          }
          if (!sameValue(coerce(c, x ?? null, res.params), x)) sink.bad.push(`${label}: ${mode} value not coerce-stable on ${c.id}`);
        }
      }
    }
  }

  const P5_TRIALS = 600;
  const GLSL_TRIALS = 600;
  const sinkP = { schemas: 0, controls: 0, bad: [] as string[], runs: 0, drops: 0 };
  const sinkG = { schemas: 0, controls: 0, bad: [] as string[], runs: 0, drops: 0 };
  for (let t = 0; t < P5_TRIALS; t++) {
    const rng = mulberry32(0x5eed + t);
    const params = randomParams(rng, (i) => pick(rng, ['speed', 'count', 'flashRate', 'hue', 'mode', 'x', 'y', 'size', 'amount', 'toString', 'constructor', 'a b']) + i);
    assertPipeline(`p5#${t}`, () => paramsToSchema(params), rng, t % 2 === 0, sinkP);
  }
  for (let t = 0; t < GLSL_TRIALS; t++) {
    const rng = mulberry32(0xa11c + t);
    const src = randomGlsl(rng);
    assertPipeline(`glsl#${t}`, () => parseUniforms(src), rng, t % 2 === 0, sinkG);
  }
  console.log(`  sketch: ${sinkP.schemas} random params objects -> ${sinkP.controls} controls, ${sinkP.runs} Roll/Mutate runs`);
  console.log(`  GLSL:   ${sinkG.schemas} random annotation-soup shaders -> ${sinkG.controls} controls, ${sinkG.runs} Roll/Mutate runs`);
  const uniqueBad = [...new Set([...sinkP.bad, ...sinkG.bad].map((m) => m.replace(/^(p5|glsl)#\d+/, '$1')))];
  check('the fuzz never throws, never emits a malformed control, is idempotent and JSON-stable, and every state Roll/Mutate produce is SAVEABLE', uniqueBad.length === 0, uniqueBad.slice(0, 5));
  for (const m of uniqueBad.slice(0, 3)) process.stderr.write(`     ${m.slice(0, 700)}\n`);
  check('the fuzz actually exercised a large volume', sinkP.controls + sinkG.controls > 8000 && sinkP.runs + sinkG.runs > 5000, [sinkP.controls + sinkG.controls, sinkP.runs + sinkG.runs]);

  /* ================================================================ *
   * 5. The engine refuses a malformed control on its own
   * ================================================================ */
  group('5. engine guard (schemas that never saw the sanitizer)');
  {
    const good = sl({ id: 'good', min: 0, max: 10, default: 5 });
    const badControls = [
      sl({ id: 'flat', min: 5, max: 5, default: 5 }),
      sl({ id: 'nan', min: NaN, max: 1, default: 0 }),
      sl({ id: 'inf', min: 0, max: Infinity, default: 1 }),
      sl({ id: 'rev', min: 9, max: 1, default: 2 }),
      sl({ id: 'huge', min: -1e308, max: 1e308, default: 0 }),
      { id: 'xy', label: 'xy', kind: 'xy', min: [1, 1], max: [0, 0], default: [0.5, 0.5] },
      { id: 'col', label: 'col', kind: 'color', default: 'red' },
      { id: 'sel', label: 'sel', kind: 'select', options: [], default: 'x' },
      sl({ id: 'badroll', roll: { min: 9, max: 1 } }),
    ] as unknown as Control[];
    const schema = createSchema('raw', [good, ...badControls]); // NOT sanitized
    const base = defaultsOf(schema);
    let moved = 0;
    let bad = 0;
    let threw = 0;
    let malformed = 0;
    for (let i = 0; i < 300; i++) {
      for (const m of ['roll', 'mutate'] as const) {
        try {
          const r = m === 'roll' ? rollParams(schema, base, { rng: mulberry32(i) }) : mutateParams(schema, base, { strength: 0.5, rng: mulberry32(i) });
          if (r.changed.some((id) => id !== 'good')) bad++;
          if (r.changed.includes('good')) moved++;
          malformed = r.skipped.malformed ?? 0;
          for (const id of Object.keys(r.params)) {
            const v = r.params[id];
            if (typeof v === 'number' && !Number.isFinite(v)) bad++;
          }
        } catch {
          threw++;
        }
      }
    }
    check('Roll / Mutate never throw on malformed controls', threw === 0, threw);
    check('...never touch them and never emit NaN / Infinity', bad === 0, bad);
    check('...while the one good control still rolls', moved > 200, moved);
    check("the malformed controls are reported as skipped for the right reason ('malformed')", malformed === badControls.length, malformed);
    check('a malformed control gets no padlock in the UI', badControls.every((c) => !isRollableControl(c, null)) && isRollableControl(good, null));
  }

  /* ================================================================ *
   * 6. @roll / @noroll
   * ================================================================ */
  group('6. author hints');
  {
    const a = only(oneGlsl('float', '@range(0,10) @roll(2,3)'));
    check('GLSL: @roll(min, max) is parsed', a.roll && a.roll.min === 2 && a.roll.max === 3, a.roll);
    check('GLSL: @noroll is parsed to false', only(oneGlsl('float', '@range(0,10) @noroll')).roll === false);
    check('GLSL: with both, the LAST one wins', only(oneGlsl('float', '@range(0,10) @roll(1,2) @noroll')).roll === false && only(oneGlsl('float', '@range(0,10) @noroll @roll(1,2)')).roll.max === 2);
    for (const bad of ['@roll(3,2)', '@roll(a,b)', '@roll', '@roll(1)', '@roll(1,2,3)', '@roll(nan,4)']) {
      const r = oneGlsl('float', `@range(0,10) ${bad}`);
      check(`GLSL: "${bad}" is dropped WITH a warning on its line`, !('roll' in only(r)) && r.warnings.some((w) => /@roll/.test(w.message) && w.line === 4), r.warnings.map((w) => w.message));
    }
    const onColor = oneGlsl('vec3', '@color @roll(0,1)');
    check('GLSL: @roll(min, max) on a color is dropped with a warning', !('roll' in only(onColor)) && onColor.warnings.some((w) => /only applies to sliders/.test(w.message)));
    check('GLSL: @noroll on a color is fine', only(oneGlsl('vec3', '@color @noroll')).roll === false);

    // ---- @nomidi / midi: false (hides the MIDI pill; a UI-only opt-out)
    check('GLSL: @nomidi is parsed to false', only(oneGlsl('float', '@range(0,10) @nomidi')).midi === false);
    check('GLSL: without @nomidi the control carries no midi field at all', !('midi' in JSON.parse(JSON.stringify(only(oneGlsl('float', '@range(0,10)'))))));
    const combo = only(oneGlsl('float', '@range(0,10) @advanced @nomidi @noroll'));
    check('GLSL: @nomidi combines with @advanced and @noroll independently', combo.midi === false && combo.advanced === true && combo.roll === false);
    check('GLSL: @nomidi on any kind is fine (a toggle, a vec2, a select)', ['bool', 'vec2'].every((t) => only(oneGlsl(t, '@nomidi')).midi === false) && only(oneGlsl('int', '@select(A=0|B=1) @nomidi')).midi === false);
    check('sketch: `midi: false` passes through and is kept', (paramsToSchema({ s: { kind: 'slider', min: 0, max: 9, default: 1, midi: false } }).schema.controls[0] as any).midi === false);
    for (const bad of [true, 'no', 0, null, {}]) {
      const r = paramsToSchema({ s: { kind: 'slider', min: 0, max: 9, default: 1, midi: bad } });
      check(`sketch: midi: ${JSON.stringify(bad)} means nothing — removed WITH a warning`, !('midi' in (r.schema.controls[0] as any)) && r.warnings.some((w) => /midi can only be false/.test(w.message)), r.warnings.map((w) => w.message));
    }
    check('a well-formed midi: false control is left exactly alone (identity)', (() => { const c = sl({ midi: false }); return fixed(c).control === c && fixed(c).notes.length === 0; })());
    check('a nomidi control still rolls normally (the pill is UI only)', (() => { const c = sl({ midi: false }); const sch = createSchema('t', [c]); return rollParams(sch, defaultsOf(sch), { rng: mulberry32(5) }).changed.includes('a'); })());

    // ---- policy precedence
    const speed = (extra: string) => only(oneGlsl('float', `@range(0,100) @default(10) ${extra}`, 'u_speed'));
    const plain = speed('');
    check('without @roll a speed-named control gets the automatic 1/2x..2x window', policyFor(plain, null).safety?.kind === 'speed');
    const withRoll = speed('@roll(0,100)');
    check('an explicit @roll BEATS the automatic speed window', policyFor(withRoll, null).safety?.kind === 'author' && policyFor(withRoll, null).safety?.absolute === true);
    check('@noroll skips the control (reason: author)', policyFor(speed('@noroll'), null).skip === true && policyFor(speed('@noroll'), null).reason === 'author');

    const run = (control: Control, mode: 'roll' | 'mutate', n = 400, current?: number, assetId: string | null = null) => {
      const schema = createSchema('t', [control]);
      const base = defaultsOf(schema);
      const start = current === undefined ? base : { ...base, [control.id]: current };
      const vals: number[] = [];
      for (let i = 0; i < n; i++) {
        const r = mode === 'roll' ? rollParams(schema, start, { rng: mulberry32(i), assetId }) : mutateParams(schema, start, { strength: 0.5, rng: mulberry32(i), assetId });
        vals.push(r.params[control.id] as number);
      }
      return vals;
    };
    const wide = run(withRoll, 'roll');
    check('a Roll samples the author window, past what the automatic window would allow (default 10 -> values above 20)', wide.some((x) => x > 20) && wide.every((x) => x >= 0 && x <= 100));
    const narrow = run(speed('@roll(40,60)'), 'roll');
    check('a narrow @roll(40,60) is honoured exactly', narrow.every((x) => x >= 40 && x <= 60) && Math.max(...narrow) > 58 && Math.min(...narrow) < 42, [Math.min(...narrow), Math.max(...narrow)]);
    const meanN = narrow.reduce((s, x) => s + x, 0) / narrow.length;
    check('...sampling the WHOLE window (no 10% trim), centred', Math.abs(meanN - 50) < 1.5, meanN);
    const clipped = run(only(oneGlsl('float', '@range(0,10) @roll(5,50)')), 'roll');
    check('an author window is intersected with the control range', clipped.every((x) => x >= 5 && x <= 10));
    const outside = run(only(oneGlsl('float', '@range(0,10) @roll(50,60)')), 'roll');
    check('a window entirely outside the range falls back to the range (never out of bounds)', outside.every((x) => x >= 0 && x <= 10));
    const mut = run(speed('@roll(40,60)'), 'mutate', 300, 90);
    check("Mutate never pushes an author-window control past where it already was (current 90, window 40..60)", mut.every((x) => x <= 90 + 1e-9 && x >= 40 - 1e-9));
    const frozen = run(speed('@noroll'), 'roll').concat(run(speed('@noroll'), 'mutate'));
    check('@noroll: 800 Rolls/Mutates never move it', frozen.every((x) => x === 10));

    // ---- the flash exclusion cannot be lifted by an author
    const flash = only(oneGlsl('float', '@range(0.5,20) @default(6) @roll(1,2)', 'u_flashRate'));
    check("an author's @roll CANNOT lift the flash exclusion", policyFor(flash, null).skip === true && policyFor(flash, null).reason === 'flash');
    check('...so 800 Rolls/Mutates never move it', run(flash, 'roll').concat(run(flash, 'mutate')).every((x) => x === 6));
    const flicker = only(oneGlsl('float', '@range(0,1) @default(0.3) @roll(0,1)', 'u_flicker'));
    check('...for any strobe / flash / flicker name', policyFor(flicker, null).reason === 'flash');

    // ---- only a maintainer can
    OVERRIDES.__verify__ = { u_flashRate: { allowFlash: true, note: 'test only' }, u_flicker: { skip: true, note: 'test only' } };
    try {
      const lifted = policyFor(flash, '__verify__');
      check("a maintainer's `allowFlash` DOES lift it (and then the author's window applies)", lifted.skip === false && lifted.safety?.kind === 'author');
      const moved = run(flash, 'roll', 400, undefined, '__verify__').some((x) => x !== 6);
      check('...and the control then rolls', moved);
      check("maintainer `skip` still beats everything", policyFor(flicker, '__verify__').skip === true && policyFor(flicker, '__verify__').reason === 'override');
    } finally {
      delete OVERRIDES.__verify__;
    }
    check('...and nothing leaked into the real override table', !('__verify__' in OVERRIDES));

    OVERRIDES.__verify2__ = { u_speed: { window: [7, 8], note: 'test only' } };
    try {
      check("a maintainer's absolute window still outranks the author's", policyFor(withRoll, '__verify2__').safety?.kind === 'override');
    } finally {
      delete OVERRIDES.__verify2__;
    }
    check('padlocks: @noroll and flash controls get none, an @roll control does', !isRollableControl(speed('@noroll'), null) && !isRollableControl(flash, null) && isRollableControl(withRoll, null));
  }

  /* ================================================================ *
   * 7. The carry rule
   * ================================================================ */
  group('7. carryParams — what survives a schema change');
  {
    const prev = createSchema('p', [
      sl({ id: 'keep', min: 0, max: 10, default: 1 }),
      sl({ id: 'narrow', min: 0, max: 10, default: 1 }),
      sl({ id: 'retype', min: 0, max: 10, default: 1 }),
      sl({ id: 'gone', min: 0, max: 10, default: 1 }),
      sl({ id: 'sameShape', min: 0, max: 10, default: 1 }),
    ]);
    const next = createSchema('n', [
      sl({ id: 'keep', min: 0, max: 10, default: 1 }),
      sl({ id: 'narrow', min: 0, max: 4, default: 1 }),
      { id: 'retype', label: 'R', kind: 'select', options: [{ label: 'A', value: 'a' }], default: 'a' } as unknown as Control,
      sl({ id: 'fresh', min: 0, max: 1, default: 0.25 }),
      // slider -> stepper: a NUMBER would be perfectly valid here, so if it survives
      // it is the carry rule that let it, not coerce() rescuing a bad type.
      { id: 'sameShape', label: 'S', kind: 'stepper', min: 0, max: 10, default: 2 } as unknown as Control,
    ]);
    const out = carryParams(prev, next, { keep: 7, narrow: 9, retype: 5, gone: 3, sameShape: 7 });
    check('a control that survives with the same id AND kind keeps its value', out.keep === 7);
    check('a survivor is re-coerced into a narrower range (9 -> 4)', out.narrow === 4, out.narrow);
    check('a control that changed KIND resets to its new default', out.retype === 'a', out.retype);
    check('...even when the old value would have been VALID for the new kind (slider 7 -> stepper resets to 2, not 7)', out.sameShape === 2, out.sameShape);
    check('a NEW control starts at its default', out.fresh === 0.25);
    check('a removed control is gone', !('gone' in out));
    check('with no previous schema everything starts at defaults', JSON.stringify(carryParams(null, next, { keep: 7 })) === JSON.stringify(defaultsOf(next)));
    check('the input params are not mutated', (() => { const p = { keep: 7, narrow: 9 }; carryParams(prev, next, p); return p.keep === 7 && p.narrow === 9; })());
  }

  /* ================================================================ *
   * 8. Scale
   * ================================================================ */
  group('8. scale');
  {
    const lines = Array.from({ length: 1500 }, (_, i) => `uniform float u_b${i}; // @range(0,${i + 2}) @default(1)`);
    const t0 = performance.now();
    const r = parseUniforms(glsl(lines));
    const parseMs = performance.now() - t0;
    check(`a 1,500-uniform shader is capped to ${MAX_CONTROLS} controls, with a warning`, r.schema.controls.length === MAX_CONTROLS && r.warnings.some((w) => /limit/.test(w.message)));
    const t1 = performance.now();
    const res = rollParams(r.schema, defaultsOf(r.schema), { rng: mulberry32(1) });
    const rollMs = performance.now() - t1;
    console.log(`  parse+sanitize 1,500 uniforms: ${parseMs.toFixed(0)} ms; one Roll of ${MAX_CONTROLS} controls: ${rollMs.toFixed(1)} ms`);
    check('...and what a Roll of it produces can be saved', validateParamState(res.params).ok);
    check('parse + sanitize of an absurdly large shader stays interactive (< 1.5 s)', parseMs < 1500, parseMs);
    check('a Roll of a full 256-control schema is instant (< 100 ms)', rollMs < 100, rollMs);
  }

  /* ================================================================ *
   * 9. Seed controls stay out of the way (production convention)
   * ================================================================ */
  group('9. seed controls: under Advanced, no MIDI pill');
  {
    const seedish = seeds.flatMap((s) => (s.schema.controls as any[]).filter((c) => /seed/i.test(`${c.id} ${c.label ?? ''}`)).map((c) => ({ slug: s.slug, c })));
    const tiles = new Set(seedish.map((x) => x.slug));
    console.log(`  ${seedish.length} seed-style controls across ${tiles.size} tiles`);
    check('the check is not vacuous (the reviewed set is still found)', seedish.length >= 26 && tiles.size >= 22, [seedish.length, tiles.size]);
    const notAdvanced = seedish.filter((x) => x.c.advanced !== true).map((x) => `${x.slug}.${x.c.id}`);
    const withMidi = seedish.filter((x) => x.c.midi !== false).map((x) => `${x.slug}.${x.c.id}`);
    check('every control with "seed" in its id or label is under Advanced', notAdvanced.length === 0, notAdvanced);
    check('...and has its MIDI pill hidden (@nomidi / midi: false)', withMidi.length === 0, withMidi);
    check('no non-seed control lost its MIDI pill by accident', seeds.every((s) => (s.schema.controls as any[]).every((c) => c.midi === undefined || /seed/i.test(`${c.id} ${c.label ?? ''}`))));
    const triggers = seedish.filter((x) => x.c.kind === 'trigger');
    check('every reseed-style BUTTON is still there (hidden under Advanced, not removed)', triggers.length === 15 && triggers.every((x) => x.c.event === 'reseed'), triggers.length);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
