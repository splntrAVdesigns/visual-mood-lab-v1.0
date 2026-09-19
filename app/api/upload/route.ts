import { NextResponse } from 'next/server';
import { getStorage } from '@/lib/storage';
import { requireUser } from '@/lib/auth';
import { checkLimits, uploadSignRateLimit } from '@/lib/auth/rate-limit';

export const dynamic = 'force-dynamic';

const ALLOWED: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/gif': 'gif',
  'video/webm': 'webm',
  'video/mp4': 'mp4',
};

const MAX_BYTES = 200 * 1024 * 1024;

/**
 * Issues a short-lived direct-upload URL. Bytes never pass through this
 * route — a 40MB WebM through a serverless function is a payload-limit
 * failure waiting to happen.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser();

    // Each call mints a signed Blob upload token, so it is the cost lever for
    // storage abuse. Per account, not per IP — see lib/auth/rate-limit.ts.
    if (!(await checkLimits([[uploadSignRateLimit, user.id]]))) {
      return NextResponse.json({ error: 'Too many uploads. Try again shortly.' }, { status: 429 });
    }

    const body = (await req.json()) as {
      filename?: string;
      contentType?: string;
      size?: number;
    };

    const contentType = body.contentType ?? '';
    const ext = ALLOWED[contentType];

    if (!ext) {
      return NextResponse.json(
        { error: `Unsupported content type: ${contentType || 'none'}` },
        { status: 415 },
      );
    }

    // `size` is now REQUIRED, not optionally checked. The previous
    // `typeof body.size === 'number' && body.size > MAX_BYTES` silently
    // skipped this check entirely whenever the client omitted `size` —
    // trivial to do by editing the request body, since it costs the
    // caller nothing to leave the field out. Rejecting a missing/invalid
    // size outright, rather than treating "no size reported" as "assume
    // it's fine", is what actually makes this a limit instead of a
    // suggestion.
    //
    // This is still only a client-reported number, though — it does not
    // by itself guarantee the PUT that follows can't send more bytes than
    // this claims. If lib/storage's createSignedUpload() can pass a
    // maximum-size constraint into the signed token itself (Vercel Blob's
    // `put`/token API supports this), that is the layer where the limit
    // actually becomes enforced rather than merely reported — worth
    // wiring through there too.
    if (typeof body.size !== 'number' || !Number.isFinite(body.size) || body.size <= 0) {
      return NextResponse.json({ error: 'A valid file size is required' }, { status: 400 });
    }
    if (body.size > MAX_BYTES) {
      return NextResponse.json(
        { error: `File exceeds ${Math.round(MAX_BYTES / 1024 / 1024)}MB` },
        { status: 413 },
      );
    }

    const id = crypto.randomUUID();
    const pathname = `${user.id}/${id}.${ext}`;
    const signed = await getStorage().createSignedUpload(pathname, contentType);

    return NextResponse.json({ assetId: id, ...signed });
  } catch (err) {
    console.error('[api/upload]', err);
    return NextResponse.json({ error: 'Failed to create upload' }, { status: 500 });
  }
}
