'use client';

import {
  Drawer,
  SectionLabel,
  CodeIcon,
  GridIcon,
  LayersIcon,
  SlidersIcon,
  TagIcon,
  UploadIcon,
} from '@/components/ui';
import { useShallow } from 'zustand/react/shallow';
import {
  selectAllTags,
  selectVisibleAssets,
  useBoardStore,
  useInspectorStore,
} from '@/stores';
import { ASSET_TYPE_LABEL, type AssetType } from '@/types/asset';
import s from '../features.module.css';

const TYPES: AssetType[] = ['shader', 'p5', 'svg', 'image', 'video'];

export function NavDrawer() {
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

  const countOf = (type: AssetType) => assets.filter((a) => a.type === type).length;
  const filtersActive = typeFilter.size > 0 || tagFilter.size > 0;

  return (
    <Drawer open={open} side="left" title="Visual Mood Lab" onClose={() => setNavOpen(false)}>
      <nav className={s.navSection}>
        <SectionLabel>Board</SectionLabel>
        <div className={s.navList}>
          <button type="button" className={s.navItem} data-active="true">
            <GridIcon className={s.navItemIcon} />
            All assets
            <span className={s.navCount}>{visible.length}</span>
          </button>
          <button type="button" className={s.navItem} disabled>
            <LayersIcon className={s.navItemIcon} />
            Collections
            <span className={s.navCount}>—</span>
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
          <button type="button" className={s.navItem} disabled>
            <UploadIcon className={s.navItemIcon} />
            Upload
            <span className={s.navCount}>P1</span>
          </button>
          <button type="button" className={s.navItem} disabled>
            <CodeIcon className={s.navItemIcon} />
            Playground
            <span className={s.navCount}>P5</span>
          </button>
        </div>
      </nav>
    </Drawer>
  );
}
