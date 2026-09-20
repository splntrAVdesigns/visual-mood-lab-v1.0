import { NextResponse } from 'next/server';
import {
  boardItemBelongsToBoard,
  deleteBoardItem,
  getOrCreateDefaultBoard,
  setSnapshotPoster,
  updateSnapshotMod,
  updateSnapshotParams,
  updateSnapshotSound,
  updateSnapshotEffects,
} from '@/lib/data/assets';
import { getStorage } from '@/lib/storage';
import { requireUser } from '@/lib/auth';
import { MAX_POSTER_CAPTURE_BYTES } from '@/lib/validation/asset';
import { validatePosterBytes } from '@/lib/validation/poster';
import { checkLimits, posterWriteRateLimit } from '@/lib/auth/rate-limit';
import { badRequest, isPlainRecord, readJsonBody, unauthorizedResponse } from '@/lib/http/api';
import {
  validateEffects,
  validateModState,
  validateParamState,
  validateSoundState,
} from '@/lib/validation/tile-state';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, ctx: { params: Promise<{ itemId: string }> }) {
  const { itemId } = await ctx.params;

  try {
    const user = await requireUser();
    const boardId = await getOrCreateDefaultBoard(user.id);

    const parsed = await readJsonBody(req);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body;
    if (!isPlainRecord(body)) return badRequest('Expected a JSON object');

    // Validate everything that was sent BEFORE writing any of it, so a bad
    // field can't leave a half-applied update behind. `null`/absent means
    // "not sent", as before.
    const params = body.params != null ? validateParamState(body.params) : null;
    if (params && !params.ok) return badRequest(`Invalid params: ${params.error}`);
    const mod = body.mod != null ? validateModState(body.mod) : null;
    if (mod && !mod.ok) return badRequest(`Invalid mod: ${mod.error}`);
    const sound = body.sound != null ? validateSoundState(body.sound) : null;
    if (sound && !sound.ok) return badRequest(`Invalid sound: ${sound.error}`);
    const effects = body.effects != null ? validateEffects(body.effects) : null;
    if (effects && !effects.ok) return badRequest(`Invalid effects: ${effects.error}`);

    if (!params && !mod && !sound && !effects) {
      return badRequest('Expected { params }, { mod }, { sound }, or { effects }');
    }

    if (params?.ok) await updateSnapshotParams(itemId, boardId, params.value);
    if (mod?.ok) await updateSnapshotMod(itemId, boardId, mod.value);
    if (sound?.ok) await updateSnapshotSound(itemId, boardId, sound.value);
    if (effects?.ok) await updateSnapshotEffects(itemId, boardId, effects.value);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const denied = unauthorizedResponse(err);
    if (denied) return denied;
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

    // Scripted-abuse guard, ahead of any DB or storage work. Generous — see
    // posterWriteRateLimit in lib/auth/rate-limit.ts.
    if (!(await checkLimits([[posterWriteRateLimit, user.id]]))) {
      return NextResponse.json({ error: 'Too many captures. Try again shortly.' }, { status: 429 });
    }

    const boardId = await getOrCreateDefaultBoard(user.id);

    // Ownership MUST be checked before the storage write below, not after
    // via setSnapshotPoster's boardId-scoped update. storage.put() has no
    // scoping of its own — nothing stops it from writing to
    // `snapshots/<any itemId>.png` for an itemId that names a REAL row on
    // someone else's board. Previously that write happened first and the
    // DB update (correctly scoped) happened second, which meant the write
    // itself was never actually gated: a mismatched boardId just made the
    // follow-up DB update a no-op, while the blob write — and, because
    // VercelBlobStorage.put() always sets allowOverwrite: true, an
    // overwrite of that OTHER item's already-saved poster file — had
    // already happened regardless.
    const owned = await boardItemBelongsToBoard(itemId, boardId);
    if (!owned) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    // Content-Length gives an early rejection without reading the body at
    // all; the byteLength check below is the actual enforcement, since
    // Content-Length can be absent or wrong.
    const declaredLength = Number(req.headers.get('content-length') ?? NaN);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_POSTER_CAPTURE_BYTES) {
      return NextResponse.json({ error: 'Capture too large' }, { status: 413 });
    }

    const bytes = new Uint8Array(await req.arrayBuffer());

    // Same size floor/ceiling as before, now plus: it must really be a PNG
    // (signature + sane IHDR). Previously any 2 KB – 10 MB body was stored
    // and served back as image/png.
    const check = validatePosterBytes(bytes);
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

    const put = await getStorage().put(`snapshots/${itemId}.png`, bytes, 'image/png');
    await setSnapshotPoster(itemId, boardId, put.url);

    return NextResponse.json({ ok: true, posterUrl: put.url });
  } catch (err) {
    const denied = unauthorizedResponse(err);
    if (denied) return denied;
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
    const denied = unauthorizedResponse(err);
    if (denied) return denied;
    console.error('[api/boards/default/items/:id DELETE]', err);
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
  }
}
