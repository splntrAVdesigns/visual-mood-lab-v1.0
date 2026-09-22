/**
 * The "Latest Update" ticker on the board page (features/updates/UpdateTicker.tsx).
 *
 * Hand-bumped, not derived from a build timestamp or git log — this app's
 * releases are discrete, deliberate revisions, not every deploy (same
 * reasoning as `updatedCopy.date` on the About page). Bump `date` whenever
 * `items` changes below; that's also what makes the banner reappear for
 * anyone who already dismissed a previous update (see
 * lib/updates/dismissal.ts).
 *
 * `date` is ISO (YYYY-MM-DD) — lib/updates/dismissal.ts formats it for
 * display. `items` is a short list of what shipped, in the order they
 * should scroll.
 */
export const latestUpdate = {
  date: '2026-09-21',
  items: ['Floating Sidecar Panels', 'Backdrop-click fix'],
};
