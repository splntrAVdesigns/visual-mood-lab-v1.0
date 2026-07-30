/**
 * Replaces generated placeholder posters with real renders.
 *
 *   npm run backfill:posters
 *
 * Phase 1 could not do this: shaders and sketches have no poster until a
 * renderer exists. Now that one does, this drives a headless browser over
 * each code asset, captures a frame, and overwrites the poster in place. The
 * URL is already in the right column, so nothing else changes.
 *
 * Requires a browser: `npm i -D playwright && npx playwright install chromium`.
 * Left as an optional dev dependency because CI does not need it.
 */

import { eq, inArray } from 'drizzle-orm';
import { getDb, schema } from '../lib/db/client';
import { getStorage } from '../lib/storage';
import { LOCAL_USER } from '../lib/auth';

/** Minimal structural types so this compiles without Playwright installed. */
interface PlaywrightPage {
  goto(url: string, opts?: { waitUntil?: string }): Promise<unknown>;
  waitForTimeout(ms: number): Promise<void>;
  screenshot(opts?: { type?: string }): Promise<Buffer>;
  close(): Promise<void>;
}
interface PlaywrightBrowser {
  newPage(opts?: { viewport?: { width: number; height: number } }): Promise<PlaywrightPage>;
  close(): Promise<void>;
}

const BASE = process.env.BACKFILL_BASE_URL ?? 'http://localhost:3000';
const SETTLE_MS = Number(process.env.BACKFILL_SETTLE_MS ?? 1500);

async function main(): Promise<void> {
  /* Playwright is an optional dev dependency, so the specifier is held in a
     variable — a literal import would fail typecheck and the production build
     for everyone who has not installed it. */
  const specifier = 'playwright';
  let chromium: { launch: () => Promise<PlaywrightBrowser> };

  try {
    const mod = (await import(specifier)) as { chromium: typeof chromium };
    chromium = mod.chromium;
  } catch {
    console.error(
      'Playwright is not installed.\n' +
        '  npm i -D playwright && npx playwright install chromium\n',
    );
    process.exit(1);
  }

  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.assets)
    .where(inArray(schema.assets.type, ['shader', 'p5']));

  const mine = rows.filter((r) => r.ownerId === LOCAL_USER.id);
  console.log(`\nBackfilling ${mine.length} poster(s) from ${BASE}\n`);

  const browser = await chromium.launch();
  const storage = getStorage();
  let done = 0;
  let failed = 0;

  for (const row of mine) {
    const page = await browser.newPage({ viewport: { width: 640, height: 640 } });

    try {
      await page.goto(`${BASE}/asset/${row.id}?capture=1`, { waitUntil: 'networkidle' });
      // Let the animation reach a representative frame rather than capturing
      // the first, which is often a blank or single-particle state.
      await page.waitForTimeout(SETTLE_MS);

      const shot = await page.screenshot({ type: 'png' });
      const put = await storage.put(`posters/${row.id}.png`, shot, 'image/png');

      await db
        .update(schema.assets)
        .set({ posterUrl: put.url, updatedAt: new Date() })
        .where(eq(schema.assets.id, row.id));

      console.log(`  +  ${row.id.padEnd(20)} ${(shot.byteLength / 1024).toFixed(0)}KB`);
      done++;
    } catch (err) {
      console.error(`  !  ${row.id.padEnd(20)} ${String(err).split('\n')[0]}`);
      failed++;
    } finally {
      await page.close();
    }
  }

  await browser.close();
  console.log(`\n${done} backfilled, ${failed} failed.\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
