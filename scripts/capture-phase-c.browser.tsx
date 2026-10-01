import { createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Output, CanvasSource, BufferTarget, Mp4OutputFormat, WebMOutputFormat,
 Input, BlobSource, ALL_FORMATS, CanvasSink, VideoSampleSink } from 'mediabunny';
import { resolveVideoCodec } from '../lib/capture/support';
import { exportTrimmedCapture } from '../lib/capture/export-trim';
import { useMediaDownload } from '../lib/capture/use-media-download';
import { previewCaptureTrim } from '../lib/capture/persist-trim';
import { useBoardStore } from '../stores/boardStore';
import type { Asset } from '../types/asset';
const check=(ok:unknown,message:string)=>{if(!ok)throw new Error(message)};
async function fixture(format:'mp4'|'webm') {
 const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;
 const ctx=canvas.getContext('2d')!;const target=new BufferTarget();
 const codec=await resolveVideoCodec(format,320,180);check(codec,'codec unavailable');
 const output=new Output({format:format==='mp4'?new Mp4OutputFormat():new WebMOutputFormat(),target});
 const source=new CanvasSource(canvas,{codec:codec!,bitrate:8_000_000});output.addVideoTrack(source,{frameRate:30});await output.start();
 for(let i=0;i<150;i++){ctx.fillStyle=`rgb(${20+i},${180-i},40)`;ctx.fillRect(0,0,320,180);await source.add(i/30,1/30,{keyFrame:i%60===0});}
 source.close();await output.finalize();return new Blob([target.buffer!],{type:format==='mp4'?'video/mp4':'video/webm'});
}
async function pixel(input:Input,time:number){const sink=new CanvasSink((await input.getPrimaryVideoTrack())!,{poolSize:1});const frame=await sink.getCanvas(time);check(frame,'missing decoded frame');const c=document.createElement('canvas');c.width=c.height=1;const ctx=c.getContext('2d')!;ctx.drawImage(frame!.canvas,10,10,1,1,0,0,1,1);return ctx.getImageData(0,0,1,1).data[0];}
export async function run() {
 const reports:unknown[]=[];
 for(const format of ['mp4','webm'] as const){
  const blob=await fixture(format);const original=new Uint8Array(await blob.arrayBuffer());
  for(const [start,end] of [[.8,2.4],[0,2],[3,5],[1.17,3.91],[1.21,1.31]]) {
   const result=await exportTrimmedCapture(blob,{startSec:start,endSec:end,sourceDurationSec:5});
   check(result.extension===format,'format changed');
   const input=new Input({source:new BlobSource(result.blob),formats:ALL_FORMATS});const src=new Input({source:new BlobSource(blob),formats:ALL_FORMATS});
   try {
    const duration=await input.computeDuration();check(Math.abs(duration-(end-start))<=1/30+.001,`trim duration ${duration}, expected ${end-start}`);
    const track=(await input.getPrimaryVideoTrack())!;check(track.displayWidth===320&&track.displayHeight===180,'resolution changed');
    let count=0;for await(const sample of new VideoSampleSink(track).samples()){count++;sample.close()}
    check(Math.abs(count-(end-start)*30)<=2,'unexpected frame count');
    const first=await pixel(input,.001),expected=await pixel(src,start+.001);check(Math.abs(first-expected)<=5,`wrong first source frame ${first} != ${expected}`);
    const last=await pixel(input,Math.max(0,duration-.02)),expectedLast=await pixel(src,end-.02);check(Math.abs(last-expectedLast)<=5,'wrong final source frame');
    reports.push({format,start,end,duration,count,width:track.displayWidth,height:track.displayHeight,firstFrameDelta:Math.abs(first-expected)});
   }finally{input.dispose();src.dispose()}
  }
  const abort=new AbortController();abort.abort();let canceled=false;try{await exportTrimmedCapture(blob,{startSec:0,endSec:2,sourceDurationSec:5},abort.signal)}catch{canceled=true}check(canceled,'pre-abort ignored');
  const during=new AbortController();let interrupted=false;try{await exportTrimmedCapture(blob,{startSec:0,endSec:4,sourceDurationSec:5},during.signal,()=>during.abort())}catch{interrupted=true}check(interrupted,'processing cancellation ignored');
  let invalid=false;try{await exportTrimmedCapture(blob,{startSec:0,endSec:8,sourceDurationSec:8})}catch{invalid=true}check(invalid,'invalid trim accepted');
  const after=new Uint8Array(await blob.arrayBuffer());check(original.every((v,i)=>v===after[i]),'source mutated');
 }
 return reports;
}
let uiRoot:ReturnType<typeof createRoot>|undefined;
function DownloadFixture({asset}:{asset:Asset}) {
 const [open,setOpen]=useState(true);const [note,setNote]=useState<string|null>(null);
 const {download,busy,label}=useMediaDownload(asset,open,setNote);
 return createElement('div',{},
  createElement('button',{onClick:()=>void download(),disabled:busy,'aria-label':'Download'},label),
  createElement('button',{onClick:()=>previewCaptureTrim(asset.id,{startSec:.8,endSec:2.4,sourceDurationSec:5})},'Trim'),
  createElement('button',{onClick:()=>previewCaptureTrim(asset.id,null)},'Reset'),
  createElement('button',{onClick:()=>setOpen(false)},'Close'),
  createElement('button',{onClick:()=>setOpen(true)},'Open'),
  createElement('span',{role:'status'},note));
}
export async function ui(format:'mp4'|'webm') {
 uiRoot?.unmount();document.getElementById('download-ui')?.remove();
 const blob=await fixture(format);const srcUrl=URL.createObjectURL(blob);
 const asset={id:'download-fixture-'+format,itemId:'download-fixture-'+format,type:'video',tags:['capture'],srcUrl,title:'Capture fixture',captureTrim:{startSec:.8,endSec:2.4,sourceDurationSec:5},createdAt:'',updatedAt:''} as Asset;
 useBoardStore.getState().setAssets([asset]);const host=document.createElement('div');host.id='download-ui';document.body.append(host);uiRoot=createRoot(host);uiRoot.render(createElement(DownloadFixture,{asset}));
 return {originalBytes:Array.from(new Uint8Array(await blob.arrayBuffer()))};
}
export async function userClip() {
 const response=await fetch('/user-clip.mp4');if(response.status===404)return {skipped:true};check(response.ok,'user clip unavailable');const blob=await response.blob();
 const result=await exportTrimmedCapture(blob,{startSec:.8,endSec:2.4,sourceDurationSec:5});const input=new Input({source:new BlobSource(result.blob),formats:ALL_FORMATS});
 try{const duration=await input.computeDuration();check(Math.abs(duration-1.6)<1/30,'Spatial HUD trim wrong duration');return{duration,bytes:Array.from(new Uint8Array(await result.blob.arrayBuffer()))}}finally{input.dispose()}
}
