// lib/auth/password-history.ts
//
// Password reuse prevention.
//
// Originally scoped as "block any password used in the last 365 days".
// Adjusted to NIST 800-63B's actual current guidance instead, at the
// owner's direction:
//
//   - NIST 800-63B explicitly recommends AGAINST forced periodic password
//     rotation and arbitrary complexity theatre — both push real users
//     toward predictable, worse passwords (Password1! -> Password2!) with
//     no measurable security benefit.
//   - What it DOES recommend is verifier-side screening of a *new*
//     password against context-specific and previously-breached values.
//     A full breached-password corpus (e.g. an HIBP k-anonymity range
//     query) needs an outbound call to a domain this project's egress
//     allowlist doesn't include, so that's out of scope here — flagged
//     separately, not silently skipped.
//   - A calendar-day reuse window (365 days) adds a time dimension that
//     doesn't actually track risk: a password re-selected after 366 days
//     is exactly as reused as one re-selected after 300. The meaningful,
//     defensible control is bounding by COUNT, not by DATE — "you can't
//     reuse any of your last N passwords, ever" — which is what most
//     production auth systems that implement reuse-prevention actually do
//     (e.g. this is directly analogous to Windows/AD's "enforce password
//     history" setting, which is also count-based, not date-based).
//
// HISTORY_SIZE below is that N. Entries beyond it are pruned on write, so
// the table never carries unbounded history and there's no separate
// expiry job to keep running.

import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { passwordHistory } from "@/lib/db/schema.auth";
import { verifyPassword } from "./hash";

export const HISTORY_SIZE = 5;

/**
 * True if `candidate` matches the account's current password OR any of its
 * last HISTORY_SIZE previous passwords.
 *
 * `currentHash` is checked separately from the history table rather than
 * being folded into it, because the row for "the password that's about to
 * be replaced" is only written to `passwordHistory` by
 * `recordPasswordHistory()` AFTER a successful change — at the moment this
 * function runs, the current hash only exists on `users.passwordHash`.
 */
export async function isPasswordReused(
  userId: string,
  candidate: string,
  currentHash: string | null,
): Promise<boolean> {
  if (currentHash && (await verifyPassword(currentHash, candidate))) {
    return true;
  }

  const db = await getDb();
  const rows = await db
    .select({ passwordHash: passwordHistory.passwordHash })
    .from(passwordHistory)
    .where(eq(passwordHistory.userId, userId))
    .orderBy(desc(passwordHistory.createdAt))
    .limit(HISTORY_SIZE);

  // argon2.verify() has no batch form — this is a bounded (≤ HISTORY_SIZE)
  // sequential loop, acceptable at reset-time latency (a few hundred ms at
  // most), not something that runs on every request.
  for (const row of rows) {
    if (await verifyPassword(row.passwordHash, candidate)) {
      return true;
    }
  }

  return false;
}

/**
 * Records a newly-set password hash into history and prunes anything past
 * HISTORY_SIZE for that user. Call this AFTER the new hash has already been
 * written to `users.passwordHash` — this table is a log of past values,
 * not the source of truth for the current one.
 */
export async function recordPasswordHistory(
  userId: string,
  passwordHash: string,
): Promise<void> {
  const db = await getDb();

  await db.insert(passwordHistory).values({ userId, passwordHash });

  const rows = await db
    .select({ id: passwordHistory.id })
    .from(passwordHistory)
    .where(eq(passwordHistory.userId, userId))
    .orderBy(desc(passwordHistory.createdAt));

  const staleIds = rows.slice(HISTORY_SIZE).map((r) => r.id);
  if (staleIds.length > 0) {
    await db
      .delete(passwordHistory)
      .where(and(eq(passwordHistory.userId, userId), inArray(passwordHistory.id, staleIds)));
  }
}
