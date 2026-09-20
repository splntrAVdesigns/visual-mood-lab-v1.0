'use client';

import { useEffect } from 'react';
import { BoardGrid } from '@/features/board/BoardGrid';
import { Hero } from '@/features/board/Hero';
import { InspectorDrawer } from '@/features/inspector/InspectorDrawer';
import { FocusedAssetOverlay } from '@/features/board/FocusedAssetOverlay';
import { MobileFocusedView } from '@/features/board/MobileFocusedView';
import { openAssetById, closeAsset } from '@/features/board/openAsset';
import { useInspectorStore, usePlaybackStore } from '@/stores';
import type { Asset } from '@/types/asset';
import type { User } from '@/lib/auth';
import { attachAudioLifecycleListeners } from '@/lib/sound/context';
import { attachTrackVisibilityLifecycle } from '@/lib/sound/track';
import { attachPersistLifecycle } from '@/lib/persist/client';
import { useRollShortcuts } from '@/features/inspector/useRollShortcuts';
import { AppChrome } from './AppChrome';
import { SaveStatus } from './SaveStatus';
import s from '../features.module.css';

interface AppShellProps {
  assets: Asset[];
  /** True when the database has no tables yet — a fresh, unseeded install. */
  needsSeed?: boolean;
  /** Set by /asset/[id]: open this card as soon as the shell mounts. */
  focusItemId?: string;
  /** Signed-in user, threaded down to AppHeader/AccountMenu/AccountDialog. */
  user?: User | null;
}

export function AppShell({ assets, needsSeed = false, focusItemId, user = null }: AppShellProps) {
  const inspectorOpen = useInspectorStore((st) => st.open);
  const togglePaused = usePlaybackStore((st) => st.togglePaused);

  /* Open the deep-linked card once, on mount. Not pushUrl — the URL that got
     us here is already correct. */
  useEffect(() => {
    if (focusItemId) openAssetById(focusItemId, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusItemId]);

  /* Keep the URL and the open card in sync with browser back/forward. This
     is what makes the deep link a real link rather than a one-way door —
     without it, pressing Back after opening a card leaves the overlay open
     with a stale URL underneath it. */
  useEffect(() => {
    const onPopState = () => {
      const match = /^\/asset\/([^/]+)/.exec(window.location.pathname);
      if (match) openAssetById(match[1], false);
      else closeAsset(false);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // Board-only shortcut — AppChrome owns '[' (nav toggle) for every route;
  // Space (pause all live renderers) only means something where renderers
  // exist, so it stays local to the board shell.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') return; // command palette owns this
      if (e.key === ' ') {
        e.preventDefault();
        togglePaused();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [togglePaused]);

  // Mobile audio bugfix (2026-09) — resume the shared AudioContext when
  // the tab/app becomes visible again. AppShell is the one component
  // that's always mounted for the lifetime of the app (same reasoning as
  // the popstate/keydown listeners above), which makes it the right
  // place for an app-wide lifecycle concern like this one rather than
  // something that lives inside any single card or panel. See
  // lib/sound/context.ts's attachAudioLifecycleListeners() doc for the
  // full mechanism and why this alone doesn't fully solve it — meter.ts/
  // track.ts/mic.ts's isAudioUnlocked() gate is the other half.
  useEffect(() => {
    return attachAudioLifecycleListeners();
  }, []);

  // Mobile audio bugfix (2026-09), part 2 — auto-pause every playing
  // track the moment the tab/app is hidden, so the Play/Pause icon
  // always reflects reality on return instead of staying stuck on
  // Pause for a track that's actually gone silent. See
  // lib/sound/track.ts's attachTrackVisibilityLifecycle() doc for the
  // full reasoning — kept as its own effect/listener pair rather than
  // folded into the one above, since this owns track-level playback
  // state, not the shared context itself.
  useEffect(() => {
    return attachTrackVisibilityLifecycle();
  }, []);

  // Save-queue lifecycle. Every tile edit is debounced ~500ms before it is
  // sent; closing the tab, refreshing, or a mobile OS backgrounding-then-
  // killing the app inside that window used to drop the edit silently. This
  // flushes everything still pending on pagehide / tab-hidden, and retries
  // what failed once the network or tab is back. See lib/persist/client.ts.
  useEffect(() => {
    return attachPersistLifecycle();
  }, []);

  // R / M / ⌘Z for Roll, Mutate and Undo. Mounted once, here, because the
  // desktop drawer and the mobile sheet both render a Roll bar.
  useRollShortcuts();

  return (
    <>
      <AppChrome assets={assets} needsSeed={needsSeed} user={user} />

      <main className={s.main} data-inspector-open={inspectorOpen ? 'true' : 'false'}>
        <Hero />
        <BoardGrid />
      </main>

      <InspectorDrawer />
      <SaveStatus />
      {/*
        Two different compositions for the same "asset is focused" state,
        picked by a CSS breakpoint (see .focusScrim / .mobileFocus in
        features.module.css) rather than a JS viewport check — no
        hydration-mismatch risk, consistent with how the rest of the
        board's mobile layout already switches (.wordmark, .accountMenu,
        etc). MobileFocusedView was fully built but never mounted anywhere
        before this; FocusedAssetOverlay was covering every width, including
        the ones its own two-panel layout doesn't fit.
      */}
      <FocusedAssetOverlay />
      <MobileFocusedView />
    </>
  );
}
