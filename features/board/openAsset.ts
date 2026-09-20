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
      // The real underlying asset's id — distinct from itemId (the board
      // CARD's id). Threading this through is what fixes the 404 on any
      // owned, non-snapshot card's params/mod/sound/effects persistence —
      // see inspectorStore.ts's persist()/flush() doc for the full story.
      asset.id,
      asset.isSnapshot ?? false,
      asset.mod ?? {},
      asset.isOwned ?? false,
      asset.sound,
      // Phase 4.96 — was missing entirely, which is why a VFX chain
      // looked cleared every time the tile reopened: openInspector()
      // defaults this argument to `[]` when the caller doesn't supply
      // one, so every reopen silently re-hydrated to an empty chain
      // regardless of what was actually saved. Mirrors how `asset.mod`/
      // `asset.sound` are already passed above — same fallback-to-empty
      // shape for the same "nothing saved yet" case.
      asset.effects ?? [],
      // Roll / Mutate and their shortcuts read the type from the inspector
      // store, not the board store — so an asset that isn't on the board (a
      // Playground draft) works the same way. Same value as before: asset.type.
      asset.type,
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
