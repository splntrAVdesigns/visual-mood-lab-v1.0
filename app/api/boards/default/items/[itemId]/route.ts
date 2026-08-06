import { NextResponse } from 'next/server';
import {
  deleteBoardItem,
  getOrCreateDefaultBoard,
  setSnapshotPoster,
  updateSnapshotMod,
  updateSnapshotParams,
} from '@/lib/data/assets';
import { getStorage } from '@/lib/storage';
import { requireUser } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, ctx: { params: Promise<{ itemId: string }> }) {
  const { itemId } = await ctx.params;

  try {
    const user = await requireUser();
    const boardId = await getOrCreateDefaultBoard(user.id);

    const body = (await req.json()) as {
      params?: Record<string, unknown>;
      mod?: Record<string, unknown>;
    };
    if (!body.params && !body.mod) {
      return NextResponse.json({ error: 'Expected { params } or { mod }' }, { status: 400 });
    }

    if (body.params) await updateSnapshotParams(itemId, boardId, body.params);
    if (body.mod) await updateSnapshotMod(itemId, boardId, body.mod);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[api/boards/default/items/:id PATCH]', err);
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
  }
}

/**
 * POST raw PNG bytes -> store as this snapshot's own captured frame.
 * A snapshot's whole purpose is to look different from its source, so it
 * needs its own image rather than inheriting the asset's poster.
 */
export async function POST(req: Request, ctx: { params: Promise<{ itemId: string }> }) {
  const { itemId } = await ctx.params;

  try {
    const user = await requireUser();
    const boardId = await getOrCreateDefaultBoard(user.id);

    const bytes = new Uint8Array(await req.arrayBuffer());
    if (bytes.byteLength < 2048) {
      return NextResponse.json({ error: 'Capture too small, ignored' }, { status: 422 });
    }

    const put = await getStorage().put(`snapshots/${itemId}.png`, bytes, 'image/png');
    await setSnapshotPoster(itemId, boardId, put.url);

    return NextResponse.json({ ok: true, posterUrl: put.url });
  } catch (err) {
    console.error('[api/boards/default/items/:id POST]', err);
    return NextResponse.json({ error: 'Failed to store capture' }, { status: 500 });
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ itemId: string }> }) {
  const { itemId } = await ctx.params;

  try {
    const user = await requireUser();
    const boardId = await getOrCreateDefaultBoard(user.id);
    await deleteBoardItem(itemId, boardId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[api/boards/default/items/:id DELETE]', err);
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
  }
}
