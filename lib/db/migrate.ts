// lib/db/migrate.ts
//
// Extracted out of scripts/seed.ts, which used to be the *only* way to
// apply a pending migration — running `npm run seed` for a schema-only
// change (no new seed assets) worked, but was confusing enough that it
// caused a real debugging detour once already. `npm run db:migrate` now
// does just this, and `npm run seed` still calls the same function, so
// there is exactly one migration runner, not two that can drift.

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';

import { getDb } from './client';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIGRATIONS_DIR = join(ROOT, 'lib', 'db', 'migrations');

/**
 * Applies pending migrations, tracked in a `_migrations` table.
 *
 * An earlier version swallowed "already exists" errors instead. That works
 * until a migration fails halfway for a real reason and the error text
 * happens to contain those words — then you silently skip it and corrupt the
 * schema. Tracking applied filenames is the only version that stays correct.
 */
export async function runMigrations(): Promise<{ ran: number }> {
  const db = await getDb();

  await db.execute(
    sql.raw(
      'CREATE TABLE IF NOT EXISTS _migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
    ),
  );

  const applied = new Set<string>();
  const rows = (await db.execute(sql.raw('SELECT name FROM _migrations'))) as unknown;
  for (const r of normaliseRows(rows)) {
    if (typeof r.name === 'string') applied.add(r.name);
  }

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  let ran = 0;

  for (const file of files) {
    if (applied.has(file)) continue;

    const body = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    const statements = body
      .split('--> statement-breakpoint')
      .map((x) => x.trim())
      .filter(Boolean);

    for (const stmt of statements) {
      await db.execute(sql.raw(stmt));
    }

    await db.execute(sql.raw(`INSERT INTO _migrations (name) VALUES ('${file}')`));
    ran++;
  }

  return { ran };
}

/** postgres-js and PGlite disagree on result shape; normalise to rows. */
function normaliseRows(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) return result as Array<Record<string, unknown>>;
  if (result && typeof result === 'object' && 'rows' in result) {
    const rows = (result as { rows?: unknown }).rows;
    if (Array.isArray(rows)) return rows as Array<Record<string, unknown>>;
  }
  return [];
}
