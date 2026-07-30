import { AppShell } from '@/features/navigation/AppShell';
import { listAssets } from '@/lib/data/assets';

/* Read from the database directly rather than fetching our own API route —
   one less hop, and the board server-renders with real data on first paint. */
export const dynamic = 'force-dynamic';

export default async function BoardPage() {
  const assets = await listAssets();
  return <AppShell assets={assets} />;
}
