import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AboutShell } from '@/features/about/AboutShell';
import { getOrCreateDefaultBoard, listBoardItems } from '@/lib/data/assets';
import { requireUser, UnauthorizedError } from '@/lib/auth';

export const metadata: Metadata = {
  title: 'About — Visual Mood Lab',
};

/* Same fetch as app/page.tsx (board): the drawer and header on this route
   need real asset counts and a real signed-in user, not an empty shell —
   otherwise "All assets 0" and no account row would be the first thing
   About shows, which is worse than just fetching it here too. */
export const dynamic = 'force-dynamic';

export default async function AboutPage() {
  try {
    const user = await requireUser();
    const boardId = await getOrCreateDefaultBoard(user.id);
    const assets = await listBoardItems(boardId, user.id);
    return <AboutShell assets={assets} user={user} />;
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      redirect('/login');
    }
    console.warn('[about] failed to load assets — likely unseeded:', err);
    return <AboutShell assets={[]} needsSeed />;
  }
}
