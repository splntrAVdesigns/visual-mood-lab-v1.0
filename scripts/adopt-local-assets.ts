/**
 * One-off: reassigns assets/boards owned by the 'local' placeholder to a
 * real account.
 *
 * v2 — the first version only updated owner_id columns, which wasn't
 * enough: board ids are deterministic (`default:<ownerId>`), so the old
 * board's id was still literally "default:local" after reassignment.
 * getOrCreateDefaultBoard() looks up boards by that computed id, not by
 * owner_id alone — so it never found the reassigned board and silently
 * created a new empty one instead. This version moves board_items onto a
 * newly-created board with the CORRECT id for the target user, then
 * removes the old orphaned board row.
 *
 *   npx tsx --env-file=.env.local scripts/adopt-local-assets.ts
 *   npx tsx --env-file=.env.local scripts/adopt-local-assets.ts <user-id>
 */

import { getDb, schema } from '../lib/db/client';
import { eq } from 'drizzle-orm';

const OLD_OWNER = 'local';
const OLD_BOARD_ID = `default:${OLD_OWNER}`;

async function main() {
  const db = await getDb();
  const allUsers = await db.select().from(schema.users);

  if (allUsers.length === 0) {
    console.error('No users found yet — log in at least once first, then re-run this.');
    process.exit(1);
  }

  let targetId = process.argv[2];

  if (!targetId) {
    if (allUsers.length === 1) {
      targetId = allUsers[0].id;
    } else {
      console.log('Multiple accounts found — pass the id you want as an argument:\n');
      for (const u of allUsers) console.log(`  ${u.id}  ${u.email}`);
      process.exit(1);
    }
  }

  const newBoardId = `default:${targetId}`;

  const assetsUpdated = await db
    .update(schema.assets)
    .set({ ownerId: targetId })
    .where(eq(schema.assets.ownerId, OLD_OWNER))
    .returning();

  const [oldBoard] = await db
    .select()
    .from(schema.boards)
    .where(eq(schema.boards.id, OLD_BOARD_ID))
    .limit(1);

  if (!oldBoard) {
    console.log(`Reassigned ${assetsUpdated.length} assets. No old board found — nothing to move.`);
    return;
  }

  const [existingTargetBoard] = await db
    .select()
    .from(schema.boards)
    .where(eq(schema.boards.id, newBoardId))
    .limit(1);

  if (!existingTargetBoard) {
    await db.insert(schema.boards).values({
      id: newBoardId,
      ownerId: targetId,
      title: oldBoard.title,
    });
  }

  const itemsMoved = await db
    .update(schema.boardItems)
    .set({ boardId: newBoardId })
    .where(eq(schema.boardItems.boardId, OLD_BOARD_ID))
    .returning();

  await db.delete(schema.boards).where(eq(schema.boards.id, OLD_BOARD_ID));

  console.log(
    `Reassigned ${assetsUpdated.length} assets and moved ${itemsMoved.length} board item(s) ` +
      `from ${OLD_BOARD_ID} to ${newBoardId}.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
