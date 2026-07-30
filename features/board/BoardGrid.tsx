'use client';

import { useShallow } from 'zustand/react/shallow';
import { selectVisibleAssets, useBoardStore } from '@/stores';
import type { Asset, SortKey } from '@/types/asset';
import { AssetCard } from './AssetCard';
import { openAssetById, recordRecentlyViewed } from './openAsset';
import { RecentlyViewed } from './RecentlyViewed';
import { Snapshots } from './Snapshots';
import { Library } from './Library';
import s from '../features.module.css';

const SORT_LABEL: Record<SortKey, string> = {
  recent: 'Recent',
  title: 'Name',
  type: 'Type',
};

export function BoardGrid() {
  const assets = useBoardStore(useShallow(selectVisibleAssets));
  const total = useBoardStore((st) => st.assets.length);
  const selectedId = useBoardStore((st) => st.selectedId);
  const clearFilters = useBoardStore((st) => st.clearFilters);
  const query = useBoardStore((st) => st.query);
  const typeFilter = useBoardStore((st) => st.typeFilter);
  const tagFilter = useBoardStore((st) => st.tagFilter);
  const sort = useBoardStore((st) => st.sort);
  const setSort = useBoardStore((st) => st.setSort);

  const open = (asset: Asset) => {
    recordRecentlyViewed(asset);
    openAssetById(asset.itemId);
  };

  const filtersActive = query.trim() !== '' || typeFilter.size > 0 || tagFilter.size > 0;
  const activeTagList = [...tagFilter];

  return (
    <>
      <RecentlyViewed onOpen={open} />
      <Library onOpen={open} />
      <Snapshots onOpen={open} />

      <div className={s.boardBar}>
        <h1 className={s.boardTitle}>All assets</h1>
        <span className={s.boardMeta}>
          {assets.length === total ? `${total}` : `${assets.length} / ${total}`}
        </span>
        <span className={s.boardBarSpacer} />
        <div className={s.sortRow}>
          <span className={s.sortLabel}>Sort</span>
          {(Object.keys(SORT_LABEL) as SortKey[]).map((key) => (
            <button
              key={key}
              type="button"
              className={s.sortButton}
              data-active={sort === key ? 'true' : undefined}
              onClick={() => setSort(key)}
            >
              {SORT_LABEL[key]}
            </button>
          ))}
        </div>
      </div>

      <div className={s.grid}>
        {assets.map((a) => (
          <AssetCard key={a.itemId} asset={a} selected={a.itemId === selectedId} onOpen={open} />
        ))}

        {assets.length === 0 && (
          <div className={s.empty}>
            <span className={s.emptyTitle}>
              {total === 0 ? 'Nothing here yet' : 'No assets match those filters'}
            </span>
            <span className={s.emptyBody}>
              {total === 0 ? (
                'The board is empty — seed the starter library from the header to get started.'
              ) : (
                <>
                  Nothing matches
                  {query.trim() && <> “{query.trim()}”</>}
                  {activeTagList.length > 0 && (
                    <> tagged {activeTagList.map((t) => `“${t}”`).join(', ')}</>
                  )}
                  {typeFilter.size > 0 && <> in the selected type{typeFilter.size > 1 ? 's' : ''}</>}.
                </>
              )}
            </span>
            {total > 0 && filtersActive && (
              <button type="button" className={s.tag} onClick={clearFilters}>
                clear filters
              </button>
            )}
          </div>
        )}
      </div>
    </>
  );
}
