import { useBoardStore, useInspectorStore } from '@/stores';
import { defaultSchemaFor } from '@/renderers/control-schema';
import type { Asset } from '@/types/asset';

/**
 * The one function that opens an asset.
 *
 * BoardGrid's click handler, the deep-link mount effect on `/asset/[id]`,
 * and the popstate listener for browser back/forward all call this and
 * nothing else. Three separate call sites reimplementing "select + open
 * inspector + sync the URL" would drift from each other the first time one
 * of them changes; a shared function can't.
 *
 * `pushUrl` is false when responding to a popstate event — the URL already
 * changed (that's why we're here), so pushing again would double an entry
 * onto the history stack and break the back button.
 */
export function openAssetById(itemId: string, pushUrl = true): void {
  const asset = useBoardStore.getState().assets.find((a) => a.itemId === itemId);
  if (!asset) return;

  useBoardStore.getState().select(itemId);
  useInspectorStore
    .getState()
    .openInspector(
      // A snapshot's `schema` field is inherited from its source shader or
      // sketch (that's how paramsOverride works), but a snapshot is now
      // rendered as a flat captured image, not a live instance — so its
      // inspector has to use the image schema regardless of what the
      // underlying asset carries. Using asset.schema here would show full
      // shader controls over a static picture with nothing behind them.
      asset.isSnapshot ? defaultSchemaFor(asset.id, 'image') : (asset.schema ?? defaultSchemaFor(asset.id, asset.type)),
      asset.params,
      itemId,
      asset.isSnapshot ?? false,
      asset.mod ?? {},
    );

  if (pushUrl && typeof window !== 'undefined') {
    window.history.pushState({ itemId }, '', `/asset/${itemId}`);
  }
}

export function closeAsset(pushUrl = true): void {
  useInspectorStore.getState().closeInspector();
  useBoardStore.getState().select(null);

  if (pushUrl && typeof window !== 'undefined') {
    window.history.pushState({}, '', '/');
  }
}

/** Card the sidebar's "Recently viewed" strip reads from. */
export function recordRecentlyViewed(asset: Asset): void {
  useBoardStore.getState().pushRecentlyViewed(asset.itemId);
}
