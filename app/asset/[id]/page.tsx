import { redirect } from 'next/navigation';
import { AppShell } from '@/features/navigation/AppShell';
import { getOrCreateDefaultBoard, listBoardItems } from '@/lib/data/assets';
import { requireUser, UnauthorizedError } from '@/lib/auth';

/* Mirrors app/page.tsx exactly, plus one thing: the board renders with
   `focusItemId` set, which AppShell already knows how to consume (it calls
   openAssetById on mount — see features/board/openAsset.ts). This is the
   Phase 3 deep-linkable focused view the implementation plan calls for;
   until now this file was an exact duplicate of the board page that
   silently ignored its own `id` param. */
export const dynamic = 'force-dynamic';

export default async function AssetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    const user = await requireUser();
    const boardId = await getOrCreateDefaultBoard(user.id);
    const assets = await listBoardItems(boardId);

    // A stale or foreign itemId (deleted asset, someone else's link, a
    // typo) isn't an error — openAssetById already no-ops gracefully on an
    // id it can't find (see its own doc comment), so the board just opens
    // normally without a focused card rather than crashing or 404ing on
    // what's a completely recoverable situation.
    return <AppShell assets={assets} user={user} focusItemId={id} />;
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      redirect('/login');
    }

    console.warn('[asset] failed to load — likely unseeded:', err);
    return <AppShell assets={[]} needsSeed />;
  }
}
