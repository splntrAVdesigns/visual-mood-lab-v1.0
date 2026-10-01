import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { CaptureTrimControl } from '../features/inspector/CaptureTrimControl';
import { useBoardStore } from '../stores/boardStore';
import { MediaRenderer } from '../renderers/media.renderer';
import { startCapture } from '../lib/capture/engine';
import type { Asset } from '../types/asset';
const check = (ok: unknown, message: string) => { if (!ok) throw new Error(message); };
const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
function TrimFixture() {
 const asset = useBoardStore(state => state.assets[0]);
 return createElement(CaptureTrimControl, {asset});
}
export function ui() {
 const asset = { id:'trim-fixture',itemId:'trim-fixture',isOwned:true,type:'video',title:'Trim fixture',tags:['capture'],capture:{durationSec:5,loopMode:'smooth'}, createdAt:'',updatedAt:'' } as Asset;
 useBoardStore.getState().setAssets([asset]);
 const host = document.createElement('div'); host.id='trim-ui';host.style.cssText='width:100%;max-width:320px;margin:40px auto;padding:16px;box-sizing:border-box';document.body.append(host);
 createRoot(host).render(createElement(TrimFixture));
}
export async function run() {
 const canvas = document.createElement('canvas');canvas.width=320;canvas.height=180;document.body.append(canvas);
 const ctx=canvas.getContext('2d')!;ctx.fillStyle='#00d3ff';ctx.fillRect(0,0,320,180);
 const reports: unknown[]=[];
 for(const format of ['mp4','webm'] as const) {
  const result=await (await startCapture(canvas,{format,durationSec:5,loopMode:'off'})).result;
  const bytes=await result.blob.arrayBuffer();
  const asset={title:'Trim fixture',createdAt:'',updatedAt:'',id:'trim-fixture',itemId:'trim-fixture',type:'video',tags:['capture'],srcUrl:URL.createObjectURL(result.blob),params:{loop:true,speed:1},captureTrim:{startSec:.5,endSec:1.1,sourceDurationSec:5}} as Asset;
  const renderer=new MediaRenderer(asset.id,'video'),host=document.createElement('div');document.body.append(host);
  await renderer.mount(host,asset,new AbortController().signal);
  const video=host.querySelector('video')!;
  let alive=true;function tick(){renderer.render({} as never);if(alive)requestAnimationFrame(tick);}tick();
  await delay(100);check(video.currentTime>=.5,'mount starts before range');
  await delay(1300);check(video.currentTime>=.5&&video.currentTime<1.2,'loop escaped trim');
  renderer.setParam('loop',false);await delay(900);
  check(video.paused&&video.currentTime>=1.05&&video.currentTime<1.1,'one-shot does not hold selected end');
  renderer.setParam('opacity',.8);renderer.setParam('speed',2);await delay(100);check(video.paused,'unrelated edit restarted one-shot');
  renderer.setParam('loop',true);await delay(100);check(!video.paused&&video.currentTime<1.1,'enable loop did not restart range');
  renderer.pause();const paused=video.currentTime;await delay(100);check(Math.abs(video.currentTime-paused)<.05,'global pause ignored');renderer.play();
  renderer.setParam('paused',true);renderer.setPlaybackRange({startSec:2,endSec:3});await delay(100);check(video.paused&&video.currentTime>=2,'paused trim edit ignored');
  renderer.setParam('paused',false);renderer.setParam('speed',4);await delay(450);check(video.currentTime>=2&&video.currentTime<3.15,'speed-scaled loop escaped trim');
  renderer.setPlaybackRange(null);check(video.loop,'reset did not restore native loop');
  const after=await result.blob.arrayBuffer();check(bytes.byteLength===after.byteLength&&new Uint8Array(bytes).every((v,i)=>v===new Uint8Array(after)[i]),'source bytes changed');
  alive=false;renderer.dispose();host.remove();URL.revokeObjectURL(asset.srcUrl!);
  reports.push({format,bytes:bytes.byteLength,trimLoop:true,oneShot:true,pause:true,speed:true,reset:true,sourceUnchanged:true});
 }
 canvas.remove();return reports;
}
