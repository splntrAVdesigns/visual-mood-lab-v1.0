import { NextResponse } from 'next/server';
import { listAssets } from '@/lib/data/assets';
import { ingestAsset } from '@/lib/ingest/ingest';
import { requireUser } from '@/lib/auth';
import type { AssetType } from '@/types/asset';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const assets = await listAssets();
    return NextResponse.json({ assets });
  } catch (err) {
    console.error('[api/assets]', err);
    return NextResponse.json({ error: 'Failed to list assets' }, { status: 500 });
  }
}

const TYPE_FOR: Record<string, AssetType> = {
  'image/png': 'image',
  'image/jpeg': 'image',
  'image/webp': 'image',
  'image/gif': 'image',
  'image/svg+xml': 'svg',
  'video/webm': 'video',
  'video/mp4': 'video',
};

/**
 * Registers an already-uploaded file as a board asset.
 *
 * The bytes are in storage before this runs — this only creates the row and
 * the board item, through the same ingestAsset path the seed script uses. No
 * second code path means uploaded media behaves identically to seeded media
 * by construction.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body = (await req.json()) as {
      assetId?: string;
      title?: string;
      contentType?: string;
      srcUrl?: string;
    };

    const type = TYPE_FOR[body.contentType ?? ''];
    if (!type || !body.srcUrl) {
      return NextResponse.json({ error: 'Unsupported or incomplete upload' }, { status: 400 });
    }

    const res = await ingestAsset({
      ownerId: user.id,
      type,
      title: body.title?.trim() || 'Untitled',
      tags: ['upload'],
      srcUrl: body.srcUrl,
    });

    const assets = await listAssets();
    const asset = assets.find((a) => a.id === res.id);

    return NextResponse.json({ ok: true, asset });
  } catch (err) {
    console.error('[api/assets POST]', err);
    return NextResponse.json({ error: 'Failed to register asset' }, { status: 500 });
  }
}
