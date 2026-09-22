/**
 * Pure logic behind the "Latest Update" ticker (features/updates/UpdateTicker.tsx).
 * No React, no DOM — the actual localStorage read/write live in the
 * component; this file only decides, from already-read values, whether the
 * banner shows, and formats the date/items text.
 */

export const UPDATE_DISMISSAL_KEY = 'vml:update-dismissed-v1';

/**
 * The banner shows unless the stored dismissed date is an EXACT match for
 * the current latest update's date. Bumping `latestUpdate.date` in
 * content.ts is therefore what brings the banner back for someone who
 * already dismissed a previous update — the same "hand-bumped date" idea
 * the About page's `updatedCopy.date` already uses, just compared instead
 * of only displayed. No trimming or normalisation: a stored value that
 * isn't a clean exact match (whitespace, wrong case, corrupt data) is
 * treated as "not dismissed" rather than guessed at.
 */
export function shouldShowUpdate(latestDate: string, storedDismissedDate: unknown): boolean {
  if (typeof storedDismissedDate !== 'string' || storedDismissedDate.length === 0) return true;
  return storedDismissedDate !== latestDate;
}

/**
 * "2026-09-21" -> "09/21/2026". Never throws and never produces "NaN/NaN/NaN":
 * anything that isn't a clean YYYY-MM-DD string is returned unchanged.
 */
export function formatUpdateDate(isoDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) return isoDate;
  const [, y, mo, d] = m;
  return `${mo}/${d}/${y}`;
}

/** Joins the update's items for display, dropping any blank entries. */
export function formatUpdateItems(items: readonly string[]): string {
  return items.map((i) => i.trim()).filter((i) => i.length > 0).join('   ·   ');
}
