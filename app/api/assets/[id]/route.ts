import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb, schema } from '@/lib/db/client';
import { getStorage } from '@/lib/storage';
import { requireUser } from '@/lib/auth';
import type { ParamState } from '@/renderers/control-schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PATCH /api/assets/:id
 *   body: { params }        -> persist inspector parameter values
 *
 * POST  /api/assets/:id     (content-type: image/png)
 *   body: raw PNG bytes     -> replace the placeholder poster with a real
 *                              captured frame
 *
 * The poster capture is what finally kills the generated placeholder
 * graphics. Phase 1 could not render a real still because no renderer
 * existed; now one does, so the first time a card animates it snapshots
 * itself and uploads the result. Self-healing, no headless browser, and it
 * replaces the Playwright backfill script entirely.
 */

async function loadOwned(id: string) {
  const user = await requireUser();
  const db = await getDb();
  const rows = await db.select().from(schema.assets).where(eq(schema.assets.id, id)).limit(1);
  const row = rows[0];
  if (!row || row.ownerId !== user.id) return null;
  return { db, row };
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  try {
    const owned = await loadOwned(id);
    if (!owned) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const body = (await req.json()) as { params?: ParamState; mod?: Record<string, unknown> };
    if (!body.params && !body.mod) {
      return NextResponse.json({ error: 'Expected { params } or { mod }' }, { status: 400 });
    }

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (body.params) patch.params = body.params;
    if (body.mod) patch.mod = body.mod;

    await owned.db.update(schema.assets).set(patch).where(eq(schema.assets.id, id));

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[api/assets/:id PATCH]', err);
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  try {
    const owned = await loadOwned(id);
    if (!owned) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const bytes = new Uint8Array(await req.arrayBuffer());

    // A poster smaller than this is almost certainly a blank or single-colour
    // frame captured before the sketch had drawn anything. Rejecting it keeps
    // a black square from permanently replacing a usable placeholder.
    if (bytes.byteLength < 2048) {
      return NextResponse.json({ error: 'Capture too small, ignored' }, { status: 422 });
    }

    const put = await getStorage().put(`posters/${id}.png`, bytes, 'image/png');

    await owned.db
      .update(schema.assets)
      .set({ posterUrl: put.url, updatedAt: new Date() })
      .where(eq(schema.assets.id, id));

    return NextResponse.json({ ok: true, posterUrl: put.url, bytes: bytes.byteLength });
  } catch (err) {
    console.error('[api/assets/:id POST]', err);
    return NextResponse.json({ error: 'Failed to store poster' }, { status: 500 });
  }
}

/**
 * DELETE /api/assets/:id
 *
 * Removes a library upload entirely — the DB row and, best-effort, its
 * backing blob(s). Storage cleanup is deliberately non-fatal: an orphaned
 * blob left behind by a failed delete is a cheap, recoverable cost, but a
 * delete that silently no-ops because storage errored is exactly the "no
 * way to get rid of this" state this route exists to fix.
 */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  try {
    const owned = await loadOwned(id);
    if (!owned) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const storage = getStorage();
    const urls = [owned.row.srcUrl, owned.row.posterUrl].filter(
      (u): u is string => typeof u === 'string' && u.length > 0,
    );

    await Promise.allSettled(
      urls.map(async (url) => {
        try {
          const pathname = new URL(url).pathname.replace(/^\//, '');
          if (pathname) await storage.delete(pathname);
        } catch (err) {
          console.error('[api/assets/:id DELETE] storage cleanup failed for', url, err);
        }
      }),
    );

    await owned.db.delete(schema.assets).where(eq(schema.assets.id, id));

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[api/assets/:id DELETE]', err);
    return NextResponse.json({ error: 'Failed to delete asset' }, { status: 500 });
  }
}
