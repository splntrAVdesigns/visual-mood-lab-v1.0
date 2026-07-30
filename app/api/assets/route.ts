import { NextResponse } from 'next/server';
import { listAssets } from '@/lib/data/assets';

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
