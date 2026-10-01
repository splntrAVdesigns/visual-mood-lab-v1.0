// Real encoder/decoder checks, served on localhost (no application account).
// Run: node --import tsx scripts/verify-capture-browser.ts
// Optional: VML_CHROME_PATH=/path/to/Chrome executable
import { build } from 'esbuild';
import { chromium, type Browser } from 'playwright';
import { createServer } from 'node:http';
import path from 'node:path';
import { mkdirSync } from 'node:fs';

(async () => {
  const root = path.resolve(__dirname, '..');
  const artifacts = path.join(root, 'artifacts', 'capture-trim-checks');
  mkdirSync(artifacts, { recursive: true });
  const bundle = await build({ absWorkingDir: root, entryPoints: ['scripts/capture-phase-b.browser.tsx'],
    bundle: true, write: false, format: 'iife', globalName: 'CaptureChecks', platform: 'browser', jsx: 'automatic', outfile: 'checks.js' });
  const server = createServer((req, res) => {
    if (req.url === '/checks.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles!.find(f => f.path.endsWith('.js'))!.text); }
    else if (req.url === '/checks.css') { res.setHeader('Content-Type', 'text/css'); res.end(bundle.outputFiles!.find(f => f.path.endsWith('.css'))!.text); }
    else { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Phase B capture checks</title><link rel="stylesheet" href="/checks.css"><style>:root{--accent:#00d3ff;--border-hi:#333;--text-dim:#888;--font-mono:monospace}body{margin:0;background:#111;color:#ddd}</style><script src="/checks.js"></script>'); }
  });
  let browser: Browser | undefined;
  try {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ headless: true,
      ...(process.env.VML_CHROME_PATH ? { executablePath: process.env.VML_CHROME_PATH } : {}),
      args: ['--autoplay-policy=no-user-gesture-required', '--disable-dev-shm-usage',
        '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const page = await browser.newPage();
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Local server has no address');
    await page.goto(`http://127.0.0.1:${address.port}`);
    const reports = await page.evaluate(() => (window as unknown as { CaptureChecks: { run: () => Promise<unknown> } }).CaptureChecks.run());
    console.log(JSON.stringify(reports, null, 2));
    console.log('Phase B real MP4/WebM trim playback checks passed.');
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await page.reload();
      const writes: unknown[] = [];
      let failNext = false;
      await page.route('**/api/assets/**', async route => { writes.push(route.request().postDataJSON()); if (failNext) { failNext = false; await route.fulfill({status:500,json:{error:'fixture failure'}}); } else await route.fulfill({json:{ok:true}}); });
      await page.evaluate(() => (window as unknown as { CaptureChecks: { ui: () => void } }).CaptureChecks.ui());
      const start = page.getByRole('slider', {name:'Trim start', exact:true});
      const end = page.getByRole('slider', {name:'Trim end', exact:true});
      await start.focus(); await start.press('ArrowRight'); await start.press('ArrowRight');
      await end.focus(); await end.press('ArrowLeft');
      await page.getByRole('status').filter({hasText:'Saved'}).waitFor();
      if (Number(await start.getAttribute('aria-valuenow')) !== .02) throw new Error('keyboard start mismatch');
      const box = await end.boundingBox();
      if (!box || box.width < 44 || box.height < 44) throw new Error('touch target too small');
      await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x-80,box.y+box.height/2);await page.mouse.up();
      await page.getByRole('status').filter({hasText:'Saved'}).waitFor();
      if (Number(await end.getAttribute('aria-valuenow')) >= 4.99) throw new Error('drag ignored');
      if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error('mobile overflow');
      await page.screenshot({path:path.join(artifacts, `trim-${width}.png`)});
      await page.getByRole('button',{name:'Reset',exact:true}).click();
      await page.getByRole('status').filter({hasText:'Saved'}).waitFor();
      if (writes.at(-1) && (writes.at(-1) as {captureTrim:unknown}).captureTrim !== null) throw new Error('reset not persisted');
      failNext = true;
      await start.focus(); await start.press('ArrowRight');
      await page.getByRole('button', {name:'Retry save', exact:true}).waitFor();
      await page.getByRole('button', {name:'Retry save', exact:true}).click();
      await page.getByRole('status').filter({hasText:'Saved'}).waitFor();
      if ((writes.at(-1) as {captureTrim:{startSec:number}}).captureTrim.startSec !== .01) throw new Error('retry lost draft');
      console.log(`Phase B UI ${width}px: keyboard, pointer drag, 44px targets, reset, failure/retry and no overflow passed.`);
      await page.unroute('**/api/assets/**');
    }
  } finally {
    await browser?.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
