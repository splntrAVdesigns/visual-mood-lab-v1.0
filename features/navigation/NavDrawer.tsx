'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useShallow } from 'zustand/react/shallow';
import { UploadDialog } from '@/features/library/UploadDialog';
import { logoutAction } from '@/features/auth/actions';
import type { User } from '@/lib/auth';
import { useOnboardingStore } from '@/features/onboarding/onboardingStore';

import {
  Button,
  Drawer,
  SectionLabel,
  CodeIcon,
  GridIcon,
  GuideIcon,
  LayersIcon,
  SlidersIcon,
  TagIcon,
  UploadIcon,
} from '@/components/ui';
import { QuadrantMark } from '@/components/ui/QuadrantMark';
import {
  selectAllTags,
  selectUploads,
  selectVisibleAssets,
  useBoardStore,
  useInspectorStore,
} from '@/stores';
import { ASSET_TYPE_LABEL, type AssetType } from '@/types/asset';
import s from '../features.module.css';

const TYPES: AssetType[] = ['shader', 'p5', 'svg', 'image', 'video'];

interface NavDrawerProps {
  user?: User | null;
  onOpenAccount?: () => void;
}

export function NavDrawer({ user = null, onOpenAccount }: NavDrawerProps) {
  const [uploadOpen, setUploadOpen] = useState(false);
  const open = useInspectorStore((st) => st.navOpen);
  const setNavOpen = useInspectorStore((st) => st.setNavOpen);
  const openGuide = useOnboardingStore((st) => st.open);

  const pathname = usePathname();
  const router = useRouter();
  const onBoard = pathname === '/';

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

  /* Board/Type/Tag items mutate board-store filters, which only means
     anything while BoardGrid is mounted — i.e. on `/`. NavDrawer now
     renders on other routes too (see AppChrome), so every one of those
     actions has to get back to the board first if it isn't already
     there. Applying the filter and closing the drawer only happen on the
     actual navigation, not on every click while already on the board —
     staying open there is what lets you see the filter take effect. */
  const goToBoard = () => {
    if (onBoard) return;
    router.push('/');
    setNavOpen(false);
  };

  const accountFooter = user ? (
    <div className={s.drawerAccountRow}>
      <button type="button" className={s.drawerAccountName} title={user.name} onClick={onOpenAccount}>
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
  ) : undefined;

  return (
    <>
    <Drawer
      open={open}
      side="left"
      title="Visual Mood Lab"
      onClose={() => setNavOpen(false)}
      footer={accountFooter}
    >
      {/*
        Ungrouped, no SectionLabel — this is a static destination, not a
        filter or an action, so it doesn't belong in the Board/Type/Tags
        hierarchy below. The bottom border marks it as its own category.
        "Start here" sits alongside About for the same reason: neither
        one is board state.
      */}
      <nav className={`${s.navSection} ${s.navAbout}`}>
        <Link
          href="/about"
          className={s.navItem}
          data-active={pathname === '/about' ? 'true' : undefined}
          onClick={() => setNavOpen(false)}
        >
          <QuadrantMark tone="accent" size={12} className={s.navItemIcon} />
          About
        </Link>
        <button
          type="button"
          className={s.navItem}
          onClick={() => {
            openGuide();
            setNavOpen(false);
          }}
        >
          <GuideIcon className={s.navItemIcon} />
          Start here
        </button>
      </nav>

      <nav className={s.navSection}>
        <SectionLabel>Board</SectionLabel>
        <div className={s.navList}>
          <button
            type="button"
            className={s.navItem}
            data-active={onBoard ? 'true' : undefined}
            onClick={goToBoard}
          >
            <GridIcon className={s.navItemIcon} />
            All assets
            <span className={s.navCount}>{visible.length}</span>
          </button>
          <button
            type="button"
            className={s.navItem}
            data-active={onBoard && tagFilter.has('upload') ? 'true' : undefined}
            aria-pressed={tagFilter.has('upload')}
            onClick={() => {
              toggleTag('upload');
              goToBoard();
            }}
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
              data-active={onBoard && typeFilter.has(t) ? 'true' : undefined}
              aria-pressed={typeFilter.has(t)}
              onClick={() => {
                toggleType(t);
                goToBoard();
              }}
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
                data-active={onBoard && tagFilter.has(tag) ? 'true' : undefined}
                aria-pressed={tagFilter.has(tag)}
                onClick={() => {
                  toggleTag(tag);
                  goToBoard();
                }}
              >
                {tag}
              </button>
            ))}
          </div>
        </nav>
      )}

      {filtersActive && (
        <nav className={s.navSection}>
          <button
            type="button"
            className={s.navItem}
            onClick={() => {
              clearFilters();
              goToBoard();
            }}
          >
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

      {/*
        Plain link rather than BuyMeACoffee's own auto-inject widget script.
        That script drops a fixed-position floating button globally and
        mutates the DOM directly with no awareness of React — embedding it
        inside a component that mounts/unmounts with the drawer risks
        duplicate or stale injected buttons. A styled link achieves the same
        outcome without that risk. Positioned above the account section
        below, per the original placement request.
      */}
      <nav className={s.navSection}>
        <div className={s.navList}>
          <a
            href="https://www.buymeacoffee.com/splntr_microtools"
            target="_blank"
            rel="noopener noreferrer"
            className={s.navItem}
          >
            <span className={s.navItemIcon} aria-hidden="true" style={{ fontSize: '1em' }}>
              ☕
            </span>
            Buy me a coffee
          </a>
        </div>
      </nav>

      {/*
        Account row lives in Drawer's own `footer` slot (see `accountFooter`
        above) — rendered outside .drawerBody, so it's a real pinned footer
        via flex layout (.drawerBody is flex:1/overflow-y:auto, .drawerFooter
        is flex:none) rather than sticky-positioned inside the scroll region.
      */}
    </Drawer>
    <UploadDialog open={uploadOpen} onClose={() => setUploadOpen(false)} />
    </>
  );
}
