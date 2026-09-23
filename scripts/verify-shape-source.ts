/**
 * Verifies the Shape Source primitive and Shapeshift's schema contract.
 *
 *   npx tsx scripts/verify-shape-source.ts
 *
 * 1. Distance-field accuracy — the stair-step fix. A supersampled circle is
 *    rasterised to antialiased coverage; the field's contour must sit within
 *    the bounds measured when the fix was designed (mean < 0.2 px, max < 0.7
 *    px). A regression to 1-bit thresholding fails this (mean ≈ 0.63 px).
 * 2. Degenerate rasters (empty / full) encode without NaN.
 * 3. Encoding round-trip: fine/coarse channels decode to the same distance.
 * 4. Schema: @shape expands to the source group with the right visibility
 *    rules, never rolled or MIDI-mapped; @trigger maps to a uniform-bound
 *    trigger with its beat toggle; a second @shape sampler is refused.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSdfRGBA, signedDistance, FINE_SPREAD, COARSE_SPREAD } from '../lib/shape-source/sdf';
import { parseUniforms } from '../lib/gl/parse-uniforms';
import { defaultsOf, isVisible } from '../renderers/control-schema';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) console.log(`  ok    ${name}`);
  else { failures++; console.error(`  FAIL  ${name}`, detail ?? ''); }
};

/* 1. accuracy ------------------------------------------------------ */
console.log('\nDistance field accuracy');
{
  const N = 96, SS = 8, cx = 48.3, cy = 47.7, r = 30.37;
  const cov = new Uint8ClampedArray(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let inside = 0;
    for (let j = 0; j < SS; j++) for (let i = 0; i < SS; i++) {
      const px = x + (i + 0.5) / SS, py = y + (j + 0.5) / SS;
      if ((px - cx) ** 2 + (py - cy) ** 2 < r * r) inside++;
    }
    cov[y * N + x] = Math.round((inside / (SS * SS)) * 255);
  }
  const sd = signedDistance(cov, N, N);
  const md = buildSdfRGBA(cov, N, N).maxDepth;
  check(`maxDepth ${md.toFixed(2)} px ≈ circle radius ${r}`, Math.abs(md - r) < 1);
  let sum = 0, max = 0, n = 0;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const truth = r - Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
    if (Math.abs(truth) >= 0.75) continue;
    const e = Math.abs(sd[y * N + x] - truth);
    sum += e; max = Math.max(max, e); n++;
  }
  const mean = sum / n;
  check(`contour mean error ${mean.toFixed(3)} px < 0.2`, mean < 0.2);
  check(`contour max error ${max.toFixed(3)} px < 0.7`, max < 0.7);

  // 3. encoding round trip
  const enc = buildSdfRGBA(cov, N, N).rgba;
  let worst = 0;
  for (let i = 0; i < N * N; i++) {
    const d = sd[i];
    if (Math.abs(d) > FINE_SPREAD * 0.9) continue;
    const fine = (enc[i * 4] / 255 - 0.5) * 2 * FINE_SPREAD;
    const coarse = (enc[i * 4 + 1] / 255 - 0.5) * 2 * COARSE_SPREAD;
    worst = Math.max(worst, Math.abs(fine - d), Math.abs(coarse - d) > 1.1 ? 1 : 0);
  }
  check(`fine channel quantisation ${worst.toFixed(3)} px < 0.07`, worst < 0.07);
}

/* 2. degenerate ---------------------------------------------------- */
console.log('\nDegenerate rasters');
{
  const empty = buildSdfRGBA(new Uint8ClampedArray(64), 8, 8);
  const full = buildSdfRGBA(new Uint8ClampedArray(64).fill(255), 8, 8);
  check('empty raster -> fully outside, hasShape false', !empty.hasShape && empty.rgba[0] === 0 && empty.rgba[3] === 255);
  check('full raster -> fully inside', full.hasShape && full.rgba[0] === 255 && full.rgba[1] === 255);
  check('empty raster reports maxDepth 0', empty.maxDepth === 0);
}

