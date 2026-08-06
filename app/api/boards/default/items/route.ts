import { NextResponse } from 'next/server';
import { createSnapshot, getOrCreateDefaultBoard, listBoardItems } from '@/lib/data/assets';
import { requireUser } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST { assetId, params } -> a new snapshot card: the same shader or sketch,
 * a different saved look, its own place on the board. This is what turns
 * twelve shaders into sixty board items at near-zero storage cost — the
 * source asset is never duplicated, only the parameter values.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const boardId = await getOrCreateDefaultBoard(user.id);
    const body = (await req.json()) as { assetId?: string; params?: Record<string, unknown> };

    if (!body.assetId || !body.params) {
      return NextResponse.json({ error: 'Expected { assetId, params }' }, { status: 400 });
    }

    const items = await listBoardItems(boardId, user.id);
    const order = items.length;

    const card = await createSnapshot(boardId, body.assetId, body.params, order, user.id);
    if (!card) return NextResponse.json({ error: 'Failed to create snapshot' }, { status: 500 });

    return NextResponse.json({ ok: true, item: card });
  } catch (err) {
    console.error('[api/boards/default/items POST]', err);
    return NextResponse.json({ error: 'Failed to create snapshot' }, { status: 500 });
  }
}
