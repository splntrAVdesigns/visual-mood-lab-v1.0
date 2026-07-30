import { NextResponse } from 'next/server';
import { getStorage } from '@/lib/storage';
import { requireUser } from '@/lib/auth';

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

    if (typeof body.size === 'number' && body.size > MAX_BYTES) {
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
