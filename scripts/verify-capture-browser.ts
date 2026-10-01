// Real encoder/decoder checks, served on localhost (no application account).
// Run: node --import tsx scripts/verify-capture-browser.ts
// Optional: VML_CHROME_PATH=/path/to/Chrome executable
import { build } from 'esbuild';
import { chromium, type Browser } from 'playwright';
import { createServer } from 'node:http';
import path from 'node:path';

(async () => {
  const root = path.resolve(__dirname, '..');
  const bundle = await build({ absWorkingDir: root, entryPoints: ['scripts/capture-phase-a.browser.ts'],
    bundle: true, write: false, format: 'iife', globalName: 'CaptureChecks', platform: 'browser' });
  const server = createServer((req, res) => {
    if (req.url === '/checks.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles![0].text); }
    else { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Phase A capture checks</title><script src="/checks.js"></script>'); }
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
    console.log('Phase A real MP4/WebM capture and playback checks passed.');
  } finally {
    await browser?.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
