import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { NextResponse } from 'next/server';
import { and, isNotNull, notInArray, sql } from 'drizzle-orm';

import { getDb, isLocalDb, schema } from '@/lib/db/client';
import { ingestAsset } from '@/lib/ingest/ingest';
import { LIBRARY_OWNER_ID } from '@/lib/data/assets';
import { describeSeedAuthFailure, evaluateSeedRequest } from '@/lib/security/seed-guard';

/**
 * Seeding over HTTP: POST /api/seed migrates, then loads the starter library.
 *
 * `scripts/seed.ts` does the same thing from the command line, but it runs
 * through tsx, which depends on an esbuild binary that will not load on
 * macOS 11 or older. This route runs inside the Next.js server that is
 * already working, so it sidesteps that toolchain entirely.
 *
 *   POST /api/seed          migrate, then upsert every manifest entry
 *   POST /api/seed?slug=...  update only that manifest entry; no pruning
 *   POST /api/seed?fresh=1  drop the tables first (NOT available in production)
 *
 * POST only. It used to be a GET, which meant a link prefetch, a crawler, or
 * an <img> tag on another site could trigger it — and with ?fresh=1 that
 * dropped the production tables. The decision logic lives in
 * lib/security/seed-guard.ts (tested by `npm run verify:security`):
 *
 *   Development   open, unless SEED_ADMIN_SECRET is set. From a terminal:
 *                   curl -X POST http://localhost:3000/api/seed
 *   Production    requires ALLOW_SEED_ROUTE=1 AND SEED_ADMIN_SECRET (24+ chars)
 *                 AND `Authorization: Bearer <SEED_ADMIN_SECRET>`:
 *                   curl -X POST -H "Authorization: Bearer $SEED_ADMIN_SECRET" \
 *                     https://your-app.example/api/seed
 *                 `fresh` is refused outright.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ManifestEntry {
  slug: string;
  type: 'shader' | 'p5';
  file: string;
  title: string;
  tags: string[];
}

async function migrate(): Promise<number> {
  const db = await getDb();
  const dir = join(process.cwd(), 'lib', 'db', 'migrations');

  await db.execute(
    sql.raw(
      'CREATE TABLE IF NOT EXISTS _migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
    ),
  );

  const result = (await db.execute(sql.raw('SELECT name FROM _migrations'))) as unknown;
  const applied = new Set(
    normaliseRows(result)
      .map((r) => r.name)
      .filter((n): n is string => typeof n === 'string'),
  );

  let ran = 0;

  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    if (applied.has(file)) continue;

    const body = readFileSync(join(dir, file), 'utf8');
    for (const stmt of body.split('--> statement-breakpoint').map((s) => s.trim()).filter(Boolean)) {
      await db.execute(sql.raw(stmt));
    }

    // Parameter-bound rather than sql.raw(`... '${file}' ...`) — see the
    // matching comment in lib/db/migrate.ts. `file` is a repo-local
    // filename here too, never attacker-controlled, but there's no reason
    // to leave string-interpolated SQL lying around when the tagged
    // template costs nothing extra.
    await db.execute(sql`INSERT INTO _migrations (name) VALUES (${file})`);
    ran++;
  }

  return ran;
}

function normaliseRows(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) return result as Array<Record<string, unknown>>;
  if (result && typeof result === 'object' && 'rows' in result) {
    const rows = (result as { rows?: unknown }).rows;
    if (Array.isArray(rows)) return rows as Array<Record<string, unknown>>;
  }
  return [];
}

async function dropAll(): Promise<void> {
  const db = await getDb();
  for (const stmt of [
    'DROP TABLE IF EXISTS board_items CASCADE',
    'DROP TABLE IF EXISTS boards CASCADE',
    'DROP TABLE IF EXISTS assets CASCADE',
    'DROP TYPE IF EXISTS asset_type CASCADE',
    'DROP TABLE IF EXISTS _migrations CASCADE',
  ]) {
    await db.execute(sql.raw(stmt));
  }
}

/** Anything that isn't a POST gets a plain refusal — never runs a seed. */
export async function GET() {
  return NextResponse.json(
    { error: 'Method not allowed. Seeding is POST-only.' },
    { status: 405, headers: { Allow: 'POST' } },
  );
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  const fresh = url.searchParams.get('fresh') === '1';
  const onlySlug = url.searchParams.get('slug');

  const facts = {
    nodeEnv: process.env.NODE_ENV,
    allowSeedRoute: process.env.ALLOW_SEED_ROUTE,
    adminSecret: process.env.SEED_ADMIN_SECRET,
    authorization: req.headers.get('authorization'),
    origin: req.headers.get('origin'),
    host: req.headers.get('x-forwarded-host') ?? req.headers.get('host'),
    fresh,
  };
  const decision = evaluateSeedRequest(facts);
  if (!decision.ok) {
    // Server log only (lengths and flags, never a value) — the caller still gets a bare "Unauthorized".
    if (decision.status === 401) console.warn(`[seed] Unauthorized — ${describeSeedAuthFailure(facts)}`);
    return NextResponse.json(
      { error: decision.error },
      {
        status: decision.status,
        headers: decision.status === 401 ? { 'WWW-Authenticate': 'Bearer' } : undefined,
      },
    );
  }
  if (onlySlug && fresh) {
    return NextResponse.json({ error: 'Choose either a single slug or fresh seeding.' }, { status: 400 });
  }

  const log: string[] = [];

  try {
    if (fresh) {
      await dropAll();
      log.push('Dropped existing tables.');
    }

    const ran = await migrate();
    log.push(ran === 0 ? 'Migrations up to date.' : `Applied ${ran} migration(s).`);

    const seedDir = join(process.cwd(), 'seed');
    const manifest = JSON.parse(readFileSync(join(seedDir, 'manifest.json'), 'utf8')) as {
      assets: ManifestEntry[];
    };
    const entries = onlySlug
      ? manifest.assets.filter((entry) => entry.slug === onlySlug)
      : manifest.assets;
    if (onlySlug && entries.length === 0) {
      return NextResponse.json({ error: 'Unknown seed slug.' }, { status: 404 });
    }

    let created = 0;
    let updated = 0;
    let unchanged = 0;
    const warnings: string[] = [];

    for (const entry of entries) {
      const source = readFileSync(join(seedDir, entry.file), 'utf8');

      const res = await ingestAsset({
        ownerId: LIBRARY_OWNER_ID,
        type: entry.type,
        title: entry.title,
        tags: entry.tags,
        source,
        seedSlug: entry.slug,
      });

      warnings.push(...res.warnings);

      if (res.unchanged) unchanged++;
      else if (res.created) created++;
      else updated++;

      log.push(
        `${res.unchanged ? '=' : res.created ? '+' : '~'} ${entry.slug} — ${
          res.schema?.controls.length ?? 0
        } controls`,
      );
    }

    /*
     * Prune seed assets that are no longer in the manifest.
     *
     * Full seeding upserts by slug but never removed anything, so an asset
     * retired from the manifest (Chromatic Glitch, replaced by Particle
     * Cube several sprints ago) kept its row forever — invisible on the
     * board, but permanently inflating the asset count and leaving stray
     * data behind. Scoped to rows that HAVE a seedSlug, so anything a
     * person uploaded themselves is never touched by this.
     * A single-slug update must leave every other library asset intact.
     */
    const db = await getDb();
    const slugs = manifest.assets.map((a) => a.slug);

    const orphans = onlySlug ? [] : await db
      .select({ id: schema.assets.id, seedSlug: schema.assets.seedSlug })
      .from(schema.assets)
      .where(and(isNotNull(schema.assets.seedSlug), notInArray(schema.assets.seedSlug, slugs)));

    let pruned = 0;
    if (orphans.length > 0) {
      // Board items reference assets, so those go first.
      for (const orphan of orphans) {
        await db.delete(schema.boardItems).where(sql`${schema.boardItems.assetId} = ${orphan.id}`);
        await db.delete(schema.assets).where(sql`${schema.assets.id} = ${orphan.id}`);
        log.push(`- ${orphan.seedSlug} — pruned (no longer in manifest)`);
        pruned++;
      }
    }

    const rows = await db.select().from(schema.assets);

    return NextResponse.json({
      ok: true,
      database: isLocalDb() ? 'PGlite (local)' : 'Postgres',
      created,
      updated,
      unchanged,
      slug: onlySlug ?? null,
      pruned,
      total: rows.length,
      posters: rows.filter((r) => r.posterUrl).length,
      schemas: rows.filter((r) => r.schema).length,
      warnings,
      log,
      next: 'Seeding complete — open http://localhost:3000 to view the board.',
    });
  } catch (err) {
    console.error('[api/seed]', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err), log },
      { status: 500 },
    );
  }
}
