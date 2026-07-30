import { notFound } from 'next/navigation';
import { AppShell } from '@/features/navigation/AppShell';
import { getBoardItem, getOrCreateDefaultBoard, listBoardItems } from '@/lib/data/assets';
import { requireUser } from '@/lib/auth';
import type { Asset } from '@/types/asset';

export const dynamic = 'force-dynamic';

/**
 * Deep-linkable focused view.
 *
 * Renders the exact same board as `/`, plus tells the shell which card to
 * open on mount. This is what makes an asset — including a specific
 * parameter snapshot — a URL you can copy, bookmark, or send someone rather
 * than a piece of client-only state that evaporates on reload.
 */
export default async function AssetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let data: { assets: Asset[]; focused: Asset | null } | null = null;

  try {
    const user = await requireUser();
    const boardId = await getOrCreateDefaultBoard(user.id);
    const [assets, focused] = await Promise.all([listBoardItems(boardId), getBoardItem(id)]);
    data = { assets, focused };
  } catch (err) {
    // Almost always an unseeded database. notFound() is deliberately NOT
    // reachable from inside this catch: Next's notFound() works by throwing
    // a recognized signal, and a broad catch here would swallow that throw
    // and turn a real 404 into a 200 showing the seed prompt instead. Data
    // failure and "this asset doesn't exist" have to stay two different
    // outcomes even though both start from a thrown error.
    console.warn('[asset page] failed to load — likely unseeded:', err);
    return <AppShell assets={[]} needsSeed />;
  }

  if (!data.focused) notFound();

  return <AppShell assets={data.assets} focusItemId={id} />;
}
