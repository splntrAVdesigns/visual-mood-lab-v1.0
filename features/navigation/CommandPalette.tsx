'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { SearchIcon } from '@/components/ui';
import { useBoardStore } from '@/stores';
import { openAssetById, recordRecentlyViewed } from '@/features/board/openAsset';
import { ASSET_TYPE_BADGE, type Asset } from '@/types/asset';
import s from '../features.module.css';

function selectCards(state: { assets: Asset[] }): Asset[] {
  return state.assets;
}

/**
 * Cmd/Ctrl+K anywhere on the board opens a searchable jump-to-asset list.
 * Thirty cards is already enough that scrolling to find one by eye is
 * slower than typing its name — this only gets more valuable as the
 * library grows.
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const assets = useBoardStore(useShallow(selectCards));

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setIndex(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return assets.slice(0, 8);
    return assets
      .filter((a) => a.title.toLowerCase().includes(q) || a.tags.some((t) => t.includes(q)))
      .slice(0, 8);
  }, [assets, query]);

  const choose = (asset: Asset) => {
    recordRecentlyViewed(asset);
    openAssetById(asset.itemId);
    setOpen(false);
  };

  if (!open) return null;

  return (
    <div className={s.paletteScrim} onClick={() => setOpen(false)}>
      <div
        className={s.palette}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Jump to asset"
      >
        <div className={s.paletteInput}>
          <SearchIcon />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setIndex(0);
            }}
            placeholder="Jump to an asset…"
            aria-label="Jump to an asset"
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setIndex((i) => Math.min(i + 1, results.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setIndex((i) => Math.max(i - 1, 0));
              } else if (e.key === 'Enter' && results[index]) {
                choose(results[index]);
              }
            }}
          />
          <span className={s.paletteHint}>esc</span>
        </div>

        <div className={s.paletteList}>
          {results.length === 0 && <div className={s.paletteEmpty}>No matches</div>}
          {results.map((a, i) => (
            <button
              key={a.itemId}
              type="button"
              className={s.paletteItem}
              data-active={i === index ? 'true' : undefined}
              onMouseEnter={() => setIndex(i)}
              onClick={() => choose(a)}
            >
              <span className={s.paletteItemTitle}>{a.title}</span>
              <span className={s.paletteItemBadge}>{ASSET_TYPE_BADGE[a.type]}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
