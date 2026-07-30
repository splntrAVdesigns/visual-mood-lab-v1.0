import { drizzle as drizzlePg, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { drizzle as drizzlePglite, type PgliteDatabase } from 'drizzle-orm/pglite';
import * as schema from './schema';

export type Database = PostgresJsDatabase<typeof schema> | PgliteDatabase<typeof schema>;

/**
 * Driver selection by environment.
 *
 *   DATABASE_URL set  -> postgres-js against Neon
 *   otherwise         -> PGlite, an in-process Postgres, persisted to .pglite/
 *
 * PGlite is not a mock or a different dialect — it is Postgres compiled to
 * WASM, running the same migrations. `npm run dev` works with zero
 * credentials, and nothing about the local path diverges from production.
 *
 * -------------------------------------------------------------------------
 * Why the handle lives on globalThis
 * -------------------------------------------------------------------------
 * Next.js bundles route handlers and pages into SEPARATE server chunks, so a
 * plain module-level `let cached` gives each chunk its own copy. With Postgres
 * that merely wastes a connection. With PGlite it is a correctness bug: it is
 * an embedded single-writer database, so two instances on one data directory
 * do not see each other's writes — /api/seed would insert 20 rows and the
 * board would still report `relation "assets" does not exist`.
 *
 * globalThis is shared across every chunk in the process, so there is exactly
 * one handle. It also survives dev hot-reload, which is why this is the
 * conventional pattern for database clients in Next.js regardless of driver.
 *
 * The PROMISE is cached rather than the resolved value, so two concurrent
 * callers during startup cannot each begin opening their own instance.
 */

const GLOBAL_KEY = Symbol.for('visual-mood-lab.db');

interface GlobalWithDb {
  [GLOBAL_KEY]?: Promise<Database>;
}

const globalRef = globalThis as unknown as GlobalWithDb;

export function getDb(): Promise<Database> {
  const existing = globalRef[GLOBAL_KEY];
  if (existing) return existing;

  const opening = openDatabase().catch((err) => {
    // Never cache a failed connection — the next request should retry.
    delete globalRef[GLOBAL_KEY];
    throw err;
  });

  globalRef[GLOBAL_KEY] = opening;
  return opening;
}

async function openDatabase(): Promise<Database> {
  const url = process.env.DATABASE_URL;

  if (url) {
    const { default: postgres } = await import('postgres');
    // Neon pools externally; keep the client-side pool small for serverless.
    const client = postgres(url, { max: 1, prepare: false });
    return drizzlePg(client, { schema });
  }

  /*
   * PGlite needs a real, persistent, writable filesystem — exactly what
   * `./.pglite` is on a normal machine, and exactly what Vercel's serverless
   * functions do not provide. Falling through to it there doesn't fail
   * cleanly: it either throws deep inside PGlite's own startup, or briefly
   * "succeeds" against Vercel's ephemeral /tmp and loses every write the
   * moment that instance recycles. Either way, the person deploying sees a
   * generic Next.js error screen with the real cause buried underneath it.
   * Refusing this combination explicitly turns "forgot to set DATABASE_URL"
   * into an obvious message instead of a mystery.
   */
  if (process.env.VERCEL) {
    throw new Error(
      'DATABASE_URL is not set. This app is running on Vercel, where the local ' +
        'PGlite fallback cannot persist data. Add DATABASE_URL (from Neon or ' +
        'another Postgres provider) in Vercel → Settings → Environment Variables, ' +
        'then redeploy. See .env.example.',
    );
  }

  const { PGlite } = await import('@electric-sql/pglite');
  const client = new PGlite(process.env.PGLITE_DIR ?? './.pglite');
  await client.waitReady;
  return drizzlePglite(client, { schema });
}

export function isLocalDb(): boolean {
  return !process.env.DATABASE_URL;
}

/** Drops the cached handle so the next call reopens. */
export function resetDbHandle(): void {
  delete globalRef[GLOBAL_KEY];
}

export { schema };
