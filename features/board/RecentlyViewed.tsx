'use client';

import { useShallow } from 'zustand/react/shallow';
import { useBoardStore } from '@/stores';
import { ASSET_TYPE_BADGE, type Asset } from '@/types/asset';
import s from '../features.module.css';

interface RecentlyViewedProps {
  onOpen: (asset: Asset) => void;
}

function selectRecent(state: { assets: Asset[]; recentlyViewed: string[] }): Asset[] {
  const byId = new Map(state.assets.map((a) => [a.itemId, a]));
  return state.recentlyViewed.map((id) => byId.get(id)).filter((a): a is Asset => Boolean(a));
}

export function RecentlyViewed({ onOpen }: RecentlyViewedProps) {
  const recent = useBoardStore(useShallow(selectRecent));
  if (recent.length === 0) return null;

  return (
    <nav className={s.recentSection} aria-label="Recently viewed">
      <span className={s.recentLabel}>Recently viewed</span>
      <div className={s.recentStrip}>
        {recent.map((a) => (
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
