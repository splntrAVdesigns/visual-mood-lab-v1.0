/** CPU contract for Particle Cube; run with node scripts/verify-particle-cube.mjs.
 * Browser/device pixel quality is a separate acceptance gate. */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import vm from 'node:vm';

const bundle=await build({stdin:{contents:"export { default as sketch, params } from './seed/sketches/particle-cube.js'",resolveDir:process.cwd(),loader:'js'},bundle:true,write:false,format:'iife',globalName:'cube',platform:'browser'});
const sandbox={};vm.createContext(sandbox);vm.runInContext(bundle.outputFiles[0].text,sandbox);
const params=Object.fromEntries(Object.entries(sandbox.cube.params).map(([key,value])=>[key,value.default]));
params.count=1700;
let noise=0,points=[],lastStroke=[],transforms=0,shapeCalls=0;
const p={
  WEBGL:1, RGB:2, ADD:3, BLEND:4, POINTS:5, width:800,height:800,windowWidth:800,windowHeight:800,
  _renderer:{GL:{ALIASED_POINT_SIZE_RANGE:1,getParameter:()=>[1,64]},uMVMatrix:{mat4:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]}},
  random:(a=1,b)=> b===undefined ? a*0.35 : a+(b-a)*0.35,
  noise:()=>{noise++;return 0.7}, hypot:Math.hypot,
  createCanvas(){},colorMode(){},noStroke(){},noFill(){},background(){},millis:()=>1000,
  orbitControl(){},radians:x=>x*Math.PI/180,rotateX(){},rotateY(){},rotateZ(){},
  blendMode(){},stroke:(...args)=>{lastStroke=args},strokeWeight(){},
  beginShape:()=>shapeCalls++,vertex:(x,y,z)=>points.push({x,y,z,stroke:lastStroke}),endShape(){},
  constrain:(n,lo,hi)=>Math.min(hi,Math.max(lo,n)),lerp:(a,b,t)=>a+(b-a)*t,
  push:()=>transforms++,pop:()=>transforms++,resetMatrix(){},fill(){},translate(){},plane(){},
};
sandbox.cube.sketch(p,key=>params[key]);
p.setup();
assert.equal(noise,params.count*3,'static jitter is sampled only at build');
noise=0;p.draw();
assert.equal(noise,params.count*3,'only animated noise is sampled each frame');
assert.ok(points.length>=params.count && points.length<=params.count*1.3,'one sparse halo plus one core per particle');
assert.ok(shapeCalls<=56,'points are batched into at most 28 core and 28 halo shapes');
assert.equal(transforms,0,'particles do not push/pop transforms');
assert.equal(points.at(-1).stroke[3],params.alpha,'core obeys opacity');
const lit=points.map(point=>point.stroke.slice(0,3).reduce((a,b)=>a+b,0));
assert.ok(Math.max(...lit)>1,'visible bright core remains against black');
points=[];shapeCalls=0;params.glow=0;params.turbulence=0;noise=0;p.draw();
assert.equal(points.length,params.count,'glow bypass emits one point per particle');
assert.ok(shapeCalls<=28,'no glow requires at most 28 shapes');
assert.equal(noise,0,'static turbulence bypass avoids noise calls');
console.log('PASS Particle Cube batching, brightness, opacity, jitter caching and turbulence bypass');
