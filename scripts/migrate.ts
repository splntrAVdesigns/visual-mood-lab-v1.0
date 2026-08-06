/**
 * Applies pending migrations only — no seed data touched.
 *
 *   npm run db:migrate
 *
 * Use this for schema-only changes (like adding a column). `npm run seed`
 * still runs the exact same migration step first — this just gives you a
 * way to apply a migration without also running the full seed/ingest pass,
 * which used to be the only option and was easy to miss.
 */

import { isLocalDb } from '../lib/db/client';
import { runMigrations } from '../lib/db/migrate';

async function main(): Promise<void> {
  console.log(`\nDatabase: ${isLocalDb() ? 'PGlite (local)' : 'Postgres (DATABASE_URL)'}`);

  const { ran } = await runMigrations();

  console.log(ran === 0 ? 'Migrations up to date.\n' : `Applied ${ran} migration(s).\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
