'use client';

import {
  Button,
  IconButton,
  Tooltip,
  CanvasIcon,
  GridIcon,
  MenuIcon,
  PauseIcon,
  PlayIcon,
  SearchIcon,
  SettingsIcon,
  VolumeIcon,
} from '@/components/ui';
import { useBoardStore, useInspectorStore, usePlaybackStore } from '@/stores';
import { useOnboardingStore } from '@/features/onboarding/onboardingStore';
import onboardingStyles from '@/features/onboarding/onboarding.module.css';
import { LiveIndicator } from './LiveIndicator';
import { SeedButton } from './SeedButton';
import s from '../features.module.css';

interface AppHeaderProps {
  onOpenSettings: () => void;
  needsSeed?: boolean;
}

export function AppHeader({ onOpenSettings, needsSeed = false }: AppHeaderProps) {
  const toggleNav = useInspectorStore((st) => st.toggleNav);
  const navOpen = useInspectorStore((st) => st.navOpen);

  const layout = useBoardStore((st) => st.layout);
  const setLayout = useBoardStore((st) => st.setLayout);
  const query = useBoardStore((st) => st.query);
  const setQuery = useBoardStore((st) => st.setQuery);

  const paused = usePlaybackStore((st) => st.paused);
  const togglePaused = usePlaybackStore((st) => st.togglePaused);
  const muted = usePlaybackStore((st) => st.muted);
  const toggleMuted = usePlaybackStore((st) => st.toggleMuted);

  const openGuide = useOnboardingStore((st) => st.open);

  return (
    <header className={s.header}>
      <IconButton
        label={navOpen ? 'Close menu' : 'Open menu'}
        icon={<MenuIcon />}
        onClick={toggleNav}
        active={navOpen}
      />

      <span className={s.wordmark}>
        Visual Mood <span className={s.wordmarkAccent}>Lab</span>
        <span className={s.wordmarkVersion}>1.0</span>
      </span>

      <span className={s.headerSpacer} />

      {needsSeed ? (
        <SeedButton />
      ) : (
        <>
          <label className={s.search}>
            <SearchIcon />
            <input
              className={s.searchInput}
              type="search"
              value={query}
              placeholder="Search assets and tags"
              aria-label="Search assets and tags"
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>

          <span className={s.headerRule} />

          <span className={s.headerGroup}>
            <Tooltip content="Grid">
              <IconButton
                label="Grid layout"
                icon={<GridIcon />}
                active={layout === 'grid'}
                onClick={() => setLayout('grid')}
              />
            </Tooltip>
            <Tooltip content="Canvas — Phase 7">
              <IconButton
                label="Canvas layout"
                icon={<CanvasIcon />}
                active={layout === 'canvas'}
                disabled
                onClick={() => setLayout('canvas')}
              />
            </Tooltip>
          </span>

          <span className={s.headerRule} />

          <LiveIndicator />

          <Tooltip content={paused ? 'Play all' : 'Pause all'} shortcut="Space">
            <IconButton
              label={paused ? 'Play all' : 'Pause all'}
              icon={paused ? <PlayIcon /> : <PauseIcon />}
              onClick={togglePaused}
              active={paused}
            />
          </Tooltip>

          <Tooltip content={muted ? 'Unmute' : 'Mute'}>
            <IconButton
              label={muted ? 'Unmute tile sound' : 'Mute tile sound'}
              icon={<VolumeIcon muted={muted} />}
              onClick={toggleMuted}
              active={muted}
            />
          </Tooltip>

          <span className={s.headerRule} />

          {/*
            Onboarding entry point #2 (drawer item is #1 — see NavDrawer).
            Desktop-only per the design brief; mobile relies on the drawer
            item alone. Plain Button (ghost variant), not an IconButton —
            this one earns its label text since it's a discovery affordance,
            not a repeat-use control like the icons around it. Styled from
            onboarding.module.css, not features.module.css — that file
            wasn't available when this was built, so this avoids editing a
            shared stylesheet blind. Worth moving the class over once
            someone with the file can place it properly.
          */}
          <Button
            variant="ghost"
            onClick={() => openGuide()}
            className={onboardingStyles.headerCtaBtn}
          >
            <span className={onboardingStyles.headerCtaDot} aria-hidden="true" />
            New here? Start here.
          </Button>
        </>
      )}

      <Tooltip content="Settings">
        <IconButton
          label="Settings"
          icon={<SettingsIcon />}
          onClick={onOpenSettings}
          className={s.settingsIcon}
        />
      </Tooltip>
    </header>
  );
}

export { Button };
