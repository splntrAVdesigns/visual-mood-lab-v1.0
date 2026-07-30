'use client';

import { Badge } from '@/components/ui';
import { RendererStage } from './RendererStage';
import { ASSET_TYPE_BADGE, type Asset } from '@/types/asset';
import s from '../features.module.css';

interface AssetCardProps {
  asset: Asset;
  selected: boolean;
  onOpen: (asset: Asset) => void;
}

/**
 * Phase 1: renders the generated poster.
 * Phase 2 promotes the stage to a live renderer via IntersectionObserver,
 * with the poster staying as the `poster` card state.
 *
 * The chrome around the stage has not changed since Phase 0, which is the
 * point of having built it first.
 */
export function AssetCard({ asset, selected, onOpen }: AssetCardProps) {
  return (
    <button
      type="button"
      className={s.card}
      data-selected={selected ? 'true' : undefined}
      aria-pressed={selected}
      onClick={() => onOpen(asset)}
    >
      <RendererStage asset={asset} />
      <span className={s.cardFoot}>
        <span className={s.cardTitle}>{asset.title}</span>
        <Badge className={s.cardBadge}>{ASSET_TYPE_BADGE[asset.type]}</Badge>
      </span>
    </button>
  );
}
