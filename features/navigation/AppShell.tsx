'use client';

import { useEffect, useState } from 'react';
import { Button, Dialog, Field, Select, Toggle } from '@/components/ui';
import { BoardGrid } from '@/features/board/BoardGrid';
import { Hero } from '@/features/board/Hero';
import { InspectorDrawer } from '@/features/inspector/InspectorDrawer';
import { FocusedAssetOverlay } from '@/features/board/FocusedAssetOverlay';
import { MobileFocusedView } from '@/features/board/MobileFocusedView';
import { useIsMobile } from '@/lib/hooks/useIsMobile';
import { openAssetById, closeAsset } from '@/features/board/openAsset';
import { CommandPalette } from './CommandPalette';
import { useBoardStore, useInspectorStore, usePlaybackStore, MAX_LIVE_RENDERERS } from '@/stores';
import { getPool } from '@/lib/render/pool';
import type { Asset } from '@/types/asset';
import { AppHeader } from './AppHeader';
import { NavDrawer } from './NavDrawer';
import s from '../features.module.css';

interface AppShellProps {
  assets: Asset[];
  /** True when the database has no tables yet — a fresh, unseeded install. */
  needsSeed?: boolean;
  /** Set by /asset/[id]: open this card as soon as the shell mounts. */
  focusItemId?: string;
}

export function AppShell({ assets, needsSeed = false, focusItemId }: AppShellProps) {
  /* Hydrate synchronously on first render so SSR and the client agree —
     doing this in an effect would paint the empty state first and flash. */
  const [hydrated] = useState(() => {
    useBoardStore.setState({ assets });
    return true;
  });
  void hydrated;

  const inspectorOpen = useInspectorStore((st) => st.open);
  const setNavOpen = useInspectorStore((st) => st.setNavOpen);
  const togglePaused = usePlaybackStore((st) => st.togglePaused);
  const setReducedMotion = usePlaybackStore((st) => st.setReducedMotion);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const isMobile = useIsMobile();

  /*
   * Publish asset id -> poster URL so texture controls can resolve what
   * they point at. Subscribed rather than set once: posters are captured
   * lazily after a card first renders, so this map genuinely fills in over
   * the first few seconds of a session rather than being complete at mount.
   */
  useEffect(() => {
    const publish = (list: Asset[]) => {
      const sources: Record<string, string> = {};
      for (const a of list) if (a.posterUrl) sources[a.id] = a.posterUrl;
      getPool().setTextureSources(sources);
    };

    publish(useBoardStore.getState().assets);
    return useBoardStore.subscribe((state) => publish(state.assets));
  }, []);

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

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [setReducedMotion]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') return; // command palette owns this

      if (e.key === ' ') {
        e.preventDefault();
        togglePaused();
      } else if (e.key === '[') {
        setNavOpen(!useInspectorStore.getState().navOpen);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [togglePaused, setNavOpen]);

  return (
    <>
      <AppHeader onOpenSettings={() => setSettingsOpen(true)} needsSeed={needsSeed} />
      <NavDrawer />
      <CommandPalette />

      <main className={s.main} data-inspector-open={inspectorOpen ? 'true' : 'false'}>
        <Hero />
        <BoardGrid />
      </main>

      {/*
        Two genuinely different compositions, not one squeezed. On desktop
        the inspector is a fixed drawer beside a centred graphic; on mobile
        the controls live inside the focused view itself, in one scrolling
        column beneath a pinned canvas. Rendering the desktop drawer as well
        would put a second, redundant control surface behind the sheet.
      */}
      {isMobile ? (
        <MobileFocusedView />
      ) : (
        <>
          <InspectorDrawer />
          <FocusedAssetOverlay />
        </>
      )}
      <FooterCredit />

      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  );
}

/**
 * Small credit line, fixed to the bottom-left corner.
 *
 * Deliberately NOT positioned relative to the round "N" badge that sits in
 * this same corner during `next dev` — that badge is Next.js's own dev-mode
 * build indicator and does not exist in a production build. Anchoring to it
 * would put this in the wrong place the moment it's deployed.
 */
function FooterCredit() {
  return (
    <a
      href="https://splntr-microtools.com"
      target="_blank"
      rel="noopener noreferrer"
      className={s.footerCredit}
    >
      Made by SPLNTR Micro Tools — splntr-microtools.com
    </a>
  );
}

function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const quality = usePlaybackStore((st) => st.quality);
  const setQuality = usePlaybackStore((st) => st.setQuality);
  const audioEnabled = usePlaybackStore((st) => st.audioEnabled);
  const setAudioEnabled = usePlaybackStore((st) => st.setAudioEnabled);
  const reducedMotion = usePlaybackStore((st) => st.reducedMotion);

  return (
    <Dialog
      open={open}
      title="Settings"
      onClose={onClose}
      footer={
        <Button variant="accent" onClick={onClose}>
          Done
        </Button>
      }
    >
      <Field label="Render quality" hint="Auto drops to preview quality when the pool is full.">
        <Select
          label="Render quality"
          value={quality}
          options={[
            { value: 'auto', label: 'Auto' },
            { value: 'preview', label: 'Preview only' },
            { value: 'full', label: 'Full' },
          ]}
          onChange={(v) => setQuality(v as typeof quality)}
        />
      </Field>

      <Field
        label="Audio reactivity"
        hint="Feeds one shared analyser to every live renderer. Phase 4."
      >
        <Toggle
          label="Audio reactivity"
          checked={audioEnabled}
          disabled
          onChange={setAudioEnabled}
        />
      </Field>

      <Field
        label="Reduced motion"
        hint="Follows your system preference. Pauses all animation when on."
      >
        <Toggle label="Reduced motion" checked={reducedMotion} disabled onChange={() => {}} />
      </Field>

      <div style={{ marginTop: 'var(--space-4)' }}>
        <span className={s.snapshotLabel}>Keyboard</span>
        <div className={s.shortcutList}>
          {[
            ['Space', 'Pause / play all'],
            ['⌘K / Ctrl+K', 'Jump to an asset'],
            ['[', 'Toggle the menu'],
            ['F', 'Fullscreen (while an asset is open)'],
            ['Esc', 'Close the open panel'],
            ['← →', 'Nudge a focused slider (⇧ for coarse)'],
            ['Right-click', 'Modulate a control'],
          ].map(([key, what]) => (
            <div key={key} className={s.shortcutRow}>
              <span>{what}</span>
              <span className={s.shortcutKey}>{key}</span>
            </div>
          ))}
        </div>
      </div>

      <p className={s.notice} style={{ marginTop: 'var(--space-3)' }}>
        <span className={s.noticeStrong}>Live renderer budget:</span> {MAX_LIVE_RENDERERS}.
        Cards beyond this fall back to posters automatically.
      </p>
    </Dialog>
  );
}
