-- Renames existing canonical board_items rows from the old id scheme
-- (id = asset_id, unique only per-asset system-wide) to the new one
-- (id = board_id || ':' || asset_id, unique per board+asset).
--
-- Why this is needed: every row seeded before this fix used the bare
-- asset_id as its primary key. That scheme only works if exactly one board
-- ever holds a canonical item for a given asset. It silently broke the
-- moment a second board (a real user's own board, cloned from the shared
-- library) needed a canonical item pointing at the same library asset —
-- the insert either no-op'd against the library's existing row or would
-- have hit a duplicate-key violation. See lib/data/assets.ts's
-- ensureCanonicalBoardItem for the code-level fix this pairs with.
--
-- WHERE id = asset_id is the safe filter: it matches ONLY rows still on
-- the old canonical scheme. Snapshot rows have a random UUID for id (see
-- createSnapshot) that will not coincidentally equal their own asset_id,
-- so they are untouched. Re-running this is a no-op the second time, since
-- renamed rows no longer satisfy id = asset_id.
UPDATE board_items
SET id = board_id || ':' || asset_id
WHERE id = asset_id;
