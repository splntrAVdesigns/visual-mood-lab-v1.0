import { and, asc, desc, eq, or } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db/client';
import { requireUser } from '@/lib/auth';
import type { Asset } from '@/types/asset';
import type { AssetRow, BoardItemRow } from '@/lib/db/schema';

/**
 * Read path for the board.
 *
 * Two layers, on purpose. `assets` holds the source of truth for a shader or
 * sketch — schema, code, poster. `boardItems` is what actually appears on
 * the board: one row per visible card. Most assets have exactly one item,
 * created automatically at ingest, so in the common case this is invisible.
 * The split exists entirely for snapshots — `paramsOverride` on a second
 * item pointing at the same asset is what turns one shader into several
 * distinct-looking cards without duplicating the shader itself.
 */

/**
 * The 50 seed assets belong to this fixed account rather than any real
 * person — a shared, read-visible library every signed-in account can see
 * and build on. Real accounts never own library rows; they get their own
 * personal board pre-populated with a copy of the library's items on first
 * login (see getOrCreateDefaultBoard), and anything they upload or
 * customize from there stays privately theirs.
 */
export const LIBRARY_OWNER_ID = 'library';

export function toAsset(row: AssetRow): Omit<Asset, 'itemId' | 'isSnapshot'> {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    tags: row.tags,
    srcUrl: row.srcUrl ?? undefined,
    source: row.source ?? undefined,
    posterUrl: row.posterUrl,
    schema: row.schema ?? undefined,
    params: row.params,
    mod: row.mod,
    sound: row.sound,
    dominantColors: row.dominantColors,
    width: row.width ?? undefined,
    height: row.height ?? undefined,
    durationMs: row.durationMs ?? undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toCard(asset: AssetRow, item: BoardItemRow, viewerId: string): Asset {
  // Canonical items get a deterministic id (see ensureCanonicalBoardItem);
  // a snapshot's id is always a random UUID (see createSnapshot) and can
  // never collide with that deterministic form by construction. This has
  // to be recomputed rather than compared to `asset.id` directly — the id
  // scheme is `${boardId}:${assetId}` precisely because the same assetId
  // can have a canonical item on more than one board (library + every
  // user's own board), so there's no single asset-id string to compare
  // against anymore.
  const isSnapshot = item.id !== `${item.boardId}:${asset.id}`;
  return {
    ...toAsset(asset),
    itemId: item.id,
    isSnapshot: isSnapshot || undefined,
    isOwned: asset.ownerId === viewerId,
    // paramsOverride is what makes a snapshot look different from its
    // sibling; falling back to the asset's own params covers the canonical
    // (non-snapshot) card, which has no override row.
    params: item.paramsOverride ?? asset.params,
    // A snapshot shows its own captured frame; the source asset's poster
    // would show the wrong look entirely.
    posterUrl: item.posterOverride ?? asset.posterUrl,
    mod: item.modOverride ?? asset.mod,
    sound: item.soundOverride ?? asset.sound,
  };
}

/** Asset-level listing. Used by ingest and the raw /api/assets route.
    Includes the shared library alongside the signed-in user's own assets —
    the library is visible to everyone, not just its nominal owner. */
export async function listAssets(): Promise<Asset[]> {
  const user = await requireUser();
  const db = await getDb();

  const rows = await db
    .select()
    .from(schema.assets)
    .where(or(eq(schema.assets.ownerId, user.id), eq(schema.assets.ownerId, LIBRARY_OWNER_ID)))
    .orderBy(desc(schema.assets.updatedAt));

  return rows.map((r) => ({ ...toAsset(r), itemId: r.id }));
}

export async function getAsset(id: string): Promise<Asset | null> {
  const user = await requireUser();
  const db = await getDb();

  const rows = await db.select().from(schema.assets).where(eq(schema.assets.id, id)).limit(1);
  const row = rows[0];
  // Same rule as listAssets: your own assets, or anything in the shared
  // library. Anything else stays invisible regardless of who's asking.
  if (!row || (row.ownerId !== user.id && row.ownerId !== LIBRARY_OWNER_ID)) return null;
  return { ...toAsset(row), itemId: row.id };
}

/* ------------------------------------------------------------------ *
 * Boards
 * ------------------------------------------------------------------ */

const DEFAULT_BOARD_ID = 'default';

/**
 * Every person has exactly one board for now — multi-board is real product
 * surface (§14 backlog) that the schema already supports but the UI does
 * not expose yet. This just guarantees the row exists.
 *
 * First creation for a real account also clones in every item from the
 * shared library's own board, so a brand-new sign-in immediately has the
 * full 50-asset starter set to look at and tune — not an empty grid. From
 * that point on it's a normal, independent board: rearranging, snapshotting,
 * or removing a library item here never touches the library or anyone
 * else's board.
 */
export async function getOrCreateDefaultBoard(ownerId: string): Promise<string> {
  const db = await getDb();
  const id = `${DEFAULT_BOARD_ID}:${ownerId}`;

  const existing = await db.select().from(schema.boards).where(eq(schema.boards.id, id)).limit(1);

  if (!existing.length) {
    await db.insert(schema.boards).values({ id, ownerId, title: 'My Board' });
  }

  // Backfill compares the library's item set against this board's item
  // set and inserts whatever's missing, rather than only checking "does
  // this board have zero items". A real account's board can end up
  // created-but-empty if sign-in ever happened before the library was
  // seeded (which is exactly what happened in dev: the auth bug got fixed
  // and tested against accounts that had already had
  // `getOrCreateDefaultBoard` called against them pre-seed) — the diff
  // approach still covers that case (empty board == everything missing)
  // but also covers a board that already has some items and the library
  // later gains more (a seed batch after the account already existed).
  // Skipped for the library's own board, same as before — it can't clone
  // into itself before it has any items.
  if (ownerId !== LIBRARY_OWNER_ID) {
    const libraryBoardId = `${DEFAULT_BOARD_ID}:${LIBRARY_OWNER_ID}`;
    const libraryItems = await db
      .select()
      .from(schema.boardItems)
      .where(eq(schema.boardItems.boardId, libraryBoardId))
      .orderBy(asc(schema.boardItems.order));

    const currentItems = await db
      .select({ assetId: schema.boardItems.assetId })
      .from(schema.boardItems)
      .where(eq(schema.boardItems.boardId, id));
    const ownedAssetIds = new Set(currentItems.map((i) => i.assetId));

    let nextOrder = currentItems.length;
    for (const item of libraryItems) {
      if (ownedAssetIds.has(item.assetId)) continue;
      await ensureCanonicalBoardItem(id, item.assetId, nextOrder++);
    }
  }

  return id;
}

/**
 * The board, as cards. This is what the grid actually renders — not raw
 * assets, so a snapshot and its source asset both appear as distinct cards.
 *
 * NOTE: this trusts `boardId` completely — it renders whatever board items
 * exist for that id, with no check that `boardId` belongs to `viewerId`.
 * That's intentional in isolation (the library's board is meant to be
 * readable by everyone), but it means the CALLER is responsible for never
 * passing a client-supplied boardId straight through — `boardId` must
 * always be resolved server-side (getOrCreateDefaultBoard(user.id), or the
 * library's own fixed id), never taken from a request body/URL param
 * as-is. Confirmed: app/api/boards/default/items/route.ts and
 * .../[itemId]/route.ts both do this correctly — boardId is always
 * `getOrCreateDefaultBoard(user.id)`, never read off the request.
 */
export async function listBoardItems(boardId: string, viewerId: string): Promise<Asset[]> {
  const db = await getDb();

  const rows = await db
    .select({ item: schema.boardItems, asset: schema.assets })
    .from(schema.boardItems)
    .innerJoin(schema.assets, eq(schema.boardItems.assetId, schema.assets.id))
    .where(eq(schema.boardItems.boardId, boardId))
    .orderBy(asc(schema.boardItems.order));

  return rows.map((r) => toCard(r.asset, r.item, viewerId));
}

export async function getBoardItem(itemId: string, viewerId: string): Promise<Asset | null> {
  const db = await getDb();

  const rows = await db
    .select({ item: schema.boardItems, asset: schema.assets })
    .from(schema.boardItems)
    .innerJoin(schema.assets, eq(schema.boardItems.assetId, schema.assets.id))
    .where(eq(schema.boardItems.id, itemId))
    .limit(1);

  const row = rows[0];
  return row ? toCard(row.asset, row.item, viewerId) : null;
}

/**
 * True only if `itemId` names an actual row on this exact board.
 *
 * Exists specifically to gate an external side effect — a storage write —
 * that has to happen BEFORE any DB update, not after. The boardId-scoped
 * updates elsewhere in this file (updateSnapshotParams, deleteBoardItem,
 * etc.) are already safe on their own: a mismatched boardId just matches
 * zero rows, no separate existence check needed. A storage write has no
 * such built-in scoping — nothing about calling storage.put() with an
 * arbitrary key fails just because that key doesn't correspond to a real,
 * owned row. See the call site in
 * app/api/boards/default/items/[itemId]/route.ts's POST handler for why
 * this matters concretely.
 */
export async function boardItemBelongsToBoard(itemId: string, boardId: string): Promise<boolean> {
  const db = await getDb();
  const rows = await db
    .select({ id: schema.boardItems.id })
    .from(schema.boardItems)
    .where(and(eq(schema.boardItems.id, itemId), eq(schema.boardItems.boardId, boardId)))
    .limit(1);
  return rows.length > 0;
}

/**
 * Ensures a canonical board item exists for an asset, on a specific board.
 *
 * The item's id is a deterministic `${boardId}:${assetId}` composite, NOT
 * just `assetId` — that was the original design (see the plan doc's own
 * §6), on the theory that one asset has exactly one canonical board item
 * system-wide, giving a clean `/asset/<assetId>` URL. That assumption broke
 * the moment real accounts got their own personal board pre-populated with
 * a COPY of the shared library's items (getOrCreateDefaultBoard, above):
 * the same library assetId now legitimately needs a canonical item on the
 * library's own board AND on every user's board simultaneously. With
 * `id = assetId` as a bare primary key, the second board's insert either
 * silently no-oped (this existence check matched the library's row and
 * assumed the user's copy already existed) or would have thrown a duplicate
 * key violation if it ever got past the check — which is exactly why every
 * real account's board rendered zero items despite 50 assets existing.
 *
 * Board-scoping the id fixes both failure modes at once and stays fully
 * idempotent (same boardId + assetId always produces the same id, so
 * calling this twice for the same pair is still a safe no-op). The
 * `/asset/<assetId>` clean-URL property this replaces was aspirational
 * only — Phase 3's deep-linkable focused view hasn't been built yet
 * (`app/asset/[id]/page.tsx` doesn't even read its own `id` param today),
 * so nothing live depends on that exact string yet.
 */
export async function ensureCanonicalBoardItem(
  boardId: string,
  assetId: string,
  order: number,
): Promise<void> {
  const db = await getDb();
  const id = `${boardId}:${assetId}`;
  const existing = await db
    .select()
    .from(schema.boardItems)
    .where(eq(schema.boardItems.id, id))
    .limit(1);

  if (existing.length) return;

  await db.insert(schema.boardItems).values({ id, boardId, assetId, order });
}

export async function createSnapshot(
  boardId: string,
  assetId: string,
  params: Record<string, unknown>,
  order: number,
  viewerId: string,
): Promise<Asset | null> {
  // listBoardItems/getBoardItem render whatever asset a board item points
  // at with no per-item visibility check of their own — that check is
  // meant to happen exactly once, at creation, which is here. Without it,
  // a caller who obtained another private asset's id by any means (assetId
  // is a random UUID, not guessable in practice, but "not guessable"
  // shouldn't be the only thing standing between a private asset and
  // someone who isn't its owner) could pin a snapshot to it on their own
  // board and have that asset's title, source, srcUrl, schema, and params
  // rendered back to them indefinitely. getAsset() already enforces the
  // real rule (own asset, or the shared library) — reusing it here rather
  // than re-deriving the same check a second way.
  const target = await getAsset(assetId);
  if (!target) return null;

  const db = await getDb();
  const id = crypto.randomUUID();

  await db.insert(schema.boardItems).values({
    id,
    boardId,
    assetId,
    order,
    paramsOverride: params as never,
  });

  return getBoardItem(id, viewerId);
}

export async function updateSnapshotMod(
  itemId: string,
  boardId: string,
  mod: Record<string, unknown>,
): Promise<void> {
  const db = await getDb();
  await db
    .update(schema.boardItems)
    .set({ modOverride: mod as never })
    .where(and(eq(schema.boardItems.id, itemId), eq(schema.boardItems.boardId, boardId)));
}

export async function updateSnapshotSound(
  itemId: string,
  boardId: string,
  sound: Record<string, unknown>,
): Promise<void> {
  const db = await getDb();
  await db
    .update(schema.boardItems)
    .set({ soundOverride: sound as never })
    .where(and(eq(schema.boardItems.id, itemId), eq(schema.boardItems.boardId, boardId)));
}

export async function setSnapshotPoster(itemId: string, boardId: string, url: string): Promise<void> {
  const db = await getDb();
  await db
    .update(schema.boardItems)
    .set({ posterOverride: url })
    .where(and(eq(schema.boardItems.id, itemId), eq(schema.boardItems.boardId, boardId)));
}

/**
 * `itemId` alone was never enough here — it identifies a row, but not
 * whether the caller is allowed to touch it. `itemId` is not a secret; it
 * appears directly in URLs (`/asset/<itemId>`), so any signed-in user who
 * saw or guessed one could previously PATCH another account's board item.
 * Scoping every write to the caller's own `boardId` (same pattern
 * deleteBoardItem, below, already used correctly) closes that off — a
 * mismatched boardId now just matches zero rows instead of silently
 * succeeding against someone else's data.
 */
export async function updateSnapshotParams(
  itemId: string,
  boardId: string,
  params: Record<string, unknown>,
): Promise<boolean> {
  const db = await getDb();
  await db
    .update(schema.boardItems)
    .set({ paramsOverride: params as never })
    .where(and(eq(schema.boardItems.id, itemId), eq(schema.boardItems.boardId, boardId)));
  return true;
}

export async function deleteBoardItem(itemId: string, boardId: string): Promise<boolean> {
  const db = await getDb();
  await db
    .delete(schema.boardItems)
    .where(and(eq(schema.boardItems.id, itemId), eq(schema.boardItems.boardId, boardId)));
  return true;
}
