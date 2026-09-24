/** Deterministic C/D lifecycle, resource and transport checks (no browser).
 * Run: node scripts/verify-vfx-cd.mjs
 */
import { build } from 'esbuild';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const { outputFiles } = await build({
  stdin: {
    contents: `export * from './lib/effects/surface';
      export * from './lib/effects/feedback';
      export * from './lib/gl/effect-targets';
      export * from './lib/sandbox/validate-message';
      export * from './renderers/sandbox-effect-surface';`,
    resolveDir: process.cwd(), loader: 'ts',
  },
  bundle: true, write: false, platform: 'browser', format: 'iife',
  globalName: 'vfxCD', tsconfig: 'tsconfig.json',
});

let time = 0;
class FrameBitmap {
  constructor(width, height) { this.width = width; this.height = height; this.closed = false; }
  close() { this.closed = true; }
}
class Canvas {
  width = 0; height = 0; style = {};
  getContext() {
    return { setTransform() {}, drawImage() {},
      set globalAlpha(_value) {}, set globalCompositeOperation(_value) {}, };
  }
  remove() { this.removed = true; }
}
const sandbox = {
  document: { createElement: () => new Canvas() },
  ImageBitmap: FrameBitmap,
  performance: { now: () => time },
};
vm.createContext(sandbox);
vm.runInContext(outputFiles[0].text, sandbox);
const api = sandbox.vfxCD;
const report = (label, test) => { test(); console.log(`PASS ${label}`); };

report('size bounded in both axes and total pixels', () => {
  for (const [w,h,dpr] of [[4096,2160,3],[300,600,2],[1920,1080,1],[1,1,1]]) {
    const [x,y] = api.effectSize(w,h,dpr);
    assert(x > 0 && y > 0 && x <= 2048 && y <= 2048);
    assert(x*y <= 2_097_152);
  }
});
report('feedback decay independent of frame rate', () => {
  for (const fps of [30,60,120]) {
    let retained = 1;
    for(let i=0;i<fps;i++) retained *= api.feedbackWeights(1/fps).retain;
    assert(Math.abs(retained - 0.85**60) < 0.00001);
  }
});
report('sandbox message gate rejects spoofed or oversized frames', () => {
  assert.equal(api.parseSandboxMessage({type:'vfx-frame',requestId:0}),null);
  assert.equal(api.parseSandboxMessage({type:'vfx-frame',requestId:1,bitmap:{width:1,height:1}}),null);
  assert.equal(api.parseSandboxMessage({type:'vfx-frame',requestId:1,bitmap:new FrameBitmap(2048,2048)}),null);
  assert(api.parseSandboxMessage({type:'vfx-frame',requestId:1,bitmap:new FrameBitmap(320,240)}));
});

const fbo = {
  FRAMEBUFFER: 1, TEXTURE_2D: 2, RGBA8: 3, RGBA: 4, UNSIGNED_BYTE: 5,
  TEXTURE_MIN_FILTER: 6, TEXTURE_MAG_FILTER: 7, TEXTURE_WRAP_S: 8,
  TEXTURE_WRAP_T: 9, LINEAR: 10, CLAMP_TO_EDGE: 11, COLOR_ATTACHMENT0: 12,
  FRAMEBUFFER_COMPLETE: 13, created: 0, deleted: 0, status: 13,
  createFramebuffer() { this.created++; return {}; },
  createTexture() { this.created++; return {}; },
  deleteFramebuffer() { this.deleted++; }, deleteTexture() { this.deleted++; },
  bindTexture() {}, texImage2D() {}, texParameteri() {}, bindFramebuffer() {},
  framebufferTexture2D() {}, checkFramebufferStatus() { return this.status; },
};
const stage = { gl:fbo, generation:0, isLost:false };
report('GPU targets reused and freed on size/context changes and dispose', () => {
  const first=api.getEffectTargets(stage,'first',300,200);
  assert(first && first.length === 2);
  assert.equal(api.getEffectTargets(stage,'first',300,200),first);
  assert.equal(fbo.created,4);
  stage.generation++;
  assert.notEqual(api.getEffectTargets(stage,'first',300,200),first);
  assert.equal(fbo.deleted,4);
  api.releaseEffectTargets('first');assert.equal(fbo.deleted,8);
});
report('oversized or incomplete GPU targets fail closed', () => {
  assert.equal(api.getEffectTargets(stage,'large',5000,5000),null);
  fbo.status=0;
  assert.equal(api.getEffectTargets(stage,'bad',300,200),null);
  assert.equal(fbo.created,fbo.deleted);
  fbo.status=13;
  api.releaseEffectTargets('bad');
});

const host = { appendChild() {} }, iframe = {style:{}}, messages = [];
const adapter = new api.SandboxEffectSurface(iframe,host,message=>messages.push(message));
adapter.setActive(true);
report('sandbox transport permits one outstanding request', () => {
  adapter.render({width:200,height:100,pixelRatio:1});
  adapter.render({width:200,height:100,pixelRatio:1});
  assert.equal(messages.length,1);
  assert.equal(adapter.getCanvas(),null);
});
report('wrong request cannot present and bitmap is closed', () => {
  const wrong = new FrameBitmap(200,100);
  adapter.accept({type:'vfx-frame',requestId:999,bitmap:wrong});
  assert.equal(adapter.getCanvas(),null);
  assert(wrong.closed);
});
report('valid frame presents while isolated iframe remains pointer target', () => {
  const right = new FrameBitmap(200,100);
  adapter.accept({type:'vfx-frame',requestId:messages[0].requestId,bitmap:right});
  adapter.render({width:200,height:100,pixelRatio:1});
  assert(right.closed);
  assert(adapter.getCanvas());
  assert.equal(iframe.style.opacity,'0');
});
report('resize, timeout and bypass restore original iframe', () => {
  adapter.render({width:300,height:100,pixelRatio:1});
  assert.equal(adapter.getCanvas(),null);
  assert.equal(iframe.style.opacity,'');
  time=1100;
  adapter.render({width:300,height:100,pixelRatio:1});
  adapter.setActive(false);
  assert.equal(adapter.getCanvas(),null);
  assert.equal(iframe.style.opacity,'');
  adapter.dispose();
});
