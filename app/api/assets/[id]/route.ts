import { and, eq, isNull, like, or } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb, schema } from '@/lib/db/client';
import { getStorage } from '@/lib/storage';
import { requireUser } from '@/lib/auth';
import { LIBRARY_OWNER_ID } from '@/lib/data/assets';
import { MAX_POSTER_CAPTURE_BYTES } from '@/lib/validation/asset';
import { posterWriteMode, validatePosterBytes } from '@/lib/validation/poster';
import { checkLimits, posterWriteRateLimit } from '@/lib/auth/rate-limit';
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

/**
 * Same lookup, wider ownership check — used only by the poster capture
 * path below. A real captured frame replacing a generated placeholder
 * benefits every account looking at that library asset, not just whoever
 * happened to be the one with it open when it animated first; params and
 * deletion stay strictly own-only via loadOwned, this is deliberately not
 * the general-purpose write check.
 */
async function loadPosterWritable(id: string) {
  const user = await requireUser();
  const db = await getDb();
  const rows = await db.select().from(schema.assets).where(eq(schema.assets.id, id)).limit(1);
  const row = rows[0];
  if (!row || (row.ownerId !== user.id && row.ownerId !== LIBRARY_OWNER_ID)) return null;
  return { db, row, userId: user.id };
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  try {
    const owned = await loadOwned(id);
    if (!owned) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const body = (await req.json()) as {
      params?: ParamState;
      mod?: Record<string, unknown>;
      sound?: Record<string, unknown>;
      effects?: unknown;
    };
    if (!body.params && !body.mod && !body.sound && !body.effects) {
      return NextResponse.json({ error: 'Expected { params }, { mod }, { sound }, or { effects }' }, { status: 400 });
    }

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (body.params) patch.params = body.params;
    if (body.mod) patch.mod = body.mod;
    if (body.sound) patch.sound = body.sound;
    if (body.effects) patch.effects = body.effects;

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
    // Already correctly ordered (check ownership, THEN touch storage) —
    // this is the pattern app/api/boards/default/items/[itemId]/route.ts's
    // equivalent handler was missing and now matches.
    const owned = await loadPosterWritable(id);
    if (!owned) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // Scripted abuse guard, ahead of any body read or storage write. The
    // ceiling is generous — see posterWriteRateLimit in lib/auth/rate-limit.ts.
    if (!(await checkLimits([[posterWriteRateLimit, owned.userId]]))) {
      return NextResponse.json({ error: 'Too many captures. Try again shortly.' }, { status: 429 });
    }

    // A SHARED (library-owned) poster is writable once: while it is still the
    // generated placeholder. The client already follows this rule (see
    // isPlaceholderPoster in lib/persist/client.ts); this is the server
    // enforcing it, so a hand-built request can't replace a real poster that
    // every account is looking at. Decided BEFORE the body is read or any
    // blob is written.
    const mode = posterWriteMode({
      ownerId: owned.row.ownerId,
      userId: owned.userId,
      libraryOwnerId: LIBRARY_OWNER_ID,
      currentPosterUrl: owned.row.posterUrl,
    });
    if (mode === 'forbidden') return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (mode === 'shared-locked') {
      return NextResponse.json({ error: 'Poster already set' }, { status: 409 });
    }

    const declaredLength = Number(req.headers.get('content-length') ?? NaN);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_POSTER_CAPTURE_BYTES) {
      return NextResponse.json({ error: 'Capture too large' }, { status: 413 });
    }

    const bytes = new Uint8Array(await req.arrayBuffer());

    // Size floor/ceiling (a blank frame captured before the sketch drew
    // anything must not permanently replace a usable placeholder; the
    // ceiling bounds the memory one request can make the server hold —
    // req.arrayBuffer() buffers the whole body regardless) plus: it must
    // actually be a PNG.
    const check = validatePosterBytes(bytes);
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

    const storage = getStorage();

    if (mode === 'own') {
      // Overwriting your own asset's poster in place is fine.
      const put = await storage.put(`posters/${id}.png`, bytes, 'image/png');

      await owned.db
        .update(schema.assets)
        .set({ posterUrl: put.url, updatedAt: new Date() })
        .where(eq(schema.assets.id, id));

      return NextResponse.json({ ok: true, posterUrl: put.url, bytes: bytes.byteLength });
    }

    // mode === 'shared-first-capture'.
    //
    // Two accounts can pass the placeholder check above at the same moment,
    // and Vercel Blob writes here overwrite by pathname. So a shared poster
    // is never written to a fixed path: each attempt gets its own unique
    // blob, and the DB row is claimed with a conditional UPDATE that only
    // matches while the poster is STILL a placeholder. Exactly one attempt
    // wins; every loser's blob is discarded and nothing already published is
    // ever overwritten. (The SQL pattern is deliberately the strict form of
    // isPlaceholderPosterUrl — no query-string leniency.)
    const uniqueName = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
    const put = await storage.put(`posters/${id}.${uniqueName}.png`, bytes, 'image/png');

    await owned.db
      .update(schema.assets)
      .set({ posterUrl: put.url, updatedAt: new Date() })
      .where(
        and(
          eq(schema.assets.id, id),
          or(isNull(schema.assets.posterUrl), like(schema.assets.posterUrl, '%.svg')),
        ),
      );

    // Read the row back rather than trusting a driver-specific affected-row
    // count (this app runs on Neon, postgres-js AND PGlite, whose update
    // results differ). Our blob URL is unique to this attempt, so if the row
    // holds it, this attempt — and only this attempt — won the claim.
    const [after] = await owned.db
      .select()
      .from(schema.assets)
      .where(eq(schema.assets.id, id))
      .limit(1);

    if (after?.posterUrl !== put.url) {
      // Lost the race. Best-effort cleanup — an orphan is cheap, a thrown
      // error here would only turn a clean 409 into a confusing 500.
      await storage.delete(put.pathname).catch(() => undefined);
      return NextResponse.json({ error: 'Poster already set' }, { status: 409 });
    }

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
