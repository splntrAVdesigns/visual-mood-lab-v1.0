'use client';

import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { UploadDialog } from '@/features/library/UploadDialog';

import {
  Drawer,
  SectionLabel,
  CodeIcon,
  GridIcon,
  LayersIcon,
  SlidersIcon,
  TagIcon,
  UploadIcon,
  Button,
} from '@/components/ui';
import {
  selectAllTags,
  selectUploads,
  selectVisibleAssets,
  useBoardStore,
  useInspectorStore,
} from '@/stores';
import { ASSET_TYPE_LABEL, type AssetType } from '@/types/asset';
import { logoutAction } from '@/features/auth/actions';
import s from '../features.module.css';

const TYPES: AssetType[] = ['shader', 'p5', 'svg', 'image', 'video'];

interface NavDrawerProps {
  user?: { id: string; name: string } | null;
  onOpenAccount: () => void;
}

export function NavDrawer({ user = null, onOpenAccount }: NavDrawerProps) {
  const [uploadOpen, setUploadOpen] = useState(false);
  const open = useInspectorStore((st) => st.navOpen);
  const setNavOpen = useInspectorStore((st) => st.setNavOpen);

  const assets = useBoardStore((st) => st.assets);
  const typeFilter = useBoardStore((st) => st.typeFilter);
  const tagFilter = useBoardStore((st) => st.tagFilter);
  const toggleType = useBoardStore((st) => st.toggleType);
  const toggleTag = useBoardStore((st) => st.toggleTag);
  const clearFilters = useBoardStore((st) => st.clearFilters);

  const tags = useBoardStore(useShallow(selectAllTags));
  const visible = useBoardStore(useShallow(selectVisibleAssets));
  const uploads = useBoardStore(useShallow(selectUploads));

  const countOf = (type: AssetType) => assets.filter((a) => a.type === type).length;
  const filtersActive = typeFilter.size > 0 || tagFilter.size > 0;

  return (
    <>
    <Drawer
      open={open}
      side="left"
      title="Visual Mood Lab"
      onClose={() => setNavOpen(false)}
      footer={
        user && (
          <div className={s.drawerAccountRow}>
            <button type="button" className={s.drawerAccountName} onClick={onOpenAccount}>
              <span className={s.drawerAccountAvatar} aria-hidden="true">
                {user.name.charAt(0).toUpperCase()}
              </span>
              <span className={s.drawerAccountNameText}>{user.name}</span>
            </button>
            <form action={logoutAction}>
              <Button type="submit" variant="ghost">
                Log out
              </Button>
            </form>
          </div>
        )
      }
    >
      <nav className={s.navSection}>
        <SectionLabel>Board</SectionLabel>
        <div className={s.navList}>
          <button type="button" className={s.navItem} data-active="true">
            <GridIcon className={s.navItemIcon} />
            All assets
            <span className={s.navCount}>{visible.length}</span>
          </button>
          <button
            type="button"
            className={s.navItem}
            data-active={tagFilter.has('upload') ? 'true' : undefined}
            aria-pressed={tagFilter.has('upload')}
            onClick={() => toggleTag('upload')}
          >
            <LayersIcon className={s.navItemIcon} />
            Library uploads
            <span className={s.navCount}>{uploads.length}</span>
          </button>
        </div>
      </nav>

      <nav className={s.navSection}>
        <SectionLabel>Type</SectionLabel>
        <div className={s.navList}>
          {TYPES.map((t) => (
            <button
              key={t}
              type="button"
              className={s.navItem}
              data-active={typeFilter.has(t) ? 'true' : undefined}
              aria-pressed={typeFilter.has(t)}
              onClick={() => toggleType(t)}
            >
              <SlidersIcon className={s.navItemIcon} />
              {ASSET_TYPE_LABEL[t]}
              <span className={s.navCount}>{countOf(t)}</span>
            </button>
          ))}
        </div>
      </nav>

      {tags.length > 0 && (
        <nav className={s.navSection}>
          <SectionLabel>
            <TagIcon size={11} style={{ display: 'inline', verticalAlign: '-1px' }} /> Tags
          </SectionLabel>
          <div className={s.tagCloud}>
            {tags.map((tag) => (
              <button
                key={tag}
                type="button"
                className={s.tag}
                data-active={tagFilter.has(tag) ? 'true' : undefined}
                aria-pressed={tagFilter.has(tag)}
                onClick={() => toggleTag(tag)}
              >
                {tag}
              </button>
            ))}
          </div>
        </nav>
      )}

      {filtersActive && (
        <nav className={s.navSection}>
          <button type="button" className={s.navItem} onClick={clearFilters}>
            Clear filters
          </button>
        </nav>
      )}

      <nav className={s.navSection}>
        <SectionLabel>Lab</SectionLabel>
        <div className={s.navList}>
          <button type="button" className={s.navItem} onClick={() => setUploadOpen(true)}>
            <UploadIcon className={s.navItemIcon} />
            Upload
          </button>
          <button type="button" className={s.navItem} disabled>
            <CodeIcon className={s.navItemIcon} />
            Playground
            <span className={s.navCount}>P5</span>
          </button>
        </div>
      </nav>
    </Drawer>
    <UploadDialog open={uploadOpen} onClose={() => setUploadOpen(false)} />
    </>
  );
}
