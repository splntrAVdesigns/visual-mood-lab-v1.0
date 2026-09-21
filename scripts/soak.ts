/**
 * Soak test: focus and blur every tile, N times, and prove nothing leaks.
 *
 *   SOAK_URL=https://your-site SOAK_EMAIL=you@x.com SOAK_PASSWORD=… npm run soak
 *   SOAK_URL=http://localhost:3000 SOAK_EMAIL=… SOAK_PASSWORD=… SOAK_CYCLES=5 npm run soak
 *
 * It drives the REAL board — click a tile to focus it, wait for its renderer
 * to go live, hold, close it — so it exercises the same promote/demote paths
 * a person does, for shaders AND sketches (iframes). Numbers come from the
 * read-only `?soak=1` hook (lib/debug/soak-stats.ts): live renderers, GL
 * textures and programs, iframes, canvases, DOM size and JS heap.
 *
 * After each full pass it forces a GC, samples, and checks the page is back
 * to where it started (scripts/soak-analysis.ts explains what "back" means
 * for each measurement). Exit code: 0 = no leak found, 1 = leak or failure,
 * 2 = could not run (bad config, sign-in failed, browser missing).
 *
 * One-time setup on a machine: `npx playwright install chromium`.
 *
 * Settings (environment):
 *   SOAK_URL             site to test                 (default http://localhost:3000)
 *   SOAK_EMAIL/PASSWORD  sign in through the login form
 *   SOAK_SESSION_COOKIE  ...or supply a session cookie value instead
 *   SOAK_CYCLES          full passes over the board   (default 3)
 *   SOAK_TILES           all | shader | sketch | <n>  (default all)
 *   SOAK_ONLY            comma-separated title fragments, e.g. "Feedback Trails,Flow Field"
 *   SOAK_HOLD_MS         time each tile stays open    (default 700)
 *   SOAK_MOBILE          1 = phone-sized viewport with touch
 *   SOAK_HEADLESS        0 = watch it run
 *   SOAK_SOFTWARE_GL     1 = software GL, for machines without a GPU
 *   SOAK_REPORT          JSON report path             (default soak-report.json)
 *   SOAK_MAX_HEAP_SLOPE / SOAK_MAX_HEAP_GROWTH   heap thresholds (MB per cycle / MB total)
 */

import { writeFileSync } from 'node:fs';
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from 'playwright';
import type { SoakStats } from '../lib/debug/soak-stats';
import { analyse, formatTable, summarizeFrames, type FrameSummary, type RunFacts, type Sample } from './soak-analysis';
import { parseConfig, type SoakConfig } from './soak-config';

interface TileInfo {
  index: number;
  title: string;
  kind: 'shader' | 'sketch' | 'other';
}

const log = (msg: string) => process.stdout.write(`${msg}\n`);

async function stats(page: Page, gc = false): Promise<SoakStats> {
  return page.evaluate((forceGc) => {
    const api = window.__vmlSoak;
    if (!api) throw new Error('stats hook missing — open the page with ?soak=1');
    return api.stats({ gc: forceGc });
  }, gc);
}

const toSample = (cycle: number, s: SoakStats): Sample => ({
  cycle,
  live: s.live,
  focused: s.focused,
  glTextures: s.glTextures,
  glPrograms: s.glPrograms,
  iframes: s.iframes,
  canvases: s.canvases,
  domNodes: s.domNodes,
  heapMB: s.heapMB,
});

async function signIn(page: Page, context: BrowserContext, cfg: SoakConfig): Promise<void> {
  if (cfg.cookieValue) {
    await context.addCookies([{ name: cfg.cookieName, value: cfg.cookieValue, url: cfg.url, httpOnly: true, sameSite: 'Lax' }]);
    return;
  }
  await page.goto(`${cfg.url}/login`, { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Email').first().fill(cfg.email ?? '');
  await page.getByLabel('Password').first().fill(cfg.password ?? '');
  await page.getByRole('button', { name: 'Log in', exact: true }).first().click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 });
}