/* 4. schema -------------------------------------------------------- */
console.log('\nShapeshift schema');
{
  const src = readFileSync(join(ROOT, 'seed/shaders/shapeshift.frag'), 'utf8');
  const { schema, warnings } = parseUniforms(src, { schemaId: 'shader:shapeshift' });
  const byId = new Map(schema.controls.map((c) => [c.id, c]));
  const state = defaultsOf(schema);

  check('no parser warnings', warnings.filter((w) => w.level === 'warn').length === 0, warnings);
  const ids = ['shapeSource', 'shapeText', 'shapeFont', 'shapeLeading', 'shapeJustify', 'shapeUpper',
    'shapeFile', 'shapeKey', 'shapeThreshold', 'shapeKeyInvert', 'shapeLibrary'];
  check('all Shape Source controls present', ids.every((id) => byId.has(id)));
  check('no texture control for the @shape sampler', !byId.has('u_shape'));
  check('source defaults to text with the @default text', state.shapeSource === 'text' && state.shapeText === 'SHAPE SHIFT');
  check('text controls visible by default', isVisible(byId.get('shapeText')!, state));
  check('upload controls hidden by default', !isVisible(byId.get('shapeFile')!, state));
  check('upload controls shown for upload', isVisible(byId.get('shapeFile')!, { ...state, shapeSource: 'upload' }));
  check('library shape shown for library', isVisible(byId.get('shapeLibrary')!, { ...state, shapeSource: 'library' }));
  check('source controls never rolled', ids.every((id) => byId.get(id)!.roll === false));
  check('source controls host-bound to u_shape', ids.every((id) => {
    const b = byId.get(id)!.binding; return b?.target === 'host' && b.property === 'shape:u_shape';
  }));

  const recut = byId.get('u_recut');
  check('u_recut is a uniform-bound trigger', recut?.kind === 'trigger' && recut.binding?.target === 'uniform' && recut.event === 'trigger:u_recut');
  check('u_recut auto-fires from u_beatCut', recut?.kind === 'trigger' && recut.autoFire === 'u_beatCut' && byId.get('u_beatCut')?.kind === 'toggle');
  check('steppers stay steppers (density, mesh lines, count, stack)', ['u_density', 'u_lineDensity', 'u_count', 'u_stack'].every((id) => byId.get(id)?.kind === 'stepper'));
  check('rows/columns replaced by density + cell aspect', !byId.has('u_rows') && !byId.has('u_cols') && byId.get('u_cellAspect')?.kind === 'slider');
  check('u_shapeDepth is host-fed, not a control', !byId.has('u_shapeDepth'));
  check('Roll windows on density / count / stack', ['u_density', 'u_count', 'u_stack'].every((id) => {
    const r = byId.get(id)?.roll; return typeof r === 'object' && r !== null;
  }));
  check('depth stack defaults to 4', state.u_stack === 4);

  // Fill-scoped controls (100.3): each fill shows only the controls it reads.
  const fillIs = (label: string) => {
    const f = byId.get('u_fill');
    const opt = f?.kind === 'select' ? f.options.find((o) => o.label === label) : undefined;
    return { ...state, u_fill: opt?.value ?? '' };
  };
  const elementIds = ['u_element', 'u_density', 'u_cellAspect', 'u_elemSize', 'u_depthSize', 'u_gridLocal', 'u_elemExtrude'];
  const ballIds = ['u_ballCount', 'u_ballSize', 'u_ballMerge', 'u_ballSpeed', 'u_ballRings', 'u_ballPump'];
  const shown = (ids: string[], st: typeof state) => ids.every((id) => byId.has(id) && isVisible(byId.get(id)!, st));
  const hidden = (ids: string[], st: typeof state) => ids.every((id) => byId.has(id) && !isVisible(byId.get(id)!, st));
  check('all six Metaballs controls present', ballIds.every((id) => byId.has(id)));
  check('Metaballs: blob controls shown, element + mesh controls hidden',
    shown(ballIds, fillIs('Metaballs')) && hidden([...elementIds, 'u_lineDensity'], fillIs('Metaballs')));
  check('Elements: element controls shown, blob + mesh controls hidden',
    shown(elementIds, fillIs('Elements')) && hidden([...ballIds, 'u_lineDensity'], fillIs('Elements')));
  check('Mesh: Mesh lines shown, element + blob controls hidden',
    shown(['u_lineDensity'], fillIs('Mesh')) && hidden([...elementIds, ...ballIds], fillIs('Mesh')));
  check('Solid: Color A stays, the other colour + gradient controls hide',
    shown(['u_color1'], fillIs('Solid')) && hidden(['u_color2', 'u_color3', 'u_gradAngle', 'u_gradScroll', ...elementIds, ...ballIds, 'u_lineDensity'], fillIs('Solid')));
  check('Gradient: gradient controls shown, fill-specific ones hidden',
    shown(['u_color2', 'u_color3', 'u_gradAngle', 'u_gradScroll'], fillIs('Gradient')) && hidden([...elementIds, ...ballIds, 'u_lineDensity'], fillIs('Gradient')));
  check('Metaballs defaults preserve the 100.x look (count 6, size 0.5, merge 0.5, speed 1, pump 1)',
    state.u_ballCount === 6 && state.u_ballSize === 0.5 && state.u_ballMerge === 0.5 && state.u_ballSpeed === 1 && state.u_ballPump === 1);
  check('blob count + rings stay steppers; count has a Roll window',
    byId.get('u_ballCount')?.kind === 'stepper' && byId.get('u_ballRings')?.kind === 'stepper'
    && typeof byId.get('u_ballCount')?.roll === 'object');
  check('blob size / merge / speed / pump are modulatable sliders',
    ['u_ballSize', 'u_ballMerge', 'u_ballSpeed', 'u_ballPump'].every((id) => byId.get(id)?.kind === 'slider')
    && ['u_ballSize', 'u_ballMerge', 'u_ballSpeed'].every((id) => byId.get(id)?.modulatable === true));

  const two = parseUniforms('uniform sampler2D a; // @shape\nuniform sampler2D b; // @shape\n');
  check('second @shape sampler refused with a warning', two.warnings.some((w) => /Only one @shape/.test(w.message)));
  // @showIf parser contract.
  const sel = 'uniform int m; // @label(M) @select(A=0 | B=1 | C=2) @default(0)\n';
  const byLabel = parseUniforms(sel + 'uniform float x; // @label(X) @showIf(m=B)\n');
  const xs = byLabel.schema.controls.find((c) => c.id === 'x')!;
  check('@showIf(m=B) resolves a select label to its option value', isVisible(xs, { m: '1', x: 0 }) && !isVisible(xs, { m: '0', x: 0 }));
  const multi = parseUniforms(sel + 'uniform float x; // @label(X) @showIf(m=0|2)\n').schema.controls.find((c) => c.id === 'x')!;
  check('@showIf(m=0|2) matches any listed value', isVisible(multi, { m: '0' }) && isVisible(multi, { m: '2' }) && !isVisible(multi, { m: '1' }));
  const neg = parseUniforms(sel + 'uniform float x; // @label(X) @showIf(m!=C)\n').schema.controls.find((c) => c.id === 'x')!;
  check('@showIf(m!=C) hides only on C', isVisible(neg, { m: '0' }) && !isVisible(neg, { m: '2' }));
  const fwd = parseUniforms('uniform float x; // @label(X) @showIf(t)\nuniform bool t; // @label(T) @default(false)\n');
  const xf = fwd.schema.controls.find((c) => c.id === 'x')!;
  check('@showIf may name a later uniform; bare id means truthy', isVisible(xf, { t: true }) && !isVisible(xf, { t: false }));
  const typo = parseUniforms(sel + 'uniform float x; // @label(X) @showIf(nope=1)\n');
  check('@showIf on a missing control warns and leaves the control visible',
    typo.warnings.some((w) => /@showIf/.test(w.message)) && !typo.schema.controls.find((c) => c.id === 'x')!.showIf);
  const badVal = parseUniforms(sel + 'uniform float x; // @label(X) @showIf(m=Z)\n');
  check('@showIf with an unknown select value warns and is ignored',
    badVal.warnings.some((w) => /not valid/.test(w.message)) && !badVal.schema.controls.find((c) => c.id === 'x')!.showIf);
  const wrong = parseUniforms('uniform float x; // @trigger\n');
  check('@trigger on a non-vec2 warns and maps normally', wrong.schema.controls[0]?.kind === 'slider' && wrong.warnings.length > 0);
}

console.log(failures ? `\n${failures} check(s) failed.\n` : '\nAll Shape Source checks passed.\n');
process.exit(failures ? 1 : 0);
