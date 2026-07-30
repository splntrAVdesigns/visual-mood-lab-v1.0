'use client';

import { useShallow } from 'zustand/react/shallow';
import { selectVisibleAssets, useBoardStore, useInspectorStore } from '@/stores';
import { withBaseControls } from '@/renderers/control-schema';
import type { Asset } from '@/types/asset';
import { AssetCard } from './AssetCard';
import s from '../features.module.css';

export function BoardGrid() {
  const assets = useBoardStore(useShallow(selectVisibleAssets));
  const total = useBoardStore((st) => st.assets.length);
  const selectedId = useBoardStore((st) => st.selectedId);
  const select = useBoardStore((st) => st.select);
  const clearFilters = useBoardStore((st) => st.clearFilters);

  const openInspector = useInspectorStore((st) => st.openInspector);

  const open = (asset: Asset) => {
    select(asset.id);
    // Assets without a parsed schema still get the shared base controls, so
    // the inspector is never empty.
    openInspector(asset.schema ?? withBaseControls(asset.id, []), asset.params, asset.id);
  };

  return (
    <>
      <div className={s.boardBar}>
        <h1 className={s.boardTitle}>All assets</h1>
        <span className={s.boardMeta}>
          {assets.length === total ? `${total}` : `${assets.length} / ${total}`}
        </span>
      </div>

      <div className={s.grid}>
        {assets.map((a) => (
          <AssetCard key={a.id} asset={a} selected={a.id === selectedId} onOpen={open} />
        ))}

        {assets.length === 0 && (
          <div className={s.empty}>
            <span className={s.emptyTitle}>
              {total === 0 ? 'Nothing here yet' : 'No assets match those filters'}
            </span>
            <span className={s.emptyBody}>
              {total === 0
                ? 'Run the seed script to load the starter library, or upload your own once Phase 1 lands.'
                : 'Loosen the type or tag filters to see more.'}
            </span>
            {total > 0 && (
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
