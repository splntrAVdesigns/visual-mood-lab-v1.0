-- Run these one at a time in the Neon SQL editor (or psql) and share the
-- output. This tells us exactly what's in the database right now, instead
-- of guessing further from the outside.

-- 1. Find your account's user id.
SELECT id, email, username FROM "user" ORDER BY "createdAt" DESC;

-- 2. Boards that exist. Look for one with id = 'default:<your id from #1>'.
SELECT id, owner_id, title FROM boards;

-- 3. How many board_items rows exist for YOUR board specifically.
--    Replace <your-user-id> with the id from query #1.
SELECT id, board_id, asset_id, "order"
FROM board_items
WHERE board_id = 'default:<your-user-id>';

-- 4. Sanity check on the library's own board — should be 50 rows, and
--    every id should now look like 'default:library:<assetId>' (the new
--    scheme) rather than a bare assetId, if migration 0005 actually ran.
SELECT count(*) AS total,
       count(*) FILTER (WHERE id LIKE 'default:library:%') AS new_scheme,
       count(*) FILTER (WHERE id = asset_id) AS old_scheme_still_present
FROM board_items
WHERE board_id = 'default:library';

-- 5. Every row in board_items whose asset_id doesn't match any real asset
--    (would explain items existing but never showing up, if the INNER
--    JOIN in listBoardItems has nothing to join against).
SELECT bi.id, bi.board_id, bi.asset_id
FROM board_items bi
LEFT JOIN assets a ON a.id = bi.asset_id
WHERE a.id IS NULL;
