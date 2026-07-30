'use client';

import { useShallow } from 'zustand/react/shallow';
import { selectUploads, useBoardStore } from '@/stores';
import { ASSET_TYPE_BADGE, type Asset } from '@/types/asset';
import s from '../features.module.css';

interface LibraryProps {
  onOpen: (asset: Asset) => void;
}

/**
 * Your own uploads, called out separately from the 30 seed-library tiles.
 *
 * Unlike Snapshots, uploads are NOT removed from "All assets" — a photo you
 * added is real library content, not a personal derivative of something
 * else, so hiding it from the main browse would feel wrong. This section
 * exists purely for quick access after adding something new, same as
 * Recently Viewed.
 */
export function Library({ onOpen }: LibraryProps) {
  const uploads = useBoardStore(useShallow(selectUploads));
  if (uploads.length === 0) return null;

  return (
    <nav className={s.recentSection} aria-label="Your uploads">
      <span className={s.recentLabel}>Library</span>
      <div className={s.recentStrip}>
        {uploads.map((a) => (
          <button
            key={a.itemId}
            type="button"
            className={s.recentCard}
            onClick={() => onOpen(a)}
            title={a.title}
          >
            {a.posterUrl ? (
              <img className={s.recentPoster} src={a.posterUrl} alt="" loading="lazy" />
            ) : (
              <span className={s.recentPlaceholder}>{ASSET_TYPE_BADGE[a.type]}</span>
            )}
            <span className={s.recentTitle}>{a.title}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}
