'use client';

import { useEffect, useState } from 'react';
import { Button, Dialog, Field, Select, Toggle } from '@/components/ui';
import { BoardGrid } from '@/features/board/BoardGrid';
import { InspectorDrawer } from '@/features/inspector/InspectorDrawer';
import { FocusedAssetOverlay } from '@/features/board/FocusedAssetOverlay';
import { useBoardStore, useInspectorStore, usePlaybackStore, MAX_LIVE_RENDERERS } from '@/stores';
import type { Asset } from '@/types/asset';
import { AppHeader } from './AppHeader';
import { NavDrawer } from './NavDrawer';
import s from '../features.module.css';

export function AppShell({ assets }: { assets: Asset[] }) {
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

  /* Respect the OS motion preference, and keep respecting it if it changes. */
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [setReducedMotion]);

  /* Global shortcuts. Ignored while typing. */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;

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
      <AppHeader onOpenSettings={() => setSettingsOpen(true)} />
      <NavDrawer />

      <main className={s.main} data-inspector-open={inspectorOpen ? 'true' : 'false'}>
        <BoardGrid />
      </main>

      <InspectorDrawer />
      <FocusedAssetOverlay />

      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Settings
 * ------------------------------------------------------------------ */

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

      <p className={s.notice} style={{ marginTop: 'var(--space-3)' }}>
        <span className={s.noticeStrong}>Live renderer budget:</span> {MAX_LIVE_RENDERERS}.
        Cards beyond this fall back to posters automatically.
      </p>
    </Dialog>
  );
}
