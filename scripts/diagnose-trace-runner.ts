import { eq, and, ilike } from 'drizzle-orm';
import { getDb, isLocalDb, schema } from '../lib/db/client';
import path from 'node:path';

async function main() {
  console.log('cwd:', process.cwd());
  console.log('DATABASE_URL set:', !!process.env.DATABASE_URL);
  console.log('PGLITE_DIR:', process.env.PGLITE_DIR ?? '(default ./.pglite)');
  console.log('Resolved local dir would be:', path.resolve(process.env.PGLITE_DIR ?? './.pglite'));
  console.log('Database backend:', isLocalDb() ? 'PGlite (local)' : 'Postgres (DATABASE_URL)');
  console.log('');

  const db = await getDb();

  const allLibrary = await db.select().from(schema.assets).where(eq(schema.assets.ownerId, 'library'));
  console.log('Total library-owned rows visible from here:', allLibrary.length);

  const exact = allLibrary.find((r) => r.seedSlug === 'trace-runner');
  const fuzzy = allLibrary.filter(
    (r) => (r.seedSlug ?? '').toLowerCase().includes('trace') || r.title.toLowerCase().includes('trace'),
  );

  console.log('Exact seedSlug match:', exact ? exact.id : 'none');
  console.log('Fuzzy matches:', fuzzy.map((r) => ({ id: r.id, seedSlug: r.seedSlug, title: r.title })));
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
