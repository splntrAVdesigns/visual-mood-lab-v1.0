'use client';

import { AppChrome } from '@/features/navigation/AppChrome';
import { Hero } from '@/features/board/Hero';
import { StartStrip } from './StartStrip';
import { QuadrantSection } from './QuadrantSection';
import { updatedCopy } from './content';
import type { Asset } from '@/types/asset';
import type { User } from '@/lib/auth';
import s from '../features.module.css';

interface AboutShellProps {
  assets: Asset[];
  needsSeed?: boolean;
  user?: User | null;
}

/**
 * Mirrors AppShell's composition (AppChrome + a <main>) but swaps the
 * board-only middle — BoardGrid, InspectorDrawer, the focused-asset
 * overlays — for the quadrant grid. Same header, same drawer, same Hero:
 * this is meant to feel like a different page inside the same app, not a
 * different app. `data-inspector-open` is always false here — the board's
 * inspector has no meaning on this route, so `.main` never needs the
 * padding-right it reserves for that drawer on desktop.
 */
export function AboutShell({ assets, needsSeed = false, user = null }: AboutShellProps) {
  return (
    <>
      <AppChrome assets={assets} needsSeed={needsSeed} user={user} />

      <main className={s.main} data-inspector-open="false">
        <Hero />
        <StartStrip />
        <QuadrantSection />
      </main>

      <span className={s.updatedMark}>updated: {updatedCopy.date}</span>
    </>
  );
}
