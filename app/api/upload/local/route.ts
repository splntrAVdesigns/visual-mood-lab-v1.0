import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Local-development upload receiver.
 *
 * With Vercel Blob configured the browser PUTs straight to blob storage and
 * this route is never touched. Without credentials the storage adapter hands
 * back a URL pointing here instead, so the client code path is byte-for-byte
 * identical in both cases — the only thing that changes is where the bytes
 * land.
 */
export async function PUT(req: Request) {
  try {
    const pathname = new URL(req.url).searchParams.get('pathname');
    if (!pathname || pathname.includes('..')) {
      return NextResponse.json({ error: 'Bad pathname' }, { status: 400 });
    }

    const target = join(process.cwd(), 'public', 'uploads', pathname);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, Buffer.from(await req.arrayBuffer()));

    return NextResponse.json({ ok: true, url: `/uploads/${pathname}` });
  } catch (err) {
    console.error('[api/upload/local]', err);
    return NextResponse.json({ error: 'Write failed' }, { status: 500 });
  }
}
