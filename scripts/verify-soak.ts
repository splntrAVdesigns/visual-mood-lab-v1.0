/**
 * Soak-test logic verifier.
 *
 * Run with: npm run verify:soak
 *
 * The soak test itself (npm run soak) needs a browser and a running site. This
 * verifies everything about it that does not: that the stats hook stays off
 * unless asked, that the analysis flags each kind of leak (and does not cry
 * wolf on a healthy run), that the config fails loudly on a typo, and that the
 * hook is actually wired into the app.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyse, DEFAULT_THRESHOLDS, formatTable, slope, summarizeFrames, type RunFacts, type Sample } from './soak-analysis';
import { parseConfig } from './soak-config';
import { collectSoakStats, installSoakStats, soakEnabled } from '../lib/debug/soak-stats';

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail?: unknown): void {
  if (ok) passed++;
  else {
    failed++;
    process.stderr.write(`  FAIL  ${name}${detail !== undefined ? `  -> ${JSON.stringify(detail)?.slice(0, 240)}` : ''}\n`);
  }
}
const group = (t: string) => console.log(`\n${t}`);

/* ---------------------------------------------------------------- */
group('the stats hook is opt-in');
{
  check('?soak enables it', soakEnabled('?soak') && soakEnabled('?soak=1') && soakEnabled('?a=1&soak=true'));
  check('no query, or other parameters, leave it OFF', !soakEnabled('') && !soakEnabled('?a=1') && !soakEnabled('?soaked=1') && !soakEnabled('?SOAK=1'));

  const fakeWin = (search: string, extra: Record<string, unknown> = {}) => {
    const w: Record<string, unknown> = {
      location: { search },
      document: { querySelectorAll: (sel: string) => ({ length: sel === 'iframe' ? 2 : 5 }), getElementsByTagName: () => ({ length: 321 }) },
      performance: { memory: { usedJSHeapSize: 52428800 } },
      ...extra,
    };
    return w as unknown as Window;
  };
  const pool = () => ({ live: 3, focused: 1, preview: 2, cap: 4 });
  const stage = () => ({ textureCount: 7, programCount: 9, isLost: false });

  const off = fakeWin('');
  check('without ?soak nothing is installed on window', installSoakStats(pool, stage, off) === false && !('__vmlSoak' in (off as unknown as object)));
  const on = fakeWin('?soak=1');
  check('with ?soak it installs window.__vmlSoak', installSoakStats(pool, stage, on) === true && typeof on.__vmlSoak?.stats === 'function');
  const s = on.__vmlSoak!.stats();
  check('it reports counts from the pool, the GL stage and the document', s.live === 3 && s.focused === 1 && s.preview === 2 && s.cap === 4 && s.glTextures === 7 && s.glPrograms === 9 && s.iframes === 2 && s.canvases === 5 && s.domNodes === 321, s);
  check('heap is reported in MB (52428800 bytes = 50)', s.heapMB === 50, s.heapMB);
  check('it exposes only numbers and a flag — no content of any kind', Object.values(s).every((v) => typeof v === 'number' || typeof v === 'boolean' || v === null), s);
  check('a browser without performance.memory reports heap as null', collectSoakStats(pool(), stage(), fakeWin('?soak', { performance: {} })).heapMB === null);
  check('a page with no GL stage yet reports zero textures, not a crash', collectSoakStats(pool(), null, fakeWin('?soak')).glTextures === 0);
  let gcCalls = 0;
  const withGc = fakeWin('?soak', { gc: () => { gcCalls++; } });
  installSoakStats(pool, stage, withGc);
  withGc.__vmlSoak!.stats();
  check('stats() does not force a GC by default', gcCalls === 0);
  withGc.__vmlSoak!.stats({ gc: true });
  check('stats({ gc: true }) does', gcCalls === 1);
  // REGRESSION: the hook is installed at import time; a `window` stub with no location (as the
  // render-pool and roll-store verifiers use) once made importing the pool throw.
  check('a window with no location does not throw at import time — it just is not installed', (() => { try { const w = {} as unknown as Window; return installSoakStats(pool, stage, w) === false && !('__vmlSoak' in w); } catch { return false; } })());
  check('a window whose location getter throws does not throw either', (() => { try { const w = { get location(): never { throw new Error('boom'); } } as unknown as Window; return installSoakStats(pool, stage, w) === false; } catch { return false; } })());
  check('soakEnabled tolerates undefined', soakEnabled(undefined) === false);
  const badGc = fakeWin('?soak', { gc: () => { throw new Error('no'); } });
  installSoakStats(pool, stage, badGc);
  check('a throwing gc() never breaks stats()', (() => { try { badGc.__vmlSoak!.stats({ gc: true }); return true; } catch { return false; } })());
}

