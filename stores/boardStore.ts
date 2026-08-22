import { create } from 'zustand';
import type { ModState, ParamState, SoundState } from '@/renderers/control-schema';
import type { Asset, AssetType, BoardLayout, SortKey } from '@/types/asset';

interface BoardState {
  assets: Asset[];
  layout: BoardLayout;
  selectedId: string | null;

  /* filters */
  query: string;
  typeFilter: Set<AssetType>;
  tagFilter: Set<string>;
  sort: SortKey;
  /** itemIds, most recent first. Capped — see pushRecentlyViewed. */
  recentlyViewed: string[];

  /* actions */
  setAssets: (assets: Asset[]) => void;
  addAsset: (asset: Asset) => void;
  removeAsset: (itemId: string) => void;
  /** Keeps the board's copy of a card in sync with inspector edits. */
  updateAssetParams: (itemId: string, params: ParamState) => void;
  updateAssetMod: (itemId: string, mod: ModState) => void;
  updateAssetSound: (itemId: string, sound: SoundState) => void;
  select: (id: string | null) => void;
  setLayout: (layout: BoardLayout) => void;
  setQuery: (query: string) => void;
  toggleType: (type: AssetType) => void;
  toggleTag: (tag: string) => void;
  clearFilters: () => void;
  setSort: (sort: SortKey) => void;
  pushRecentlyViewed: (itemId: string) => void;
}

export const useBoardStore = create<BoardState>()((set) => ({
  assets: [],
  layout: 'grid',
  selectedId: null,
  query: '',
  typeFilter: new Set(),
  tagFilter: new Set(),
  sort: 'recent',
  recentlyViewed: [],

  setAssets: (assets) => set({ assets }),
  addAsset: (asset) => set((s) => ({ assets: [asset, ...s.assets] })),

  /*
   * The inspector used to update three things on every parameter change —
   * its own state, the live renderer, and the database — but never this
   * store. Since reopening a card reads its values from here, and the grid
   * thumbnail renders from here too, edits appeared to "not save": close the
   * overlay, reopen it, and the stale original values came straight back out
   * of this store, even though the database had the new ones. It only looked
   * correct after a full page reload, which is the one moment this store gets
   * refilled from the server.
   */
  updateAssetParams: (itemId, params) =>
    set((s) => ({
      assets: s.assets.map((a) => (a.itemId === itemId ? { ...a, params } : a)),
    })),

  updateAssetMod: (itemId, mod) =>
    set((s) => ({
      assets: s.assets.map((a) => (a.itemId === itemId ? { ...a, mod } : a)),
    })),
  updateAssetSound: (itemId, sound) =>
    set((s) => ({
      assets: s.assets.map((a) => (a.itemId === itemId ? { ...a, sound } : a)),
    })),
  /**
   * Keyed by itemId, not id. A snapshot shares its underlying asset's `id`
   * with the original card, so filtering on `id` either removed nothing
   * (the itemId never matched an id) or, worse, would have removed every
   * card derived from that asset at once. Deleting a snapshot silently
   * doing nothing was this exact mismatch.
   */
  removeAsset: (itemId) =>
    set((s) => ({
      assets: s.assets.filter((a) => a.itemId !== itemId),
      recentlyViewed: s.recentlyViewed.filter((r) => r !== itemId),
      selectedId: s.selectedId === itemId ? null : s.selectedId,
    })),

  select: (selectedId) => set({ selectedId }),
  setLayout: (layout) => set({ layout }),
  setQuery: (query) => set({ query }),

  toggleType: (type) =>
    set((s) => {
      const next = new Set(s.typeFilter);
      next.has(type) ? next.delete(type) : next.add(type);
      return { typeFilter: next };
    }),

  toggleTag: (tag) =>
    set((s) => {
      const next = new Set(s.tagFilter);
      next.has(tag) ? next.delete(tag) : next.add(tag);
      return { tagFilter: next };
    }),

  clearFilters: () => set({ query: '', typeFilter: new Set(), tagFilter: new Set() }),
  setSort: (sort) => set({ sort }),

  pushRecentlyViewed: (itemId) =>
    set((s) => ({
      recentlyViewed: [itemId, ...s.recentlyViewed.filter((id) => id !== itemId)].slice(0, 8),
    })),
}));

/* ------------------------------------------------------------------ *
 * Selectors — kept outside the store so they stay cheap and testable.
 * ------------------------------------------------------------------ */

export function selectVisibleAssets(s: BoardState): Asset[] {
  const q = s.query.trim().toLowerCase();

  const filtered = s.assets.filter((a) => {
    // Snapshots are surfaced in their own section — keeping them out of the
    // main grid stops a saved variation from shoving the library around.
    if (a.isSnapshot) return false;
    if (s.typeFilter.size && !s.typeFilter.has(a.type)) return false;
    if (s.tagFilter.size && !a.tags.some((t) => s.tagFilter.has(t))) return false;
    if (q && !a.title.toLowerCase().includes(q) && !a.tags.some((t) => t.includes(q))) {
      return false;
    }
    return true;
  });

  switch (s.sort) {
    case 'title':
      return [...filtered].sort((a, b) => a.title.localeCompare(b.title));
    case 'type':
      return [...filtered].sort(
        (a, b) => a.type.localeCompare(b.type) || a.title.localeCompare(b.title),
      );
    default:
      return [...filtered].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
}

export function selectAllTags(s: BoardState): string[] {
  const tags = new Set<string>();
  for (const a of s.assets) for (const t of a.tags) tags.add(t);
  return [...tags].sort();
}

export function selectSelectedAsset(s: BoardState): Asset | null {
  // itemId, not id — with snapshots in play, several cards share one id and
  // matching on it would resolve to whichever happened to come first.
  return s.assets.find((a) => a.itemId === s.selectedId) ?? null;
}

/** Snapshots live in their own section, not mixed into the main grid. */
export function selectSnapshots(s: BoardState): Asset[] {
  return s.assets.filter((a) => a.isSnapshot);
}

/**
 * Uploaded media, surfaced separately from the shader/sketch library.
 *
 * The `upload` tag has been attached at ingest since Phase 1 and was never
 * read anywhere — an upload landed in "All assets" indistinguishable from
 * the 30 library tiles, findable only by the type filter. Same tag, now
 * actually used for the thing it was named for.
 */
export function selectUploads(s: BoardState): Asset[] {
  return s.assets.filter((a) => !a.isSnapshot && a.tags.includes('upload'));
}
