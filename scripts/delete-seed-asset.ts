import { eq } from 'drizzle-orm';
import { getDb, schema } from '../lib/db/client';

const slug = process.argv[2];
if (!slug) { console.error('Usage: tsx scripts/delete-seed-asset.ts <seedSlug>'); process.exit(1); }

async function main() {
  const db = await getDb();
  const rows = await db.select().from(schema.assets).where(eq(schema.assets.seedSlug, slug));
  if (!rows.length) { console.log(`No asset with seedSlug=${slug}`); return; }

  for (const row of rows) {
    const items = await db.delete(schema.boardItems).where(eq(schema.boardItems.assetId, row.id)).returning();
    console.log(`Deleted ${items.length} board_items for ${row.id} (owner: ${row.ownerId})`);
  }
  const deleted = await db.delete(schema.assets).where(eq(schema.assets.seedSlug, slug)).returning();
  console.log(`Deleted ${deleted.length} asset row(s) with seedSlug=${slug}`);
}
main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