/* ---------------------------------------------------------------- */
group('the analysis: a healthy run passes, every kind of leak is caught');

const sample = (cycle: number, over: Partial<Sample> = {}): Sample => ({ cycle, live: 0, focused: 0, glTextures: 0, glPrograms: 24, iframes: 0, canvases: 3, domNodes: 1000, heapMB: 40, ...over });
const baseline = sample(0, { glPrograms: 1 });
const healthy = (): RunFacts => ({
  baseline,
  cycles: [sample(1), sample(2), sample(3), sample(4)],
  peaks: { live: 2, glTextures: 1, iframes: 1 },
  cap: 2,
  shaderTiles: 24,
  focusFailures: [],
  pageErrors: [],
});
const failing = (facts: RunFacts, ...names: RegExp[]) => {
  const v = analyse(facts);
  const bad = v.checks.filter((c) => !c.ok);
  return !v.passed && names.every((re) => bad.some((c) => re.test(c.name))) && bad.length === names.length;
};

{
  const ok = analyse(healthy());
  check('a healthy run passes every check', ok.passed && ok.checks.every((c) => c.ok), ok.checks.filter((c) => !c.ok));
  check('...including a run whose heap wobbles a little (40 → 42 → 39 → 41 MB)', analyse({ ...healthy(), cycles: [40, 42, 39, 41].map((h, i) => sample(i + 1, { heapMB: h })) }).passed);

  const grow = (pick: (i: number) => Partial<Sample>) => ({ ...healthy(), cycles: [1, 2, 3, 4].map((c) => sample(c, pick(c))) });
  check('the Sprint B bug — GL textures never freed — is CAUGHT (0 → 5 → 10 → 15)', failing(grow((c) => ({ glTextures: c * 5 - 5 })), /GL textures/));
  check('a single texture left behind is caught (the threshold is zero)', failing(grow(() => ({ glTextures: 1 })), /GL textures/));
  check('live renderers that are never demoted are caught', failing(grow((c) => ({ live: c })), /live renderers return/));
  check('sandbox iframes that pile up are caught', failing(grow((c) => ({ iframes: c })), /iframes/));
  check('leaked canvases are caught', failing(grow((c) => ({ canvases: 3 + c })), /canvases/));
  check('a steadily climbing heap is caught (40 → 55 → 70 → 85 MB)', failing(grow((c) => ({ heapMB: 25 + c * 15 })), /heap/));
  check('a DOM that keeps growing is caught', failing(grow((c) => ({ domNodes: 1000 + c * 300 })), /DOM/));
  check('a program cache that keeps growing every cycle is caught', failing(grow((c) => ({ glPrograms: 24 + c * 10 })), /program cache/));
  check('a runaway first pass (200 programs for 24 shaders) is caught even if it then stays flat', failing({ ...healthy(), cycles: [sample(1, { glPrograms: 200 }), sample(2, { glPrograms: 200 })] }, /program cache/));
  check('a first pass with a few programs per shader plus the stage\'s own (9 for 4 shaders) is FINE', analyse({ ...healthy(), shaderTiles: 4, baseline: sample(0, { glPrograms: 0 }), cycles: [sample(1, { glPrograms: 9 }), sample(2, { glPrograms: 9 }), sample(3, { glPrograms: 9 })] }).passed);
  check('the program cache growing to the number of shaders on cycle 1, then flat, is FINE', analyse(healthy()).passed);
  check('more live renderers than the cap is caught', failing({ ...healthy(), peaks: { live: 3, glTextures: 1, iframes: 1 } }, /cap/));
  check('a tile that never went live is reported', failing({ ...healthy(), focusFailures: ['Mandelbrot: timed out'] }, /every tile focused/));
  check('an uncaught page error fails the run', failing({ ...healthy(), pageErrors: ['TypeError: x is undefined'] }, /page errors/));
  check('a run with no completed cycle fails rather than passes vacuously', !analyse({ ...healthy(), cycles: [] }).passed);

  const two = analyse({ ...healthy(), cycles: [sample(1), sample(2)] });
  check('two cycles still work; the heap check judges total growth', two.passed);
  check('...and a big jump over two cycles is caught', !analyse({ ...healthy(), cycles: [sample(1, { heapMB: 40 }), sample(2, { heapMB: 90 })] }).passed);
  const one = analyse({ ...healthy(), cycles: [sample(1)] });
  check('one cycle is allowed but the trend checks are SKIPPED, not silently passed', one.passed && one.checks.filter((c) => c.skipped).length === 2, one.checks.filter((c) => c.skipped).map((c) => c.name));
  const noHeap = analyse({ ...healthy(), cycles: [1, 2, 3].map((c) => sample(c, { heapMB: null })) });
  check('a browser that reports no heap skips that check instead of failing', noHeap.passed && noHeap.checks.some((c) => c.skipped && /heap/.test(c.name)));
  check('thresholds can be loosened', analyse({ ...healthy(), cycles: [1, 2, 3, 4].map((c) => sample(c, { heapMB: 25 + c * 15 })) }, { heapSlopeMBPerCycle: 50, heapGrowthMB: 500 }).passed);
  check('the default thresholds are strict where it matters (zero tolerance for textures / live / iframes)', DEFAULT_THRESHOLDS.texturesOver === 0 && DEFAULT_THRESHOLDS.liveOver === 0 && DEFAULT_THRESHOLDS.iframesOver === 0);

  check('slope of a straight line is its gradient', Math.abs(slope([0, 1, 2, 3], [5, 7, 9, 11]) - 2) < 1e-9);
  check('slope of a flat series is 0, and of < 2 points is 0', slope([0, 1, 2], [4, 4, 4]) === 0 && slope([0], [3]) === 0 && slope([], []) === 0);
  check('frame summary: a steady 16.7 ms frame is ~60 fps', (() => { const f = summarizeFrames([500, ...Array(60).fill(16.7)]); return !!f && f.frames === 60 && f.medianMs === 16.7 && f.p95Ms === 16.7 && Math.abs(f.fps - 59.9) < 0.2; })());
  check('frame summary: the first gap is dropped, and the p95 shows a slow tail the median hides', (() => { const f = summarizeFrames([900, ...Array(90).fill(16), ...Array(10).fill(100)]); return !!f && f.medianMs === 16 && f.p95Ms === 100 && f.frames === 100; })());
  check('frame summary: too few frames, or junk values, give null rather than nonsense', summarizeFrames([10, 16]) === null && summarizeFrames([]) === null && summarizeFrames([5, NaN, -3, 0]) === null);
  const table = formatTable(baseline, [sample(1), sample(2)]);
  check('the console table has a header, a baseline row and one row per cycle', table.split('\n').length === 4 && /baseline/.test(table) && /cycle 2/.test(table) && /heap MB/.test(table), table);
}

