// scripts/delete-account.ts
//
// Cleanly removes a real user account so they can sign up fresh with the
// same email. This is NOT just `DELETE FROM "user" WHERE email = ...`:
//
//   - accounts / sessions / passwordHistory all reference users.id with
//     `onDelete: 'cascade'` (schema.auth.ts) — deleting the user row alone
//     is enough for those three, they clean up automatically.
//   - verificationTokens does NOT reference users.id at all (it's keyed by
//     identifier=email, per lib/auth/verification.ts's design — see that
//     file's own header comment on why signup-verify and password-reset
//     tokens are namespaced under the same table). A leftover unconsumed
//     token row for this email is NOT cascade-deleted and has to be
//     cleaned up explicitly, or a stale token could be found later by a
//     scan. Not a security issue on its own — verificationTokens' lookup
//     always matches on `identifier AND token` together, so a stray old
//     row can't be exploited by itself — but it's still dead data worth
//     not leaving behind.
//   - boards.ownerId and assets.ownerId (schema.ts) are PLAIN text columns
//     with NO foreign key to users.id at all — this project's user table
//     lives in schema.auth.ts, boards/assets in schema.ts, and the two
//     were never wired together at the DB level. Deleting a user row does
//     NOTHING to their board or any assets they uploaded; those would be
//     silently orphaned (still in the DB, still taking up storage,
//     ownerId pointing at a userId that no longer exists) if this script
//     didn't explicitly walk them down first.
//
// Order matters: boardItems reference boards.id and assets.id with
// `onDelete: 'cascade'` (schema.ts), so deleting the board and any owned
// assets cascades their boardItems automatically — delete boards/assets
// BEFORE the user row, board/asset rows first, dependent boardItems follow
// for free.
//
// Deliberately sequential awaits, not a single `.transaction()` — matches
// this project's other one-off admin scripts (scripts/delete-seed-asset.ts),
// and this is an offline CLI tool a human runs once, not a concurrent
// request path where atomicity under contention actually matters. If it's
// interrupted partway, re-running it is safe: every step below is a
// find-then-delete against whatever's still actually there, so this
// script can simply be run again to finish the job.
//
// USAGE:
//   npx tsx --env-file=.env.local scripts/delete-account.ts <email>
//   npx tsx --env-file=.env.local scripts/delete-account.ts <email> --yes
//
// Without --yes, this only PRINTS what it would delete (dry run) — nothing
// is removed. Pass --yes to actually commit the deletion. Destructive and
// irreversible; there is no undo once --yes runs.

import { eq } from 'drizzle-orm';
import { getDb, schema } from '../lib/db/client';

const email = process.argv[2]?.toLowerCase().trim();
const commit = process.argv.includes('--yes');

if (!email) {
  console.error('Usage: npx tsx --env-file=.env.local scripts/delete-account.ts <email> [--yes]');
  process.exit(1);
}

async function main() {
  const db = await getDb();

  const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
  if (!user) {
    console.log(`No account found for ${email} — nothing to do.`);
    return;
  }

  console.log(`Account: ${user.id}  (${user.email}, username: ${user.username ?? '—'})`);

  const boardId = `default:${user.id}`;
  const [board] = await db.select().from(schema.boards).where(eq(schema.boards.id, boardId)).limit(1);

  const ownedAssets = await db
    .select({ id: schema.assets.id, title: schema.assets.title, type: schema.assets.type })
    .from(schema.assets)
    .where(eq(schema.assets.ownerId, user.id));

  const boardItemCount = board
    ? (
        await db
          .select({ id: schema.boardItems.id })
          .from(schema.boardItems)
          .where(eq(schema.boardItems.boardId, boardId))
      ).length
    : 0;

  console.log(`  board: ${board ? `${boardId} (${boardItemCount} items)` : '— none —'}`);
  console.log(`  owned/uploaded assets: ${ownedAssets.length}`);
  for (const a of ownedAssets) console.log(`    - ${a.type}: ${a.title} (${a.id})`);

  if (!commit) {
    console.log('\nDry run only — nothing deleted. Re-run with --yes to actually delete this account.');
    return;
  }

  if (board) {
    // Cascades boardItems on this board automatically (schema.ts:
    // boardItems.boardId references boards.id, onDelete: 'cascade').
    await db.delete(schema.boards).where(eq(schema.boards.id, boardId));
    console.log(`Deleted board ${boardId} (and its ${boardItemCount} board items).`);
  }

  if (ownedAssets.length > 0) {
    // Cascades any remaining boardItems pointing at these assets
    // (schema.ts: boardItems.assetId references assets.id, onDelete:
    // 'cascade') — covers the edge case of a snapshot referencing one of
    // this user's assets from a DIFFERENT board, which the board deletion
    // above wouldn't have touched.
    await db.delete(schema.assets).where(eq(schema.assets.ownerId, user.id));
    console.log(`Deleted ${ownedAssets.length} owned asset(s).`);
  }

  // Not FK-linked to users.id (see header comment) — clean up explicitly.
  // Covers both an unconsumed signup-verification token (bare email) and
  // an unconsumed password-reset token (`reset:<email>`, see
  // lib/auth/verification.ts's resetIdentifier()).
  const deletedTokens = await db
    .delete(schema.verificationTokens)
    .where(eq(schema.verificationTokens.identifier, email))
    .returning();
  const deletedResetTokens = await db
    .delete(schema.verificationTokens)
    .where(eq(schema.verificationTokens.identifier, `reset:${email}`))
    .returning();
  if (deletedTokens.length || deletedResetTokens.length) {
    console.log(
      `Deleted ${deletedTokens.length + deletedResetTokens.length} leftover verification/reset token(s).`,
    );
  }

  // Cascades accounts, sessions, and passwordHistory (schema.auth.ts —
  // all three reference users.id with onDelete: 'cascade').
  await db.delete(schema.users).where(eq(schema.users.id, user.id));
  console.log(`Deleted user ${user.id} (${email}) and cascaded auth rows.`);

  console.log('\nDone. This email is free to sign up again.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
