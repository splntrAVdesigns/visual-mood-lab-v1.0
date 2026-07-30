import { and, asc, desc, eq } from 'drizzle-orm';
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
    dominantColors: row.dominantColors,
    width: row.width ?? undefined,
    height: row.height ?? undefined,
    durationMs: row.durationMs ?? undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toCard(asset: AssetRow, item: BoardItemRow): Asset {
  const isSnapshot = item.id !== asset.id;
  return {
    ...toAsset(asset),
    itemId: item.id,
    isSnapshot: isSnapshot || undefined,
    // paramsOverride is what makes a snapshot look different from its
    // sibling; falling back to the asset's own params covers the canonical
    // (non-snapshot) card, which has no override row.
    params: item.paramsOverride ?? asset.params,
    // A snapshot shows its own captured frame; the source asset's poster
    // would show the wrong look entirely.
    posterUrl: item.posterOverride ?? asset.posterUrl,
    mod: item.modOverride ?? asset.mod,
  };
}

/** Asset-level listing. Used by ingest and the raw /api/assets route. */
export async function listAssets(): Promise<Asset[]> {
  const user = await requireUser();
  const db = await getDb();

  const rows = await db
    .select()
    .from(schema.assets)
    .where(eq(schema.assets.ownerId, user.id))
    .orderBy(desc(schema.assets.updatedAt));

  return rows.map((r) => ({ ...toAsset(r), itemId: r.id }));
}

export async function getAsset(id: string): Promise<Asset | null> {
  const user = await requireUser();
  const db = await getDb();

  const rows = await db.select().from(schema.assets).where(eq(schema.assets.id, id)).limit(1);
  const row = rows[0];
  if (!row || row.ownerId !== user.id) return null;
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
 */
export async function getOrCreateDefaultBoard(ownerId: string): Promise<string> {
  const db = await getDb();
  const id = `${DEFAULT_BOARD_ID}:${ownerId}`;

  const existing = await db.select().from(schema.boards).where(eq(schema.boards.id, id)).limit(1);
  if (existing.length) return id;

  await db.insert(schema.boards).values({ id, ownerId, title: 'My Board' });
  return id;
}

/**
 * The board, as cards. This is what the grid actually renders — not raw
 * assets, so a snapshot and its source asset both appear as distinct cards.
 */
export async function listBoardItems(boardId: string): Promise<Asset[]> {
  const db = await getDb();

  const rows = await db
    .select({ item: schema.boardItems, asset: schema.assets })
    .from(schema.boardItems)
    .innerJoin(schema.assets, eq(schema.boardItems.assetId, schema.assets.id))
    .where(eq(schema.boardItems.boardId, boardId))
    .orderBy(asc(schema.boardItems.order));

  return rows.map((r) => toCard(r.asset, r.item));
}

export async function getBoardItem(itemId: string): Promise<Asset | null> {
  const db = await getDb();

  const rows = await db
    .select({ item: schema.boardItems, asset: schema.assets })
    .from(schema.boardItems)
    .innerJoin(schema.assets, eq(schema.boardItems.assetId, schema.assets.id))
    .where(eq(schema.boardItems.id, itemId))
    .limit(1);

  const row = rows[0];
  return row ? toCard(row.asset, row.item) : null;
}

/**
 * Ensures a canonical board item exists for an asset.
 *
 * The item's id is deliberately set equal to the asset's id. That is what
 * keeps `/asset/gradient-grid` a real, stable, readable URL for the common
 * case — only snapshots get a generated id, because there's no single
 * "the" URL for one of several saved looks.
 */
export async function ensureCanonicalBoardItem(
  boardId: string,
  assetId: string,
  order: number,
): Promise<void> {
  const db = await getDb();
  const existing = await db
    .select()
    .from(schema.boardItems)
    .where(eq(schema.boardItems.id, assetId))
    .limit(1);

  if (existing.length) return;

  await db.insert(schema.boardItems).values({ id: assetId, boardId, assetId, order });
}

export async function createSnapshot(
  boardId: string,
  assetId: string,
  params: Record<string, unknown>,
  order: number,
): Promise<Asset | null> {
  const db = await getDb();
  const id = crypto.randomUUID();

  await db.insert(schema.boardItems).values({
    id,
    boardId,
    assetId,
    order,
    paramsOverride: params as never,
  });

  return getBoardItem(id);
}

export async function updateSnapshotMod(
  itemId: string,
  mod: Record<string, unknown>,
): Promise<void> {
  const db = await getDb();
  await db
    .update(schema.boardItems)
    .set({ modOverride: mod as never })
    .where(eq(schema.boardItems.id, itemId));
}

export async function setSnapshotPoster(itemId: string, url: string): Promise<void> {
  const db = await getDb();
  await db
    .update(schema.boardItems)
    .set({ posterOverride: url })
    .where(eq(schema.boardItems.id, itemId));
}

export async function updateSnapshotParams(
  itemId: string,
  params: Record<string, unknown>,
): Promise<boolean> {
  const db = await getDb();
  const res = await db
    .update(schema.boardItems)
    .set({ paramsOverride: params as never })
    .where(and(eq(schema.boardItems.id, itemId), eq(schema.boardItems.assetId, schema.boardItems.assetId)));
  void res;
  return true;
}

export async function deleteBoardItem(itemId: string, boardId: string): Promise<boolean> {
  const db = await getDb();
  await db
    .delete(schema.boardItems)
    .where(and(eq(schema.boardItems.id, itemId), eq(schema.boardItems.boardId, boardId)));
  return true;
}
