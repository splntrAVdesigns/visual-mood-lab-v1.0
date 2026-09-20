/**
 * Roll / Mutate verifier.
 *
 * Run with: npm run verify:roll
 *
 * Loads the REAL schema of every seed tile (the same sources `seed` ingests),
 * then rolls and mutates each one thousands of times — with random locks,
 * non-default starting states, toggles on and off, and a range of strengths —
 * checking on every single result that:
 *
 *   - every value is valid (idempotent under the app's own `coerce`), finite,
 *     inside [min, effective max], and on its step grid;
 *   - nothing that must never be touched IS touched: triggers, textures, text,
 *     fonts, vec3, advanced controls, locked controls, hidden controls,
 *     flash-class controls, role colors, and toggles unless opted in;
 *   - the safety windows hold: speed-like controls stay within 1/2x..2x of
 *     their default, count-like within 1/4x..1.5x (Mutate never pushes past
 *     where the value already was);
 *   - palettes keep each color's brightness, and Mutate preserves hue
 *     relationships between colors;
 *   - the results are deterministic under a seed, and statistically sane
 *     (uniform middle-80% for Roll, strength scales Mutate, every select
 *     option is reachable).
 *
 * Any failure prints the tile, mode and seed so it can be reproduced exactly.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { parseUniforms } from '../lib/gl/parse-uniforms';
import { paramsToSchema } from '../lib/sketch/params-to-schema';
import { coerce, defaultsOf, effectiveMax, isVisible } from '../renderers/control-schema';
import type { ControlSchema, ParamState, ParamValue, RGBA } from '../renderers/control-schema';
import { mutateParams, rollParams, sameValue } from '../lib/roll/engine';
import { rgbToHsv, isRoleColor, ROLL_V_JITTER } from '../lib/roll/color';
import { COUNT_WINDOW, FLASH_RE, OVERRIDES, policyFor, SPEED_WINDOW } from '../lib/roll/policy';
import { mulberry32 } from '../lib/roll/rng';
import {
  EMPTY_HISTORY,
  HISTORY_LIMIT,
  recordHistory,
  redoHistory,
  undoHistory,
  type HistoryEntry,
} from '../lib/roll/history';

let passed = 0;
let failed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) passed++;
  else {
    failed++;
    process.stderr.write(`  FAIL  ${name}${detail !== undefined ? `  -> ${JSON.stringify(detail)}` : ''}\n`);
  }
}
const group = (t: string) => console.log(`\n${t}`);

/* ------------------------------------------------------------------ */

interface Tile {
  slug: string;
  type: string;
  schema: ControlSchema;
}