/* ---------------------------------------------------------------- */
group('the configuration fails loudly on a mistake');
{
  const base = { SOAK_EMAIL: 'a@b.c', SOAK_PASSWORD: 'pw' };
  const good = parseConfig(base);
  check('defaults: localhost, 3 cycles, all tiles, headless, desktop', good.ok && good.config.url === 'http://localhost:3000' && good.config.cycles === 3 && good.config.tiles.mode === 'all' && good.config.headless && !good.config.mobile);
  check('credentials OR a session cookie are accepted', parseConfig({ SOAK_SESSION_COOKIE: 'abc' }).ok && good.ok);
  check('no sign-in at all is an error', (() => { const r = parseConfig({}); return !r.ok && r.errors.some((e) => /sign-in/.test(e)); })());
  check('an email without a password is an error', !parseConfig({ SOAK_EMAIL: 'a@b.c' }).ok);
  check('the URL is normalised to its origin', (() => { const r = parseConfig({ ...base, SOAK_URL: 'https://x.example/some/path/' }); return r.ok && r.config.url === 'https://x.example'; })());
  check('a non-http URL is rejected', !parseConfig({ ...base, SOAK_URL: 'ftp://x' }).ok && !parseConfig({ ...base, SOAK_URL: 'not a url' }).ok);
  check('cycles must be a sensible number', !parseConfig({ ...base, SOAK_CYCLES: '0' }).ok && !parseConfig({ ...base, SOAK_CYCLES: 'abc' }).ok && !parseConfig({ ...base, SOAK_CYCLES: '99999' }).ok && parseConfig({ ...base, SOAK_CYCLES: '5' }).ok);
  check('tiles: shader / sketch / a count are accepted, nonsense is not', (() => { const a = parseConfig({ ...base, SOAK_TILES: 'shader' }); const b = parseConfig({ ...base, SOAK_TILES: '12' }); return a.ok && a.config.tiles.mode === 'kind' && b.ok && b.config.tiles.mode === 'count' && !parseConfig({ ...base, SOAK_TILES: 'lots' }).ok && !parseConfig({ ...base, SOAK_TILES: '0' }).ok; })());
  check('SOAK_ONLY is split, trimmed and lower-cased', (() => { const r = parseConfig({ ...base, SOAK_ONLY: ' Feedback Trails , Flow Field ,' }); return r.ok && JSON.stringify(r.config.only) === '["feedback trails","flow field"]'; })());
  check('all mistakes are reported together, not one at a time', (() => { const r = parseConfig({ SOAK_URL: 'nope', SOAK_CYCLES: '0', SOAK_TILES: 'x' }); return !r.ok && r.errors.length >= 4; })());
  check('the cookie name follows the protocol (secure prefix on https)', (() => { const h = parseConfig({ SOAK_SESSION_COOKIE: 'x', SOAK_URL: 'https://a.example' }); const p = parseConfig({ SOAK_SESSION_COOKIE: 'x' }); return h.ok && h.config.cookieName.startsWith('__Secure-') && p.ok && p.config.cookieName === 'authjs.session-token'; })());
  check('flags accept 0/false/no/off', (() => { const r = parseConfig({ ...base, SOAK_HEADLESS: 'off', SOAK_MOBILE: '1', SOAK_SOFTWARE_GL: 'yes' }); return r.ok && !r.config.headless && r.config.mobile && r.config.softwareGl; })());
}

