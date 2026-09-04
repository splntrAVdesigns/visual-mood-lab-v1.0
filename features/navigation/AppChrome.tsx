'use client';

import { useEffect, useState } from 'react';
import { Button, Dialog, Field, Select, Slider, Toggle, useTooltipsEnabled } from '@/components/ui';
import { useBoardStore, useInspectorStore, usePlaybackStore, MAX_LIVE_RENDERERS } from '@/stores';
import type { Asset } from '@/types/asset';
import type { User } from '@/lib/auth';
import { AppHeader } from './AppHeader';
import { NavDrawer } from './NavDrawer';
import { AccountDialog } from './AccountDialog';
import { CommandPalette } from './CommandPalette';
import { OnboardingGuide } from '@/features/onboarding/OnboardingGuide';
import s from '../features.module.css';

interface AppChromeProps {
  assets: Asset[];
  /** True when the database has no tables yet — a fresh, unseeded install. */
  needsSeed?: boolean;
  /** Signed-in user, threaded down to AppHeader/NavDrawer/AccountDialog. */
  user?: User | null;
}

/**
 * The app-wide chrome — header, nav drawer, command palette, settings and
 * account dialogs, footer credit — factored out of AppShell so any route
 * can mount it, not just the board. Board-only concerns (Hero, BoardGrid,
 * the inspector, the focused-asset overlays, deep-link/popstate handling,
 * the Space-bar pause shortcut) stay in AppShell; they don't apply outside
 * a board view.
 *
 * Hydrates the board store synchronously on first render (a lazy useState
 * initializer, not an effect) so SSR and the client agree before anything
 * that reads assets — NavDrawer's counts, the command palette, the search
 * box — renders. Whichever route mounts this owns fetching `assets`; each
 * route already fetches its own `user` the same way (see app/page.tsx and
 * app/about/page.tsx).
 */
export function AppChrome({ assets, needsSeed = false, user = null }: AppChromeProps) {
  const [hydrated] = useState(() => {
    useBoardStore.setState({ assets });
    return true;
  });
  void hydrated;

  const setNavOpen = useInspectorStore((st) => st.setNavOpen);
  const setReducedMotion = usePlaybackStore((st) => st.setReducedMotion);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [setReducedMotion]);

  // '[' toggles the nav drawer everywhere it's mounted. Space (pause all)
  // stays board-only, in AppShell's own listener — nothing to pause here.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      if (e.key === '[') setNavOpen(!useInspectorStore.getState().navOpen);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [setNavOpen]);

  return (
    <>
      <AppHeader onOpenSettings={() => setSettingsOpen(true)} needsSeed={needsSeed} />
      <NavDrawer user={user} onOpenAccount={() => setAccountOpen(true)} />
      <CommandPalette />

      {/*
        Onboarding guide — reads its own open/step state from
        useOnboardingStore, triggered by AppHeader's CTA and NavDrawer's
        "Start here" item. Mounted here (not AppShell) so it's available
        on every route that mounts AppChrome, same reasoning as everything
        else in this file.
      */}
      <OnboardingGuide />

      <FooterCredit />

      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <AccountDialog open={accountOpen} onClose={() => setAccountOpen(false)} />
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
  const masterVolume = usePlaybackStore((st) => st.masterVolume);
  const setMasterVolume = usePlaybackStore((st) => st.setMasterVolume);
  const muted = usePlaybackStore((st) => st.muted);
  const [tooltipsEnabled, setTooltipsEnabled] = useTooltipsEnabled();

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
        label="Volume"
        hint="Master volume for tile sound presets — separate from Audio reactivity above, which is visual modulation driven by an incoming audio signal. This governs sound a tile itself produces."
      >
        <Slider
          label="Volume"
          value={masterVolume}
          min={0}
          max={1}
          step={0.01}
          disabled={muted}
          onChange={setMasterVolume}
        />
      </Field>

      <Field
        label="Reduced motion"
        hint="Follows your system preference. Pauses all animation when on."
      >
        <Toggle label="Reduced motion" checked={reducedMotion} disabled onChange={() => {}} />
      </Field>

      <Field
        label="Tooltips"
        hint="Hover hints on icon buttons across the app. Off by default on every platform."
      >
        <Toggle label="Tooltips" checked={tooltipsEnabled} onChange={setTooltipsEnabled} />
      </Field>

      <div style={{ marginTop: 'var(--space-4)' }}>
        <span className={s.snapshotLabel}>
          Keyboard{' '}
          <span
            style={{
              fontSize: 'var(--step--1)',
              color: 'var(--text-dim)',
              fontWeight: 'normal',
              marginLeft: 'var(--space-2)',
            }}
          >
            Desktop only
          </span>
        </span>
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
