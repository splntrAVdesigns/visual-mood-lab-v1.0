import { desc, eq } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db/client';
import { requireUser } from '@/lib/auth';
import type { Asset } from '@/types/asset';
import type { AssetRow } from '@/lib/db/schema';

/**
 * Read path for assets. Server components call `listAssets` directly rather
 * than fetching their own API route — one less hop, and the board is
 * server-rendered with real data on first paint.
 */

export function toAsset(row: AssetRow): Asset {
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

export async function listAssets(): Promise<Asset[]> {
  const user = await requireUser();
  const db = await getDb();

  const rows = await db
    .select()
    .from(schema.assets)
    .where(eq(schema.assets.ownerId, user.id))
    .orderBy(desc(schema.assets.updatedAt));

  return rows.map(toAsset);
}

export async function getAsset(id: string): Promise<Asset | null> {
  const user = await requireUser();
  const db = await getDb();

  const rows = await db.select().from(schema.assets).where(eq(schema.assets.id, id)).limit(1);
  const row = rows[0];

  // Ownership check belongs here, not in the route — every caller gets it.
  if (!row || row.ownerId !== user.id) return null;
  return toAsset(row);
}
