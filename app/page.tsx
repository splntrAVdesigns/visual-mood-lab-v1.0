import { AppShell } from '@/features/navigation/AppShell';
import { getOrCreateDefaultBoard, listBoardItems } from '@/lib/data/assets';
import { requireUser } from '@/lib/auth';

/* Read from the database directly rather than fetching our own API route —
   one less hop, and the board server-renders with real data on first paint. */
export const dynamic = 'force-dynamic';

export default async function BoardPage() {
  try {
    const user = await requireUser();
    const boardId = await getOrCreateDefaultBoard(user.id);
    const assets = await listBoardItems(boardId);
    return <AppShell assets={assets} />;
  } catch (err) {
    // Almost always means the tables don't exist yet — a fresh install that
    // hasn't been seeded. Rather than crash into the generic error boundary,
    // render the normal shell with an empty board and a way to fix it right
    // in the header, where the person is already looking.
    // warn, not error: Next's dev overlay escalates any server-side
    // console.error into a full-screen crash dialog, which made this handled
    // recovery look like an unhandled failure.
    console.warn('[board] failed to load — likely unseeded:', err);
    return <AppShell assets={[]} needsSeed />;
  }
}