/* ---------------------------------------------------------------- */
group('wiring: the hook is really in the app, and the script is really registered');
{
  const root = process.cwd();
  const read = (p: string) => readFileSync(join(root, p), 'utf8');
  const pool = read('lib/render/pool.ts');
  check('pool.ts installs the hook (a no-op without ?soak)', /installSoakStats\(\(\) => getPool\(\)\.stats\(\), \(\) => peekGLStage\(\)\)/.test(pool));
  check('the pool exposes stats() with the live cap', /stats\(\): \{ live: number; focused: number; preview: number; cap: number \}/.test(pool) && /cap: MAX_LIVE_RENDERERS/.test(pool));
  check('the GL stage exposes programCount', /get programCount\(\): number/.test(read('lib/gl/context-pool.ts')));
  const runner = read('scripts/soak.ts');
  check('the runner opens the page with ?soak=1 and reads window.__vmlSoak', /\/\?soak=1/.test(runner) && /__vmlSoak/.test(runner));
  check('the runner forces a GC before each end-of-cycle sample', /stats\(page, true\)/.test(runner) && /--expose-gc/.test(runner));
  check('the runner realizes lazy cards before reading or clicking them, and returns the board to rest before every sample', /async function realize\(/.test(runner) && /async function rest\(/.test(runner) && /await rest\(page, 3000\)/.test(runner) && /await rest\(page, 1500\)/.test(runner));
  check('the frame sampler is sent to the page as a string (a function would break under tsx: "__name is not defined")', /page\.evaluate\(sampler\)/.test(runner) && /const sampler = `new Promise/.test(runner));
  check('no page.evaluate callback declares its own named arrow function (tsx would inject __name into it)', !/page\.evaluate\(\s*\(\w*\)\s*=>[^)]*\bconst \w+ = \(/.test(runner));
  check('the runner exits 0 / 1 / 2 as documented', /verdict\.passed \? 0 : 1/.test(runner) && /return 2/.test(runner));
  const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
  check('package.json registers `soak` and `verify:soak`', pkg.scripts.soak === 'tsx scripts/soak.ts' && pkg.scripts['verify:soak'] === 'tsx scripts/verify-soak.ts', pkg.scripts);
  check('the report file is git-ignored', /^soak-report\.json$/m.test(read('.gitignore')));
  check('the hook file contains no fetch / storage / cookie access (numbers only)', !/fetch\(|localStorage|sessionStorage|document\.cookie|XMLHttpRequest/.test(read('lib/debug/soak-stats.ts')));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
