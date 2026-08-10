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
} from '@/components/ui';
import { useBoardStore, useInspectorStore, usePlaybackStore } from '@/stores';
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
