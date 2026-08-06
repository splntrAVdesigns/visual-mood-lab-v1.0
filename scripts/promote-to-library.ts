/**
 * One-off: promotes existing seed assets (currently owned by a real
 * account, from the earlier reassignment script) to the shared library
 * owner instead.
 *
 * Needed because `npm run seed` just failed for all 50 entries: a seed
 * asset's id IS its slug (e.g. "drift-blocks"), and that id is the
 * table's actual primary key — not scoped per owner. Your account
 * already holds rows with those exact ids, so the reseed's attempt to
 * insert a SECOND row with the same id under the library account
 * collided with the primary key for every single one. The fix isn't to
 * insert new rows — it's to relabel the ones that already exist.
 *
 * Also populates the library's own board (default:library) with those
 * same items, since that's what future brand-new accounts clone from
 * (see getOrCreateDefaultBoard in lib/data/assets.ts). Your own board is
 * untouched by this — its board_items already reference these asset ids
 * directly and don't care who owns the underlying asset row.
 *
 *   npx tsx --env-file=.env.local scripts/promote-to-library.ts
 */

import { isNotNull, eq } from 'drizzle-orm';
import { getDb, schema } from '../lib/db/client';
import { ensureCanonicalBoardItem, getOrCreateDefaultBoard, LIBRARY_OWNER_ID } from '../lib/data/assets';

async function main() {
  const db = await getDb();

  const seedAssets = await db
    .select()
    .from(schema.assets)
    .where(isNotNull(schema.assets.seedSlug));

  if (seedAssets.length === 0) {
    console.log('No seed assets found — nothing to promote.');
    return;
  }

  const toPromote = seedAssets.filter((a) => a.ownerId !== LIBRARY_OWNER_ID);

  for (const asset of toPromote) {
    await db
      .update(schema.assets)
      .set({ ownerId: LIBRARY_OWNER_ID })
      .where(eq(schema.assets.id, asset.id));
  }

  const libraryBoardId = await getOrCreateDefaultBoard(LIBRARY_OWNER_ID);
  let order = 0;
  for (const asset of seedAssets) {
    await ensureCanonicalBoardItem(libraryBoardId, asset.id, order++);
  }

  console.log(
    `Promoted ${toPromote.length} seed asset(s) to the shared library. ` +
      `Library board now has ${seedAssets.length} item(s) for future sign-ins to clone from.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
