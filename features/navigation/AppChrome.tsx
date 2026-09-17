'use client';

import { useEffect, useState } from 'react';
import { Button, Dialog, Field, Select, Slider, Toggle, useTooltipsEnabled } from '@/components/ui';
import { useBoardStore, useInspectorStore, usePlaybackStore, MAX_LIVE_RENDERERS } from '@/stores';
import type { Asset } from '@/types/asset';
import type { User } from '@/lib/auth';
import {
  getMidiControlSurface,
  requestMidiControlSurfaceAccess,
  type MidiRuntimeSnapshot,
} from '@/lib/control-surface';
import { AppHeader } from './AppHeader';
import { NavDrawer } from './NavDrawer';
import { AccountDialog } from './AccountDialog';
import { CommandPalette } from './CommandPalette';
import { OnboardingGuide } from '@/features/onboarding/OnboardingGuide';
import s from '../features.module.css';
import midiStyles from './MidiSettingsSection.module.css';

interface AppChromeProps {
  assets: Asset[];
  needsSeed?: boolean;
  user?: User | null;
}

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
      <OnboardingGuide />
      <FooterCredit />
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <AccountDialog open={accountOpen} onClose={() => setAccountOpen(false)} />
    </>
  );
}

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
  const [midiSnapshot, setMidiSnapshot] = useState<MidiRuntimeSnapshot | null>(null);

  useEffect(() => {
    if (!open) return;
    const runtime = getMidiControlSurface();
    return runtime.subscribe(setMidiSnapshot);
  }, [open]);

  const enableMidi = async () => {
    setMidiSnapshot(await requestMidiControlSurfaceAccess());
  };

  const connectedMidi = midiSnapshot?.devices.filter((device) => device.state === 'connected') ?? [];
  const midiReady = midiSnapshot?.accessStatus === 'granted';

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

      <section className={midiStyles.section} aria-label="MIDI session">
        <div className={midiStyles.header}>
          <div className={midiStyles.titleWrap}>
            <span className={midiStyles.title}>MIDI</span>
            <span className={midiStyles.sub}>Current browser session and connected inputs.</span>
          </div>
          <span className={midiStyles.status} data-ready={midiReady ? 'true' : undefined}>
            {midiSettingsStatus(midiSnapshot)}
          </span>
        </div>

        {!midiReady && (
          <Button
            variant="outline"
            block
            disabled={midiSnapshot?.accessStatus === 'requesting' || midiSnapshot?.supported === false}
            onClick={() => void enableMidi()}
          >
            {midiSnapshot?.accessStatus === 'requesting' ? 'Enabling MIDI…' : 'Enable MIDI for this session'}
          </Button>
        )}

        {midiReady && connectedMidi.length === 0 && (
          <div className={midiStyles.empty}>
            MIDI is ready. Connect or power on a MIDI device and it will appear here automatically.
          </div>
        )}

        {connectedMidi.length > 0 && (
          <div className={midiStyles.deviceList}>
            {connectedMidi.map((device) => (
              <div key={device.id} className={midiStyles.device}>
                <div className={midiStyles.deviceName}>
                  <strong>{device.name || 'MIDI input'}</strong>
                  <span>{device.manufacturer || 'Manufacturer not reported'}</span>
                </div>
                <span className={midiStyles.deviceMeta}>
                  {device.connection === 'open' ? 'open' : device.connection} · {device.profileMatch.status === 'matched' ? 'mapped' : 'unmapped'}
                </span>
              </div>
            ))}
          </div>
        )}

        {midiSnapshot?.error && <div className={midiStyles.error}>{midiSnapshot.error}</div>}
      </section>

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

function midiSettingsStatus(snapshot: MidiRuntimeSnapshot | null): string {
  if (!snapshot) return 'off';
  switch (snapshot.accessStatus) {
    case 'granted': return 'ready';
    case 'requesting': return 'connecting';
    case 'denied': return 'denied';
    case 'unsupported': return 'unsupported';
    case 'insecure-context': return 'https required';
    case 'error': return 'error';
    default: return 'off';
  }
}
