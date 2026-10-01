// Deploy the additive schema before the new production code is served.
// Local/preview builds do not migrate the production database.
import { runMigrations } from '../lib/db/migrate';

async function main() {
  if (process.env.VERCEL_ENV !== 'production') {
    console.log('Production migration skipped outside a Vercel production build.');
    return;
  }
  if (!process.env.DATABASE_URL?.trim()) throw new Error('Production build requires DATABASE_URL for migrations.');
  const { ran } = await runMigrations();
  console.log(`Production schema ready: ${ran} pending migration(s) applied.`);
}

main().then(() => process.exit(0)).catch(error => {
  console.error('Production migration failed; deployment build stopped.', error);
  process.exit(1);
});
