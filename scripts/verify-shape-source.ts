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
import { keyCoverage } from '../lib/shape-source/raster';
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
  // 100.3: Mesh turbulence, background placement, gradient drift range.
  const meshIds = ['u_lineDensity', 'u_meshTurb', 'u_meshFlow'];
  check('Mesh turbulence + flow shown only for Mesh',
    shown(meshIds, fillIs('Mesh')) && hidden(['u_meshTurb', 'u_meshFlow'], fillIs('Metaballs')) && hidden(['u_meshTurb', 'u_meshFlow'], fillIs('Gradient')));
  check('Mesh turbulence defaults to 0.5, flow to 1', state.u_meshTurb === 0.5 && state.u_meshFlow === 1);
  const order = schema.controls.map((c) => c.id);
  check('Background sits in Fill, directly under Color C',
    byId.get('u_bg')?.group === 'Fill' && order.indexOf('u_bg') === order.indexOf('u_color3') + 1);
  check('Background stays visible for every fill (Solid included)', isVisible(byId.get('u_bg')!, fillIs('Solid')));
  const drift = byId.get('u_gradScroll');
  check('Gradient drift range 0..4 with a fine step, default unchanged',
    drift?.kind === 'slider' && drift.min === 0 && drift.max === 4 && (drift.step ?? 1) <= 0.005 && state.u_gradScroll === 0.2);

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

/* 5. upload keying (100.3) ------------------------------------------ */
console.log('\nUpload keying');
{
  const R = 64;
  const rect = { x0: 0, y0: 0, x1: R, y1: R };
  // A transparent image: a ring of flat ink, left half dark (lum 0.2), right half light (lum 0.85).
  const img = (inkLeft: number, inkRight: number, bg: number | null) => {
    const px = new Uint8ClampedArray(R * R * 4);
    for (let y = 0; y < R; y++) for (let x = 0; x < R; x++) {
      const j = (y * R + x) * 4;
      const r = Math.hypot(x - R / 2 + 0.5, y - R / 2 + 0.5);
      const ink = r > 12 && r < 24;
      const l = ink ? (x < R / 2 ? inkLeft : inkRight) : bg ?? 0;
      px[j] = px[j + 1] = px[j + 2] = Math.round(l * 255);
      px[j + 3] = ink || bg !== null ? 255 : 0;
    }
    return px;
  };
  const cover = (out: Uint8ClampedArray) => out.reduce((s, v) => s + (v > 127 ? 1 : 0), 0) / out.length;
  const two = img(0.2, 0.85, null);
  const full = cover(keyCoverage(img(0.2, 0.2, null), R, rect, 'alpha', 0.5, false));
  check('ring fixture has a real silhouette', full > 0.2 && full < 0.6, full);

  const auto = cover(keyCoverage(two, R, rect, 'auto', 0.5, false));
  const alpha = cover(keyCoverage(two, R, rect, 'alpha', 0.5, false));
  check('Auto on a transparent image = Alpha, whole silhouette at the centre', Math.abs(auto - alpha) < 1e-9 && Math.abs(alpha - full) < 0.01, { auto, alpha, full });
  const trimLight = cover(keyCoverage(two, R, rect, 'alpha', 0.2, false));
  const trimDark = cover(keyCoverage(two, R, rect, 'alpha', 0.8, false));
  check('Alpha threshold left of centre trims the light half', trimLight < alpha * 0.65 && trimLight > alpha * 0.35, { trimLight, alpha });
  check('Alpha threshold right of centre trims the dark half', trimDark < alpha * 0.65 && trimDark > alpha * 0.35, { trimDark, alpha });
  check('Alpha threshold is continuous through the centre (pure white kept at 0.49 / 0.51)',
    cover(keyCoverage(img(1, 1, null), R, rect, 'alpha', 0.49, false)) > full * 0.98
    && cover(keyCoverage(img(0, 0, null), R, rect, 'alpha', 0.51, false)) > full * 0.98);

  const lightLogo = cover(keyCoverage(img(0.85, 0.85, null), R, rect, 'luma', 0.5, false));
  const midLogo = cover(keyCoverage(img(0.55, 0.55, null), R, rect, 'luma', 0.5, false));
  const darkLogo = cover(keyCoverage(img(0.2, 0.2, null), R, rect, 'luma', 0.5, false));
  check('Luminance keeps a LIGHT logo on a transparent PNG (was 0 %)', Math.abs(lightLogo - full) < 0.01, lightLogo);
  check('Luminance keeps a MID-TONE logo on a transparent PNG (was 0 %)', Math.abs(midLogo - full) < 0.01, midLogo);
  check('Luminance still keeps a dark logo on a transparent PNG', Math.abs(darkLogo - full) < 0.01, darkLogo);

  const jpgDark = cover(keyCoverage(img(0.2, 0.2, 1), R, rect, 'auto', 0.5, false));
  const jpgLight = cover(keyCoverage(img(0.9, 0.9, 0.05), R, rect, 'auto', 0.5, false));
  check('opaque JPG: Auto -> Luminance, dark ink on white keyed', Math.abs(jpgDark - full) < 0.01, jpgDark);
  check('opaque JPG: light ink on black keyed', Math.abs(jpgLight - full) < 0.01, jpgLight);
  const jpgCut = cover(keyCoverage(img(0.2, 0.6, 1), R, rect, 'luma', 0.4, false));
  check('opaque JPG: Luminance threshold still cuts by brightness', jpgCut < full * 0.65 && jpgCut > full * 0.35, jpgCut);
  check('Invert stays inside the image frame', cover(keyCoverage(two, R, rect, 'alpha', 0.5, true)) < 1 - full + 0.01);
}

console.log(failures ? `\n${failures} check(s) failed.\n` : '\nAll Shape Source checks passed.\n');
process.exit(failures ? 1 : 0);
