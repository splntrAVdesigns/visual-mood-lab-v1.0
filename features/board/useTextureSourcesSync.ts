import { useEffect } from 'react';
import { getPool } from '@/lib/render/pool';
import type { Asset } from '@/types/asset';

/**
 * Publishes {assetId -> posterUrl} to the renderer pool whenever the
 * board's asset list changes, so texture-kind controls (Chromatic
 * Glitch's Source picker, and any future one) can actually resolve
 * what the user picks.
 *
 * Root cause this closes: RendererPool.textureSources (lib/render/pool.ts)
 * is a private field that defaults to {} and is only ever mutated by
 * setTextureSources() — nothing in the app called that method, so every
 * texture control silently resolved to nothing regardless of what was
 * selected. Confirmed by tracing shader.renderer.ts's
 * `this.textureSources[assetId]` lookup back to its only possible
 * source.
 *
 * Keyed by `asset.id` (the underlying content id), not `asset.itemId`
 * (the board-placement id) — TextureControl.tsx's picker stores the
 * former (`onChange(a.id)`), so the map has to match that or every
 * lookup misses.
 */
export function useTextureSourcesSync(assets: Pick<Asset, 'id' | 'posterUrl'>[]) {
  useEffect(() => {
    const sources: Record<string, string> = {};
    for (const asset of assets) {
      if (asset.posterUrl) sources[asset.id] = asset.posterUrl;
    }
    getPool().setTextureSources(sources);
  }, [assets]);
}