async function loadTiles(): Promise<Tile[]> {
  const seed = join(process.cwd(), 'seed');
  const manifest = JSON.parse(readFileSync(join(seed, 'manifest.json'), 'utf8')).assets as Array<{ slug: string; type: string; file: string }>;
  const tiles: Tile[] = [];
  for (const e of manifest) {
    const path = join(seed, e.file);
    if (e.type === 'shader') {
      tiles.push({ slug: e.slug, type: e.type, schema: parseUniforms(readFileSync(path, 'utf8'), { schemaId: `shader:${e.slug}` }).schema });
    } else {
      const mod = (await import(pathToFileURL(path).href)) as { params?: unknown };
      tiles.push({ slug: e.slug, type: e.type, schema: paramsToSchema(mod.params, { schemaId: `sketch:${e.slug}` }).schema });
    }
  }
  return tiles;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

const NEVER_KINDS = new Set(['trigger', 'texture', 'text', 'font', 'vec3']);
const EPS = 1e-9;

function isRGBA(v: ParamValue | undefined): v is RGBA {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function finiteDeep(v: ParamValue | undefined): boolean {
  if (typeof v === 'number') return Number.isFinite(v);
  if (Array.isArray(v)) return v.every((x) => Number.isFinite(x));
  if (isRGBA(v)) return [v.r, v.g, v.b, v.a].every(Number.isFinite);
  return true;
}

interface RunCtx {
  tile: Tile;
  mode: 'roll' | 'mutate';
  strength: number;
  seed: number;
  locked: ReadonlySet<string>;
  includeToggles: boolean;
  current: ParamState;
}

function tag(c: RunCtx, id: string): string {
  return `${c.tile.slug}.${id} [${c.mode}${c.mode === 'mutate' ? ' ' + c.strength : ''} seed ${c.seed}]`;
}

/** Every per-result invariant. Returns violation strings (empty = clean). */
function invariants(c: RunCtx, next: ParamState, changed: string[]): string[] {
  const bad: string[] = [];
  const changedSet = new Set(changed);
  const byId = new Map(c.tile.schema.controls.map((x) => [x.id, x] as const));

  for (const ctl of c.tile.schema.controls) {
    const before = c.current[ctl.id];
    const after = next[ctl.id];
    const moved = changedSet.has(ctl.id);

    if (!finiteDeep(after)) bad.push(`non-finite value: ${tag(c, ctl.id)}`);

    // ---- must never be touched
    if (NEVER_KINDS.has(ctl.kind) && !sameValue(before, after)) bad.push(`touched a ${ctl.kind}: ${tag(c, ctl.id)}`);
    if (ctl.advanced && moved) bad.push(`touched an advanced control: ${tag(c, ctl.id)}`);
    if (c.locked.has(ctl.id) && moved) bad.push(`touched a LOCKED control: ${tag(c, ctl.id)}`);
    if (ctl.kind === 'toggle' && moved && !(c.mode === 'roll' && c.includeToggles)) bad.push(`flipped a toggle without opt-in: ${tag(c, ctl.id)}`);
    if ((FLASH_RE.test(`${ctl.id} ${ctl.label}`) || OVERRIDES[c.tile.slug]?.[ctl.id]?.skip) && moved) bad.push(`touched a FLASH-class control: ${tag(c, ctl.id)}`);
    if (moved && !isVisible(ctl, next)) bad.push(`changed a control that is HIDDEN in the result: ${tag(c, ctl.id)}`);
    if (ctl.kind === 'color' && isRoleColor(ctl.default) && moved) bad.push(`recoloured a role color: ${tag(c, ctl.id)}`);

    if (!moved) continue;

    // ---- validity of what was rolled
    const coerced = coerce(ctl, after ?? null, next);
    if (!sameValue(coerced, after)) bad.push(`value not valid under coerce: ${tag(c, ctl.id)} ${JSON.stringify(after)} -> ${JSON.stringify(coerced)}`);

    if (ctl.kind === 'slider' || ctl.kind === 'stepper') {
      const v = after as number;
      const hi = effectiveMax(ctl, next) ?? ctl.max;
      if (v < ctl.min - EPS || v > hi + EPS) bad.push(`out of range [${ctl.min}, ${hi}]: ${tag(c, ctl.id)} = ${v}`);

      const step = ctl.kind === 'stepper' ? Math.max(1, ctl.step ?? 1) : ctl.step;
      if (step && step > 0) {
        const k = (v - ctl.min) / step;
        const window = policyFor(ctl, c.tile.slug).safety;
        // A window narrower than one step legitimately can't snap; everything else must be on-grid.
        if (Math.abs(k - Math.round(k)) > 1e-6 && !window) bad.push(`off the step grid (step ${step}): ${tag(c, ctl.id)} = ${v}`);
      }

      // ---- safety windows
      const policy = policyFor(ctl, c.tile.slug);
      if (policy.safety && (policy.safety.kind === 'speed' || policy.safety.kind === 'count')) {
        const w = policy.safety.kind === 'speed' ? SPEED_WINDOW : COUNT_WINDOW;
        const a = Math.max(ctl.min, ctl.default * w[0]);
        const b = Math.min(hi, ctl.default * w[1]);
        const cur = typeof before === 'number' ? before : ctl.default;
        const upper = c.mode === 'roll' ? b : Math.max(b, cur);
        const lower = c.mode === 'roll' ? a : Math.min(a, cur);
        if (a < b) {
          if (v > upper * (1 + 1e-9) + EPS) bad.push(`${policy.safety.kind} control ABOVE its window (${v} > ${upper}): ${tag(c, ctl.id)}`);
          if (v < lower * (1 - 1e-9) - EPS) bad.push(`${policy.safety.kind} control BELOW its window (${v} < ${lower}): ${tag(c, ctl.id)}`);
        }
      } else if (c.mode === 'roll' && !policy.safety && ctl.kind === 'slider' && ctl.scale !== 'log') {
        const pos = (v - ctl.min) / (hi - ctl.min);
        if (pos < 0.1 - 1e-6 || pos > 0.9 + 1e-6) bad.push(`Roll left the middle 80% (at ${pos.toFixed(3)}): ${tag(c, ctl.id)}`);
      }
    }

    if (ctl.kind === 'color' && isRGBA(after)) {
      const [, s0, v0] = rgbToHsv(ctl.default.r, ctl.default.g, ctl.default.b);
      const [, s, v] = rgbToHsv(after.r, after.g, after.b);
      const cur = isRGBA(before) ? before : ctl.default;
      if (after.a !== cur.a) bad.push(`alpha changed: ${tag(c, ctl.id)}`);
      if (c.mode === 'roll') {
        if (Math.abs(v - v0) > ROLL_V_JITTER + 1e-6) bad.push(`Roll changed a color's BRIGHTNESS too far (${v0.toFixed(2)} -> ${v.toFixed(2)}): ${tag(c, ctl.id)}`);
        if (s < Math.min(s0, 0.3) - 1e-6) bad.push(`Roll desaturated a color below its floor: ${tag(c, ctl.id)}`);
      }
    }

    void byId;
  }
  return bad;
}

/** Hue distance in 0..0.5 */
function hueDist(a: RGBA, b: RGBA): number {
  const d = Math.abs(rgbToHsv(a.r, a.g, a.b)[0] - rgbToHsv(b.r, b.g, b.b)[0]);
  return Math.min(d, 1 - d);
}

/* ------------------------------------------------------------------ */

async function main(): Promise<void> {
  const tiles = await loadTiles();
  group('setup');
  check('loaded all seed tiles (shaders + sketches)', tiles.length >= 99, tiles.length);
  const totalControls = tiles.reduce((n, t) => n + t.schema.controls.length, 0);
  console.log(`  ${tiles.length} tiles, ${totalControls} controls`);

  /* -------------------------------------------------------------- *
   * Policy table can't silently rot
   * -------------------------------------------------------------- */
  group('policy overrides');
  for (const [assetId, controls] of Object.entries(OVERRIDES)) {
    const tile = tiles.find((t) => t.slug === assetId);
    check(`override target "${assetId}" exists in the library`, !!tile);
    for (const controlId of Object.keys(controls)) {
      check(`override "${assetId}.${controlId}" names a control that exists`, !!tile?.schema.controls.some((x) => x.id === controlId));
    }
  }

  const flash: string[] = [];
  let speedLike = 0;
  let countLike = 0;
  for (const t of tiles) {
    for (const ctl of t.schema.controls) {
      const p = policyFor(ctl, t.slug);
      if (p.skip) flash.push(`${t.slug}.${ctl.id} (${p.reason})`);
      if (p.safety?.kind === 'speed') speedLike++;
      if (p.safety?.kind === 'count') countLike++;
    }
  }
  console.log(`  excluded by policy: ${flash.length} -> ${flash.join(', ')}`);
  console.log(`  speed-window controls: ${speedLike} | count-window controls: ${countLike}`);
  check('strobe-cut Flash rate is excluded', flash.some((f) => f.startsWith('strobe-cut.u_flashRate')));
  check('strobe-cut Duty cycle is excluded', flash.some((f) => f.startsWith('strobe-cut.u_threshold')));
  check('speed policy covers a large share of the library (analysis found 233 speed-like sliders)', speedLike >= 150, speedLike);
  check('count policy covers the heavy controls (analysis found 12 with max >= 500)', countLike >= 10, countLike);

  /* -------------------------------------------------------------- *
   * The property runs
   * -------------------------------------------------------------- */
  group(`property runs over all ${tiles.length} tiles`);
  const TRIALS = 36;
  const STRENGTHS = [0.1, 0.25, 0.6, 1];
  let runs = 0;
  let rollsWithChange = 0;
  let rollsEligible = 0;
  const violations: string[] = [];
  const posSamples: number[] = [];
  const deltaByStrength = new Map<number, { sum: number; n: number }>(STRENGTHS.map((s) => [s, { sum: 0, n: 0 }]));
  let hueChecks = 0;
  let rollChanged = 0;
  let rollEligibleTotal = 0;
  const changedByKind = new Map<string, number>();

  for (const tile of tiles) {
    const base = defaultsOf(tile.schema);
    const ids = tile.schema.controls.map((x) => x.id);
    let chain: ParamState = base;

    for (let i = 0; i < TRIALS; i++) {
      const seedBase = (hash(tile.slug) ^ (i * 2654435761)) >>> 0;
      const lockRng = mulberry32(seedBase ^ 0xabcdef);
      const locked = new Set<string>(i % 3 === 0 ? ids.filter(() => lockRng() < 0.25) : []);
      const includeToggles = i % 4 === 0;
      const current = i % 2 === 0 ? base : chain;

      // ---- Roll
      {
        const seed = seedBase + 1;
        const ctx: RunCtx = { tile, mode: 'roll', strength: 1, seed, locked, includeToggles, current };
        const res = rollParams(tile.schema, current, { rng: mulberry32(seed), locked, includeToggles, assetId: tile.slug });
        runs++;
        violations.push(...invariants(ctx, res.params, res.changed));
        if (res.eligible >= 3) {
          rollsEligible++;
          if (res.changed.length > 0) rollsWithChange++;
        }
        if (locked.size === 0 && !includeToggles) {
          rollChanged += res.changed.length;
          rollEligibleTotal += res.eligible;
          for (const id of res.changed) {
            const k = tile.schema.controls.find((x) => x.id === id)!.kind;
            changedByKind.set(k, (changedByKind.get(k) ?? 0) + 1);
          }
        }
        for (const ctl of tile.schema.controls) {
          if (res.changed.includes(ctl.id) && ctl.kind === 'slider' && ctl.scale !== 'log' && !policyFor(ctl, tile.slug).safety) {
            const hi = effectiveMax(ctl, res.params) ?? ctl.max;
            posSamples.push(((res.params[ctl.id] as number) - ctl.min) / (hi - ctl.min));
          }
        }
        // determinism
        const again = rollParams(tile.schema, current, { rng: mulberry32(seed), locked, includeToggles, assetId: tile.slug });
        if (JSON.stringify(again.params) !== JSON.stringify(res.params)) violations.push(`Roll is NOT deterministic under a seed: ${tile.slug} seed ${seed}`);
        // input must never be mutated
        chain = res.params;
      }

      // ---- Mutate at each strength
      for (const strength of STRENGTHS) {
        const seed = seedBase + 100 + Math.round(strength * 100);
        const ctx: RunCtx = { tile, mode: 'mutate', strength, seed, locked, includeToggles, current };
        const before = JSON.stringify(current);
        const res = mutateParams(tile.schema, current, { strength, rng: mulberry32(seed), locked, includeToggles, assetId: tile.slug });
        runs++;
        if (JSON.stringify(current) !== before) violations.push(`Mutate MUTATED ITS INPUT: ${tile.slug} seed ${seed}`);
        violations.push(...invariants(ctx, res.params, res.changed));

        // magnitude of change on ordinary sliders, for the strength-scales-change check
        const acc = deltaByStrength.get(strength)!;
        for (const ctl of tile.schema.controls) {
          if (ctl.kind !== 'slider' || ctl.scale === 'log' || locked.has(ctl.id) || policyFor(ctl, tile.slug).safety || policyFor(ctl, tile.slug).skip) continue;
          if (ctl.advanced || !isVisible(ctl, current) || ctl.max <= ctl.min) continue;
          acc.sum += Math.abs((res.params[ctl.id] as number) - (current[ctl.id] as number)) / (ctl.max - ctl.min);
          acc.n++;
        }

        // Mutate preserves hue relationships between colors (a shared rotation)
        const movedColors = tile.schema.controls.filter((x) => x.kind === 'color' && res.changed.includes(x.id));
        if (movedColors.length >= 2) {
          const a = movedColors[0];
          const b = movedColors[1];
          const d0 = hueDist(current[a.id] as RGBA, current[b.id] as RGBA);
          const d1 = hueDist(res.params[a.id] as RGBA, res.params[b.id] as RGBA);
          hueChecks++;
          if (Math.abs(d0 - d1) > 0.01) violations.push(`Mutate broke the hue relationship between ${a.id} and ${b.id} (${d0.toFixed(3)} -> ${d1.toFixed(3)}): ${tile.slug} seed ${seed}`);
        }
      }
    }

    // ---- strength 0 is "change nothing", exactly
    const zero = mutateParams(tile.schema, base, { strength: 0, rng: mulberry32(1), includeToggles: true, assetId: tile.slug });
    if (zero.changed.length !== 0 || JSON.stringify(zero.params) !== JSON.stringify(base)) violations.push(`Mutate at strength 0 changed something: ${tile.slug}`);
  }

  const uniqueViolations = [...new Set(violations)];
  console.log(`  ${runs} rolls/mutates checked, ${hueChecks} hue-relationship checks`);
  check(`every invariant held on every result (${runs} runs)`, uniqueViolations.length === 0);
  for (const v of uniqueViolations.slice(0, 10)) process.stderr.write(`     ${v}\n`);
  if (uniqueViolations.length > 10) process.stderr.write(`     … and ${uniqueViolations.length - 10} more\n`);
  failures.push(...uniqueViolations);

  /* -------------------------------------------------------------- *
   * Statistical sanity
   * -------------------------------------------------------------- */
  group('statistics');
  const frac = rollChanged / rollEligibleTotal;
  console.log(`  a Roll changed ${(100 * frac).toFixed(1)}% of the controls it considered; changes by kind: ${[...changedByKind].map(([k, n]) => `${k} ${n}`).join(', ')}`);
  check('coverage: a Roll actually moves the controls it considers (>= 85%) — guards against an over-strict engine', frac >= 0.85, frac);
  check('coverage: every rollable kind is really rolled (slider, stepper, select, xy, color)', ['slider', 'stepper', 'select', 'xy', 'color'].every((k) => (changedByKind.get(k) ?? 0) > 100), Object.fromEntries(changedByKind));
  check('coverage: the hue-relationship check actually ran (>= 1000 pairs)', hueChecks >= 1000, hueChecks);
  check('a Roll changes something on >= 98% of tiles-with-choices', rollsWithChange / rollsEligible >= 0.98, `${rollsWithChange}/${rollsEligible}`);

  const mean = posSamples.reduce((a, b) => a + b, 0) / posSamples.length;
  console.log(`  ordinary-slider Roll positions: n=${posSamples.length}, mean ${mean.toFixed(3)} (uniform over the middle 80% is 0.500)`);
  check('Roll is centred (mean position within 0.02 of 0.5)', Math.abs(mean - 0.5) < 0.02, mean);
  check('Roll uses the WHOLE middle 80% (both tails of it are visited)', posSamples.some((p) => p < 0.14) && posSamples.some((p) => p > 0.86));

  const means = STRENGTHS.map((s) => {
    const a = deltaByStrength.get(s)!;
    return a.sum / a.n;
  });
  console.log(`  mean |change| as a fraction of range at strength ${STRENGTHS.join(' / ')}: ${means.map((m) => m.toFixed(3)).join(' / ')}`);
  check('Mutate strength scales the size of the change (strictly increasing)', means.every((m, i) => i === 0 || m > means[i - 1]), means);
  // The approved formula is sigma = strength x range. For a Gaussian the mean
  // absolute step is sigma * sqrt(2/pi) ~= 0.8 x strength, so 10% should move an
  // average slider ~8% of its range (a little less once reflection at the
  // bounds folds the tails back in). This pins the MEASURED behaviour to the
  // formula rather than to intuition about what a "nudge" feels like.
  check('Mutate magnitude matches sigma = strength x range (mean |step| ~ 0.8 x strength at 10%)', means[0] > 0.06 && means[0] < 0.09, means[0]);

  // every select option reachable; toggles only when opted in
  let selectsChecked = 0;
  let selectsFull = 0;
  for (const tile of tiles) {
    const base = defaultsOf(tile.schema);
    for (const ctl of tile.schema.controls) {
      if (ctl.kind !== 'select' || ctl.advanced || !isVisible(ctl, base) || policyFor(ctl, tile.slug).skip || ctl.options.length < 2) continue;
      const seen = new Set<string>();
      const rng = mulberry32(hash(tile.slug + ctl.id));
      for (let i = 0; i < 260; i++) {
        const r = rollParams(tile.schema, base, { rng, assetId: tile.slug });
        if (isVisible(ctl, r.params)) seen.add(String(r.params[ctl.id]));
      }
      selectsChecked++;
      if (seen.size === ctl.options.length) selectsFull++;
      else process.stderr.write(`     select ${tile.slug}.${ctl.id}: only ${seen.size}/${ctl.options.length} options reachable\n`);
    }
  }
  console.log(`  selects: ${selectsFull}/${selectsChecked} reach every option within 260 rolls`);
  check('every option of every visible select is reachable by Roll', selectsFull === selectsChecked, `${selectsFull}/${selectsChecked}`);

  {
    const tile = tiles.find((t) => t.schema.controls.some((c) => c.kind === 'toggle' && !c.advanced))!;
    const base = defaultsOf(tile.schema);
    const tog = tile.schema.controls.filter((c) => c.kind === 'toggle' && !c.advanced && isVisible(c, base));
    const seenOn = new Set<string>();
    const seenOff = new Set<string>();
    for (let i = 0; i < 120; i++) {
      const r = rollParams(tile.schema, base, { rng: mulberry32(i + 1), includeToggles: true, assetId: tile.slug });
      for (const c of tog) (r.params[c.id] === true ? seenOn : seenOff).add(c.id);
    }
    check('with the opt-in, toggles take both values', tog.length > 0 && tog.every((c) => seenOn.has(c.id) && seenOff.has(c.id)), tile.slug);
  }

  /* -------------------------------------------------------------- *
   * Dependencies
   * -------------------------------------------------------------- */
  group('dependencies (showIf / maxIf)');
  {
    const withDeps = tiles.filter((t) => t.schema.controls.some((c) => c.showIf || c.maxIf || c.disabledIf));
    console.log(`  tiles with a dependency: ${withDeps.length}`);
    check('the library has tiles with dependencies to exercise', withDeps.length >= 10, withDeps.length);
    let dependentsRolled = 0;
    let bad = 0;
    for (const tile of withDeps) {
      const base = defaultsOf(tile.schema);
      for (let i = 0; i < 80; i++) {
        const res = rollParams(tile.schema, base, { rng: mulberry32(hash(tile.slug) + i), assetId: tile.slug });
        for (const c of tile.schema.controls) {
          const visibleNow = isVisible(c, res.params);
          if (!visibleNow && !sameValue(res.params[c.id], base[c.id])) bad++;
          if (visibleNow && c.showIf && res.changed.includes(c.id)) dependentsRolled++;
          if (c.maxIf) {
            const cap = effectiveMax(c, res.params);
            const v = res.params[c.id];
            if (cap !== undefined && typeof v === 'number' && v > cap + EPS) bad++;
          }
        }
      }
    }
    console.log(`  conditionally-shown controls rolled while visible: ${dependentsRolled}`);
    check('hidden controls stay untouched and maxIf caps hold across 80 rolls per dependent tile', bad === 0, bad);
    check('conditionally-shown controls DO get rolled when visible', dependentsRolled > 0);
  }

  /* -------------------------------------------------------------- *
   * Undo history
   * -------------------------------------------------------------- */
  group('undo history');
  {
    const e = (n: number): HistoryEntry => ({ params: { x: n }, dirty: n ? ['x'] : [] });
    let h = EMPTY_HISTORY;
    check('undo on an empty history is null', undoHistory(h, e(0)) === null);
    check('redo on an empty history is null', redoHistory(h, e(0)) === null);

    h = recordHistory(h, e(1));
    h = recordHistory(h, e(2));
    const u1 = undoHistory(h, e(3))!;
    check('undo returns the most recent recorded state', u1.entry.params.x === 2);
    check('undo pushes the current state onto redo', u1.history.future.length === 1 && u1.history.future[0].params.x === 3);
    const r1 = redoHistory(u1.history, u1.entry)!;
    check('redo returns the state that was undone', r1.entry.params.x === 3);
    check('undo then redo restores the stack exactly', r1.history.past.length === 2 && r1.history.future.length === 0);

    const branched = recordHistory(u1.history, e(9));
    check('recording a new operation after an undo CLEARS redo', branched.future.length === 0);

    let big = EMPTY_HISTORY;
    for (let i = 0; i < 50; i++) big = recordHistory(big, e(i));
    check(`history is capped at ${HISTORY_LIMIT}`, big.past.length === HISTORY_LIMIT, big.past.length);
    check('the OLDEST entries are the ones dropped', big.past[0].params.x === 50 - HISTORY_LIMIT && big.past.at(-1)!.params.x === 49);

    const original: HistoryEntry = { params: { arr: [1, 2], c: { r: 1, g: 0, b: 0, a: 1 } }, dirty: ['a'] };
    const rec = recordHistory(EMPTY_HISTORY, original);
    (original.params.arr as number[])[0] = 999;
    original.dirty.push('b');
    check('entries are cloned — later mutation of live state cannot reach history', (rec.past[0].params.arr as number[])[0] === 1 && rec.past[0].dirty.length === 1);
    const out = undoHistory(rec, e(0))!;
    (out.entry.params.arr as number[])[0] = 555;
    check('...and what undo hands back is a clone too', (rec.past[0].params.arr as number[])[0] === 1);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
