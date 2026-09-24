/** Real WebGL2 pixel regressions for Phase 4.99.1 A/B.
 * Run: node scripts/verify-vfx-runtime.mjs
 * Prerequisite: npm ci; npx playwright install chromium
 * Bundles production code, intercepts shader HTTP requests; no app/server/login.
 */
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const bundle = await build({
  stdin: { contents: `export { getGLStage } from './lib/gl/context-pool';
    export * from './lib/gl/effects-compositor';
    export * from './lib/effects/registry';`, resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, write: false, format: 'iife', globalName: 'vfx', platform: 'browser',
  tsconfig: 'tsconfig.json',
});
const browser = await chromium.launch({ executablePath: process.env.VFX_CHROMIUM_PATH || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage();
  await page.route('https://vfx.test/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>VFX regression</title>' });
    try {
      return route.fulfill({ contentType: 'text/plain', body: await readFile(`public${pathname}`, 'utf8') });
    } catch { return route.fulfill({ status: 404, body: '' }); }
  });
  await page.goto('https://vfx.test/');
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const results = await page.evaluate(async () => {
    const api = window.vfx;
    const stage = api.getGLStage();
    if (!stage) throw new Error('WebGL2 unavailable: cannot validate orientation');
    const checks = [];
    const check = (name, ok) => { checks.push({ name, ok }); };
    const instance = (type, params = {}, mix = 1) => ({ id: type, effectType: type, enabled: true, mix, params: { ...api.defaultEffectParams(type), ...params }, mod: {} });
    let serial = 0;
    const fixture = (w = 64, h = 48) => {
      const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      // Four distinct quadrants expose Y flips, X flips and 180° rotation.
      for (const [x, y, color] of [[0,0,'#e03020'],[1,0,'#20b040'],[0,1,'#3050d0'],[1,1,'#d0b030']]) {
        ctx.fillStyle = color; ctx.fillRect(x*w/2,y*h/2,w/2,h/2);
      }
      return canvas;
    };
    const pixels = c => [...c.getContext('2d').getImageData(0,0,c.width,c.height).data];
    const equal = (a,b) => a.length === b.length && a.every((v,i) => Math.abs(v-b[i]) <= 1);
    const render = (effects, { w=64,h=48,cardId=`case-${serial++}`,source=fixture(w,h),time=0 }={}) => {
      api.compositeEffects(stage,source,{source,cardId,effects,width:w,height:h,time}); return source;
    };
    // Missing trailing shader BEFORE it is fetched must not hide a valid pass.
    await api.loadEffectShaderIfNeeded('hue-shift');
    const grade = instance('hue-shift',{brightness:0.5});
    const graded = pixels(render([grade]));
    check('loading final pass preserves prior output', equal(graded,pixels(render([grade,instance('grain')]))));
    const savedFetch = window.fetch;
    let fetchAttempts = 0;
    window.fetch = async (...args) => {
      if (String(args[0]).endsWith('broke-tv.frag')) { fetchAttempts++; throw new Error('injected offline'); }
      return savedFetch(...args);
    };
    await Promise.all([api.loadEffectShaderIfNeeded('broke-tv'), api.loadEffectShaderIfNeeded('broke-tv')]);
    check('concurrent failed fetch is contained and deduplicated', fetchAttempts === 1);
    window.fetch = async (...args) => {
      if (String(args[0]).endsWith('broke-tv.frag')) fetchAttempts++;
      return savedFetch(...args);
    };
    await api.loadEffectShaderIfNeeded('broke-tv');
    check('failed fetch can retry', fetchAttempts === 2);
    window.fetch = savedFetch;
    const defs = api.listEffectDefinitions();
    await Promise.all(defs.map(d => api.loadEffectShaderIfNeeded(d.id)));
    for (const def of defs) {
      const raw = await (await fetch(`/effects/shaders/${def.file}`)).text();
      check(`${def.id}: compiles`,stage.compile(`check:${def.id}`,api.wrapEffectSource(raw)).ok);
      check(`${def.id}: zero mix identity`,equal(pixels(fixture()),pixels(render([instance(def.id,{},0)]))));
    }
    const neutral = {
      grain:{intensity:0},'broke-tv':{intensity:0},'hue-shift':{},
      crt:{curvature:0,scanlines:0,vignette:0,mask:0},'noise-displace':{amount:0},
      'graphic-slice':{amount:0},'turbulent-feedback':{decay:0},
      'math-warp':{amount:0},'dark-strobe':{echo:0},'white-strobe':{},
    };
    for (const [type,params] of Object.entries(neutral)) {
      for (const [w,h] of [[64,48],[48,64],[48,48]]) {
        check(`${type}: neutral ${w}x${h}`,equal(pixels(fixture(w,h)),pixels(render([instance(type,params)],{w,h}))));
      }
    }
    for (const count of [1,2,3]) {
      check(`${count} neutral passes preserve orientation`,equal(pixels(fixture()),pixels(render(Array.from({length:count},()=>instance('grain',{intensity:0}))))));
    }
    const unknown=instance('retired-effect');
    for (const chain of [[grade,unknown],[unknown,grade],[grade,unknown,instance('grain',{intensity:0})]])
      check('unknown pass preserves valid chain',equal(graded,pixels(render(chain))));
    // Exercise genuine shader compile failure by substituting only compile input.
    const compile=stage.compile.bind(stage);
    stage.compile=(key,src)=>compile(key==='fx:grain'?'broken-grain':key,key==='fx:grain'?'invalid shader':src);
    check('failed final compile preserves prior pass',equal(graded,pixels(render([grade,instance('grain')]))));
    check('all failed leaves source intact',equal(pixels(fixture()),pixels(render([instance('grain')]))));
    stage.compile=compile;
    check('disabled final pass preserves prior output',equal(graded,pixels(render([grade,{...instance('grain'),enabled:false}]))));
    // Order remains meaningful: hue brightness before grain differs from reverse.
    check('rack order retained',!equal(pixels(render([grade,instance('grain')])),pixels(render([instance('grain'),grade]))));
    const original=pixels(fixture());
    const point=pixels(render([instance('invert')]));
    const at=(p,x,y)=>p.slice((y*64+x)*4,(y*64+x)*4+3);
    check('Point Invert intentionally rotates 180 degrees',equal(at(original,8,8),at(point,55,39)));
    const quad=pixels(render([instance('quad-mirror')]));
    check('Quad Mirror retains four-way fold',equal(at(quad,8,8),at(quad,55,39)) && equal(at(quad,55,8),at(quad,8,39)));
    const linear=pixels(render([instance('linear-mirror')]));
    check('Linear Mirror retains reflection',equal(at(linear,8,8),at(linear,8,39)));
    check('Math Warp modes remain distinct',!equal(pixels(render([instance('math-warp',{mode:'0'})])),pixels(render([instance('math-warp',{mode:'1'})]))));
    // Echo stores the first frame, then must return it upright over black.
    const historyId='echo-orientation';
    render([instance('turbulent-feedback',{turbulence:0,decay:1})],{cardId:historyId});
    const black=fixture(); const ctx=black.getContext('2d');ctx.fillStyle='#000';ctx.fillRect(0,0,64,48);
    const echoed=pixels(render([instance('turbulent-feedback',{turbulence:0,decay:1})],{cardId:historyId,source:black}));
    const tl=at(echoed,8,8),bl=at(echoed,8,39);
    check('echo orientation aligns with source',tl[0]>tl[2] && bl[2]>bl[0]);
    stage.dispose();
    return checks;
  });
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.name}`);
  assert.ok(results.every(r=>r.ok), `${results.filter(r=>!r.ok).length} VFX regressions failed`);
  console.log(`\n${results.length} WebGL2 checks passed.`);
} finally { await browser.close(); }
