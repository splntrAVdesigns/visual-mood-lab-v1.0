import { NextResponse } from 'next/server';
import { createSnapshot, getOrCreateDefaultBoard, listBoardItems } from '@/lib/data/assets';
import { requireUser } from '@/lib/auth';
import { badRequest, isPlainRecord, readJsonBody, unauthorizedResponse } from '@/lib/http/api';
import { validateParamState } from '@/lib/validation/tile-state';

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
    const parsed = await readJsonBody(req);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body;
    if (!isPlainRecord(body) || typeof body.assetId !== 'string' || !body.assetId || !body.params) {
      return badRequest('Expected { assetId, params }');
    }
    const params = validateParamState(body.params);
    if (!params.ok) return badRequest(`Invalid params: ${params.error}`);

    const items = await listBoardItems(boardId, user.id);
    const order = items.length;

    const card = await createSnapshot(boardId, body.assetId, params.value, order, user.id);
    if (!card) return NextResponse.json({ error: 'Failed to create snapshot' }, { status: 500 });

    return NextResponse.json({ ok: true, item: card });
  } catch (err) {
    const denied = unauthorizedResponse(err);
    if (denied) return denied;
    console.error('[api/boards/default/items POST]', err);
    return NextResponse.json({ error: 'Failed to create snapshot' }, { status: 500 });
  }
}
