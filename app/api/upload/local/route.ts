import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Same allowlist as app/api/upload/route.ts — kept in sync manually since
// this file has no import of that one's const (route files aren't meant
// to import each other). If you add a type there, add it here too.
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Local-development upload receiver.
 *
 * With Vercel Blob configured the browser PUTs straight to blob storage and
 * this route is never touched by the app's own client code. That is a
 * statement about which path the UI happens to call, NOT a security
 * boundary — this route is a normal, directly-reachable Next.js API route
 * in every environment, including production, unless something inside it
 * actively refuses to run there. The block below is that refusal.
 *
 * Previously this route had no auth check, no content-type allowlist, and
 * no size limit — only a substring check for "..". If Blob credentials
 * were ever briefly unset in production, it was a live, unauthenticated,
 * unbounded file-write into the public directory for anyone who found it.
 * All four gaps are closed here: hard production block, requireUser(),
 * the same content-type allowlist /api/upload uses, and a size cap
 * enforced via Content-Length before the body is even read.
 */
export async function PUT(req: Request) {
  if (process.env.NODE_ENV === 'production') {
    // No ALLOW_* escape hatch on purpose, unlike ALLOW_SIGNUP or
    // ALLOW_SEED_ROUTE elsewhere in this app — this route only exists to
    // make local dev work without Blob credentials. There is no
    // legitimate reason for it to ever accept a request in production.
    return NextResponse.json({ error: 'Not available' }, { status: 404 });
  }

  try {
    const user = await requireUser();

    const contentType = req.headers.get('content-type') ?? '';
    const ext = ALLOWED[contentType];
    if (!ext) {
      return NextResponse.json(
        { error: `Unsupported content type: ${contentType || 'none'}` },
        { status: 415 },
      );
    }

    const declaredLength = Number(req.headers.get('content-length') ?? NaN);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BYTES) {
      return NextResponse.json(
        { error: `File exceeds ${Math.round(MAX_BYTES / 1024 / 1024)}MB` },
        { status: 413 },
      );
    }

    // pathname still comes from the query param — that's what keeps it
    // matching the id /api/upload already issued as `assetId` — but it is
    // no longer trusted as-is. It must be exactly "<this user's id>/<a
    // uuid>.<ext matching the declared content-type>", checked with a
    // strict regex rather than a substring blocklist. This closes two
    // things at once: writing outside the uploads tree at all (the old
    // "..".includes() check), and writing into a DIFFERENT user's prefix
    // with a same-origin, authenticated request — which the old check
    // didn't even attempt to stop.
    const rawPathname = new URL(req.url).searchParams.get('pathname') ?? '';
    const pathnamePattern = new RegExp(
      `^${escapeRegExp(user.id)}/[0-9a-f-]{36}\\.${ext}$`,
    );
    if (!pathnamePattern.test(rawPathname)) {
      return NextResponse.json({ error: 'Bad pathname' }, { status: 400 });
    }
    const pathname = rawPathname;

    const body = Buffer.from(await req.arrayBuffer());
    if (body.byteLength > MAX_BYTES) {
      return NextResponse.json(
        { error: `File exceeds ${Math.round(MAX_BYTES / 1024 / 1024)}MB` },
        { status: 413 },
      );
    }

    const target = join(process.cwd(), 'public', 'uploads', pathname);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, body);

    return NextResponse.json({ ok: true, url: `/uploads/${pathname}` });
  } catch (err) {
    console.error('[api/upload/local]', err);
    return NextResponse.json({ error: 'Write failed' }, { status: 500 });
  }
}
