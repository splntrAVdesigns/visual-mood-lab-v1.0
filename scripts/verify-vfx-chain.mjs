/** Production compositor control-flow regression, without a browser/GPU.
 * node scripts/verify-vfx-chain.mjs
 * Pixel correctness is covered separately by verify-vfx-runtime.mjs.
 */
import { build } from 'esbuild';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const built = await build({ stdin: { contents: `export * from './lib/gl/effects-compositor';`, resolveDir: process.cwd(), loader: 'ts' }, bundle:true, write:false, platform:'browser', format:'iife', globalName:'api', tsconfig:'tsconfig.json' });
class Canvas {
  width=64; height=48; content='base'; transforms=[];
  getContext() {
    return { save(){}, restore(){}, setTransform:(...args)=>this.transforms.push(args),
      drawImage:src=>{this.content=src.content;}, fillRect(){}, };
  }
}
let requests=0, offline=false;
const sandbox={ document:{createElement:()=>new Canvas()}, console:{warn(){},error(){}}, fetch:async url=>{
  requests++; if(offline) throw new Error('offline');
  return {ok:true,text:()=>readFile(`public${url}`,'utf8')};
}};
vm.createContext(sandbox);vm.runInContext(built.outputFiles[0].text,sandbox);
const api=sandbox.api;
const drawn=[];const canvases=[];
const stage={canvas:new Canvas(),compile:(key)=>({ok:key!=='fx:crt',program:{key}}),
 ensureCapacity:(w,h)=>({width:Math.min(1280,w),height:Math.min(1280,h)}),
 uploadTexture:(_key,canvas)=>{canvases.push(canvas);return {content:canvas.content};},
 draw:(program,w,h,apply)=>{const values={};apply((key,value)=>values[key]=value);drawn.push({key:program.key,values});stage.canvas.content=`${values.u_fxSource.content}>${program.key}`;return {sx:0,sy:0,sw:w,sh:h};}};
const effect=(type,mix=1)=>({id:type,effectType:type,enabled:true,mix,params:{},mod:{}});
let tests=0;
const check=(name,fn)=>{fn();tests++;console.log(`PASS ${name}`);};
const run=effects=>{drawn.length=0;canvases.length=0;const dest=new Canvas();api.compositeEffects(stage,dest,{source:dest,cardId:'test',effects,width:64,height:48,time:1});return dest;};
await api.loadEffectShaderIfNeeded('hue-shift');
check('loading final pass does not suppress earlier output',()=>assert.equal(run([effect('hue-shift'),effect('grain')]).content,'base>fx:hue-shift'));
offline=true;requests=0;
await Promise.all([api.loadEffectShaderIfNeeded('grain'),api.loadEffectShaderIfNeeded('grain')]);
check('concurrent fetch failures contained and deduplicated',()=>assert.equal(requests,1));
offline=false;await api.loadEffectShaderIfNeeded('grain');
check('failed load retries successfully',()=>assert.equal(requests,2));
await api.loadEffectShaderIfNeeded('crt');
for (const [name,effects,expected] of [
 ['single',[effect('grain')],'base>fx:grain'],
 ['double',[effect('grain'),effect('hue-shift')],'base>fx:grain>fx:hue-shift'],
 ['triple',[effect('grain'),effect('hue-shift'),effect('grain')],'base>fx:grain>fx:hue-shift>fx:grain'],
 ['failed final',[effect('grain'),effect('crt')],'base>fx:grain'],
 ['failed middle',[effect('grain'),effect('crt'),effect('hue-shift')],'base>fx:grain>fx:hue-shift'],
 ['unknown final',[effect('grain'),effect('unknown')],'base>fx:grain'],
 ['all failed',[effect('crt')],'base'],
 ['zero mix',[effect('grain',0)],'base'],
 ['disabled',[{...effect('grain'),enabled:false}],'base'],
]) {
 check(name,()=>{
   const dest=run(effects);assert.equal(dest.content,expected);
   for(const c of [dest,...canvases]) for(const t of c.transforms) assert.deepEqual(Array.from(t),[1,0,0,1,0,0]);
 });
}
check('schema defaults bound when absent in saved params',()=>{run([effect('grain')]);assert.equal(drawn[0].values.u_grainIntensity,0.15);});
await api.loadEffectShaderIfNeeded('math-warp');
check('select parameter reaches uniform as number',()=>{run([{...effect('math-warp'),params:{mode:'1'}}]);assert.equal(drawn[0].values.u_warpMode,1);});
check('uniform mix matches resolved modulated value',()=>{run([effect('grain',0.37)]);assert.equal(drawn[0].values.u_fxMix,0.37);});
check('large source uses bounded aspect-preserving shader viewport without resizing output',()=>{
  const dest=new Canvas();dest.width=2048;dest.height=1024;
  api.compositeEffects(stage,dest,{source:dest,cardId:'large',effects:[effect('grain')],width:2048,height:1024,time:1});
  assert.equal(dest.width,2048);assert.equal(dest.height,1024);
  assert.deepEqual(Array.from(drawn.at(-1).values.u_resolution),[1280,640]);
});
console.log(`${tests} compositor control-flow checks passed (no GPU).`);