/**
 * The board lazy-renders: most cards are empty shells until they scroll into
 * view, and their text can disappear again when they leave it. So a card is
 * "realized" — scrolled into view and waited on until its text is there —
 * before it is read or clicked.
 */
async function realize(page: Page, card: Locator, timeoutMs = 8000): Promise<string> {
  await card.scrollIntoViewIfNeeded({ timeout: timeoutMs });
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const text = (await card.innerText().catch(() => '')).trim();
    if (text) return text;
    if (Date.now() > deadline) return '';
    await page.waitForTimeout(100);
  }
}

/** Puts the board back in the same resting position, so the same cards are in view (and previewing) at every sample. */
async function rest(page: Page, settleMs: number): Promise<void> {
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('*'))) if (el.scrollTop > 0) el.scrollTop = 0;
  });
  await page.waitForTimeout(Math.max(settleMs, 1500));
}

async function listTiles(page: Page): Promise<TileInfo[]> {
  const cards = page.locator('button[class*="card"]');
  await cards.first().waitFor({ timeout: 60000 });
  await page.waitForTimeout(1500);
  const count = await cards.count();
  const tiles: TileInfo[] = [];
  for (let index = 0; index < count; index++) {
    const text = await realize(page, cards.nth(index));
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    const kind = lines.includes('GLSL') ? 'shader' : lines.includes('P5') ? 'sketch' : 'other';
    tiles.push({ index, title: lines.find((l) => l !== 'GLSL' && l !== 'P5') ?? '', kind });
  }
  return tiles;
}

function selectTiles(all: TileInfo[], cfg: SoakConfig): TileInfo[] {
  let chosen = all;
  if (cfg.only.length) chosen = chosen.filter((t) => cfg.only.some((frag) => t.title.toLowerCase().includes(frag)));
  if (cfg.tiles.mode === 'kind') chosen = chosen.filter((t) => t.kind === (cfg.tiles as { kind: string }).kind);
  if (cfg.tiles.mode === 'count') chosen = chosen.slice(0, cfg.tiles.n);
  return chosen;
}

async function closeFocused(page: Page): Promise<void> {
  const dialog = page.locator('[data-focused-view="true"]:visible').first();
  const closeBtn = dialog.getByRole('button', { name: 'Close' }).first();
  if (await closeBtn.count()) await closeBtn.click({ timeout: 5000 }).catch(() => page.keyboard.press('Escape'));
  else await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => undefined);
}

