import { build } from 'esbuild';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync,writeFileSync,mkdirSync } from 'node:fs';
import path from 'node:path';
(async()=>{
 const root=path.resolve(__dirname,'..'),art=path.join(root,'artifacts','capture-export-checks');mkdirSync(art,{recursive:true});
 const bundle=await build({absWorkingDir:root,entryPoints:['scripts/capture-phase-c.browser.tsx'],bundle:true,write:false,platform:'browser',format:'iife',globalName:'ExportChecks',jsx:'automatic'});
 const server=createServer((req,res)=>{
  if(req.url==='/checks.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles![0].text)}
  else if(req.url==='/user-clip.mp4'){if(process.env.VML_USER_CLIP_PATH){res.setHeader('Content-Type','video/mp4');res.end(readFileSync(process.env.VML_USER_CLIP_PATH))}else{res.statusCode=404;res.end()}}
  else res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><script src="/checks.js"></script>');
 });
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const address=server.address();if(!address||typeof address==='string')throw Error('server unavailable');
 const browser=await chromium.launch({headless:true,...process.env.VML_CHROME_PATH?{executablePath:process.env.VML_CHROME_PATH}:{},args:['--no-sandbox','--autoplay-policy=no-user-gesture-required','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 try{
  const page=await browser.newPage();await page.goto(`http://127.0.0.1:${address.port}`);
  const report=await page.evaluate(()=> (window as unknown as {ExportChecks:{run:()=>Promise<unknown>}}).ExportChecks.run());console.log(JSON.stringify(report,null,2));
  const user=await page.evaluate(()=> (window as unknown as {ExportChecks:{userClip:()=>Promise<{skipped?:boolean;duration?:number;bytes?:number[]}>}}).ExportChecks.userClip());
  if(user.bytes){writeFileSync(path.join(art,'spatial-hud-trimmed-check.mp4'),Buffer.from(user.bytes));console.log('User Spatial HUD MP4 trimmed duration:',user.duration)}
  for(const width of [1440,390])for(const format of ['mp4','webm'] as const){
   await page.setViewportSize({width,height:900});await page.reload();
   const info=await page.evaluate(format=>(window as unknown as {ExportChecks:{ui:(f:'mp4'|'webm')=>Promise<{originalBytes:number[]}>}}).ExportChecks.ui(format),format);
   const event=page.waitForEvent('download');await page.getByRole('button',{name:'Download',exact:true}).click();const download=await event;
   if(!download.suggestedFilename().endsWith(`trimmed.${format}`))throw Error('trimmed filename wrong');
   await download.saveAs(path.join(art,`trimmed-${width}.${format}`));
   await page.getByRole('status').filter({hasText:'Trimmed export ready'}).waitFor();
   await page.getByRole('button',{name:'Reset',exact:true}).click();const rawEvent=page.waitForEvent('download');await page.getByRole('button',{name:'Download',exact:true}).click();const raw=await rawEvent;
   const rawPath=path.join(art,`original-${width}.${format}`);await raw.saveAs(rawPath);if(!readFileSync(rawPath).equals(Buffer.from(info.originalBytes)))throw Error('reset changed original bytes');
   await page.getByRole('button',{name:'Trim',exact:true}).click();
   let unexpected=0;const onDownload=()=>unexpected++;page.on('download',onDownload);
   await page.evaluate(()=>{const buttons=[...document.querySelectorAll('button')];buttons.find(b=>b.getAttribute('aria-label')==='Download')!.click();buttons.find(b=>b.textContent==='Close')!.click();});await page.waitForTimeout(100);await page.getByRole('button',{name:'Open',exact:true}).click();
   await page.waitForTimeout(250);page.off('download',onDownload);if(unexpected)throw Error('closed export downloaded anyway');
   if(await page.getByRole('button',{name:'Download',exact:true}).isDisabled())throw Error('cancel left download stuck');
   console.log(`${width}px ${format}: actual download, reset byte equality, pending preview trim, close cancellation passed.`);
  }
  writeFileSync(path.join(art,'report.json'),JSON.stringify(report,null,2));
 }finally{await browser.close();await new Promise<void>(r=>server.close(()=>r()))}
})().catch(e=>{console.error(e);process.exitCode=1});
