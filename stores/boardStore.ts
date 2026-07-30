import { create } from 'zustand';
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

  /* actions */
  setAssets: (assets: Asset[]) => void;
  addAsset: (asset: Asset) => void;
  removeAsset: (id: string) => void;
  select: (id: string | null) => void;
  setLayout: (layout: BoardLayout) => void;
  setQuery: (query: string) => void;
  toggleType: (type: AssetType) => void;
  toggleTag: (tag: string) => void;
  clearFilters: () => void;
  setSort: (sort: SortKey) => void;
}

export const useBoardStore = create<BoardState>()((set) => ({
  assets: [],
  layout: 'grid',
  selectedId: null,
  query: '',
  typeFilter: new Set(),
  tagFilter: new Set(),
  sort: 'recent',

  setAssets: (assets) => set({ assets }),
  addAsset: (asset) => set((s) => ({ assets: [asset, ...s.assets] })),
  removeAsset: (id) =>
    set((s) => ({
      assets: s.assets.filter((a) => a.id !== id),
      selectedId: s.selectedId === id ? null : s.selectedId,
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
}));

/* ------------------------------------------------------------------ *
 * Selectors — kept outside the store so they stay cheap and testable.
 * ------------------------------------------------------------------ */

export function selectVisibleAssets(s: BoardState): Asset[] {
  const q = s.query.trim().toLowerCase();

  const filtered = s.assets.filter((a) => {
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
  return s.assets.find((a) => a.id === s.selectedId) ?? null;
}