async function main(): Promise<number> {
  const parsed = parseConfig(process.env);
  if (!parsed.ok) {
    log('Cannot start the soak test:\n' + parsed.errors.map((e) => `  - ${e}`).join('\n'));
    return 2;
  }
  const cfg = parsed.config;

  const args = ['--enable-precise-memory-info', '--js-flags=--expose-gc'];
  if (cfg.softwareGl) args.push('--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist');
  if (typeof process.getuid === 'function' && process.getuid() === 0) args.push('--no-sandbox');

  let browser: Browser;
  try {
    browser = await chromium.launch({ headless: cfg.headless, args, ...(cfg.chromePath ? { executablePath: cfg.chromePath } : {}) });
  } catch (err) {
    log(`Could not launch Chromium: ${(err as Error).message.split('\n')[0]}\nRun once:  npx playwright install chromium`);
    return 2;
  }

  const pageErrors: string[] = [];
  let consoleErrors = 0;
  const consoleErrorTexts = new Map<string, number>();
  try {
    const context = await browser.newContext(
      cfg.mobile
        ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }
        : { viewport: { width: 1280, height: 800 } },
    );
    await context.addInitScript(() => {
      try {
        localStorage.setItem('vml:onboarding-has-opened', 'true');
      } catch {
        /* storage unavailable */
      }
    });
    const page = await context.newPage();
    page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 200)));
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      consoleErrors++;
      const text = m.text().replace(/\s+/g, ' ').slice(0, 140);
      consoleErrorTexts.set(text, (consoleErrorTexts.get(text) ?? 0) + 1);
    });

    try {
      await signIn(page, context, cfg);
    } catch (err) {
      log(`Sign-in failed: ${(err as Error).message.split('\n')[0]}`);
      return 2;
    }

    await page.goto(`${cfg.url}/?soak=1`, { waitUntil: 'domcontentloaded' });
    if (new URL(page.url()).pathname.startsWith('/login')) {
      log('Sign-in did not stick (the app redirected back to /login). Check the credentials or the session cookie.');
      return 2;
    }
    await page.waitForFunction(() => Boolean(window.__vmlSoak), null, { timeout: 60000 }).catch(() => undefined);
    const allTiles = await listTiles(page);
    const unreadable = allTiles.filter((t) => !t.title).length;
    if (unreadable) log(`warning: ${unreadable} card(s) never rendered a title and are skipped.`);
    const tiles = selectTiles(allTiles.filter((t) => t.title), cfg);
    if (tiles.length === 0) {
      log(`No tiles matched (the board has ${allTiles.length}). Check SOAK_ONLY / SOAK_TILES.`);
      return 2;
    }
    const shaderTiles = tiles.filter((t) => t.kind === 'shader').length;
    log(`Soak test → ${cfg.url}   ${tiles.length} of ${allTiles.length} tiles (${shaderTiles} shader, ${tiles.filter((t) => t.kind === 'sketch').length} sketch)   ${cfg.cycles} cycle(s)   ${cfg.mobile ? 'mobile' : 'desktop'} viewport`);

    await rest(page, 3000);
    const baseline = toSample(0, await stats(page, true));
    log(`baseline: live ${baseline.live}, textures ${baseline.glTextures}, programs ${baseline.glPrograms}, iframes ${baseline.iframes}, heap ${baseline.heapMB ?? 'n/a'} MB`);

    const cycles: Sample[] = [];
    const peaks = { live: 0, glTextures: 0, iframes: 0 };
    let cap = 0;
    const focusFailures: string[] = [];
    const focusTimes: Array<{ title: string; ms: number }> = [];
    const frames = new Map<string, FrameSummary[]>();

    for (let c = 1; c <= cfg.cycles; c++) {
      const startedAt = Date.now();
      for (let i = 0; i < tiles.length; i++) {
        const tile = tiles[i];
        try {
          const cards = page.locator('button[class*="card"]');
          const card = cards.nth(tile.index);
          const t0 = Date.now();
          const shown = await realize(page, card, cfg.focusTimeoutMs);
          if (!shown.includes(tile.title)) throw new Error(`board order changed (expected "${tile.title}", found "${shown.split('\n')[0]}")`);
          await card.click({ timeout: cfg.focusTimeoutMs });
          await page.waitForFunction(() => (window.__vmlSoak?.stats().focused ?? 0) >= 1, null, { timeout: cfg.focusTimeoutMs });
          const took = Date.now() - t0;
          if (c === 1) focusTimes.push({ title: tile.title, ms: took });
          // Hold the tile open while sampling the gaps between animation frames.
          // This is sent as a STRING on purpose. tsx/esbuild rewrites named arrow
          // functions to call a `__name` helper; Playwright serialises a function
          // argument's source into the page, where that helper doesn't exist
          // ("ReferenceError: __name is not defined"). A string is never rewritten.
          const sampler = `new Promise((resolve) => { const out = []; let last = performance.now(); const end = last + ${Math.max(cfg.holdMs, 300)}; const tick = (t) => { out.push(t - last); last = t; if (t < end) requestAnimationFrame(tick); else resolve(out); }; requestAnimationFrame(tick); })`;
          const deltas = (await page.evaluate(sampler)) as number[];
          const summary = summarizeFrames(deltas);
          if (summary) frames.set(tile.title, [...(frames.get(tile.title) ?? []), summary]);
          const s = await stats(page);
          cap = s.cap;
          peaks.live = Math.max(peaks.live, s.live);
          peaks.glTextures = Math.max(peaks.glTextures, s.glTextures);
          peaks.iframes = Math.max(peaks.iframes, s.iframes);
        } catch (err) {
          if (c === 1 || !focusFailures.some((f) => f.startsWith(`${tile.title}:`))) {
            focusFailures.push(`${tile.title}: ${(err as Error).message.split('\n')[0].slice(0, 90)}`);
          }
        }
        await closeFocused(page);
        await page.waitForTimeout(cfg.settleMs);
        if ((i + 1) % 10 === 0 || i === tiles.length - 1) process.stdout.write(`  cycle ${c}/${cfg.cycles}: ${i + 1}/${tiles.length} tiles\r`);
      }
      await rest(page, 1500);
      const s = await stats(page, true);
      cycles.push(toSample(c, s));
      log(`  cycle ${c}/${cfg.cycles} done in ${((Date.now() - startedAt) / 1000).toFixed(0)}s: live ${s.live}, textures ${s.glTextures}, programs ${s.glPrograms}, iframes ${s.iframes}, heap ${s.heapMB ?? 'n/a'} MB     `);
    }

    const facts: RunFacts = { baseline, cycles, peaks, cap, shaderTiles, focusFailures, pageErrors };
    const verdict = analyse(facts, cfg.thresholds);

    log('\n' + formatTable(baseline, cycles));
    log(`\npeaks during the run: live ${peaks.live} (cap ${cap}), GL textures ${peaks.glTextures}, iframes ${peaks.iframes}`);
    const slowest = [...focusTimes].sort((a, b) => b.ms - a.ms).slice(0, 5);
    if (slowest.length) log(`slowest tiles to go live (cycle 1): ${slowest.map((s) => `${s.title} ${(s.ms / 1000).toFixed(1)}s`).join(', ')}`);
    const env = await page.evaluate(() => ({ dpr: window.devicePixelRatio, width: window.innerWidth, height: window.innerHeight }));
    const heaviest = [...frames.entries()]
      .map(([title, list]) => ({ title, p95Ms: Math.max(...list.map((f) => f.p95Ms)), medianMs: list.reduce((a, f) => a + f.medianMs, 0) / list.length, fps: list.reduce((a, f) => a + f.fps, 0) / list.length }))
      .sort((a, b) => b.p95Ms - a.p95Ms);
    log(`\nframe cost while a tile is open (informational — depends on this machine; devicePixelRatio ${env.dpr}, viewport ${env.width}x${env.height}):`);
    for (const h of heaviest.slice(0, 5)) log(`    ${h.title.padEnd(24)} median ${h.medianMs.toFixed(1)} ms (~${h.fps.toFixed(0)} fps), worst p95 ${h.p95Ms.toFixed(1)} ms`);
    log(`console errors (informational, not part of the verdict): ${consoleErrors}`);
    for (const [text, n] of [...consoleErrorTexts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4)) log(`    ${n}x ${text}`);
    log('');
    for (const check of verdict.checks) log(`${check.skipped ? '–' : check.ok ? '✓' : '✗'} ${check.name}\n    ${check.detail}`);
    log(`\n${verdict.passed ? 'PASS — no leak detected.' : 'FAIL — see the ✗ lines above.'}`);

    writeFileSync(
      cfg.reportPath,
      JSON.stringify({ when: new Date().toISOString(), url: cfg.url, mobile: cfg.mobile, cycles: cfg.cycles, tiles: tiles.map((t) => t.title), baseline, samples: cycles, peaks, cap, focusFailures, pageErrors, consoleErrors, consoleErrorTexts: Object.fromEntries(consoleErrorTexts), env, frameCost: heaviest, slowest, verdict }, null, 2),
    );
    log(`report: ${cfg.reportPath}`);
    return verdict.passed ? 0 : 1;
  } finally {
    await browser.close();
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(2);
  },
);
