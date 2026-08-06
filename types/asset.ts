import type { ControlSchema, ModState, ParamState } from '@/renderers/control-schema';

export type AssetType = 'image' | 'svg' | 'video' | 'p5' | 'shader';

export const ASSET_TYPE_LABEL: Record<AssetType, string> = {
  image: 'Image',
  svg: 'SVG',
  video: 'Video',
  p5: 'Sketch',
  shader: 'Shader',
};

/** Short badge text shown on cards. Mono, uppercase. */
export const ASSET_TYPE_BADGE: Record<AssetType, string> = {
  image: 'IMG',
  svg: 'SVG',
  video: 'VID',
  p5: 'P5',
  shader: 'GLSL',
};

export interface Asset {
  /** The underlying source asset — schema, GLSL/JS source, poster all live here. */
  id: string;
  /**
   * Unique per CARD on the board. Equal to `id` for an asset's canonical
   * card. A parameter snapshot gets its own itemId while sharing the same
   * underlying `id` — same shader, different saved look, distinct card.
   */
  itemId: string;
  /** True for a saved parameter variation of another card's asset. */
  isSnapshot?: boolean;
  /**
   * True when the signed-in viewer owns the underlying asset (their own
   * upload) rather than viewing a shared library asset cloned onto their
   * board. Determines where edits persist — see stores/inspectorStore.ts's
   * persist()/flush(). Library-derived cards can't write to the shared
   * asset row (that would let one person's slider edit alter what every
   * other account sees), so they persist as a per-card override instead,
   * the same mechanism a snapshot already uses.
   */
  isOwned?: boolean;
  type: AssetType;
  title: string;
  tags: string[];

  /** Blob URL for binary assets. */
  srcUrl?: string;
  /** Source text for code assets (p5, shader). */
  source?: string;
  /** Always present — generated at ingest. */
  posterUrl?: string;

  schema?: ControlSchema;
  params?: ParamState;
  mod?: ModState;

  dominantColors?: string[];
  width?: number;
  height?: number;
  durationMs?: number;

  createdAt: string;
  updatedAt: string;
}

export interface BoardItem {
  id: string;
  boardId: string;
  assetId: string;
  order: number;
  /** Canvas mode geometry. Unused in grid mode. */
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  /** Snapshot: same asset, different look. */
  paramsOverride?: ParamState;
}

export interface Board {
  id: string;
  title: string;
  itemIds: string[];
  createdAt: string;
  updatedAt: string;
}

/**
 * How much of a card is actually running.
 *   poster  — static image, zero GPU cost
 *   preview — live at reduced resolution, in the renderer pool
 *   focused — live at full quality, inspector open
 */
export type CardState = 'poster' | 'preview' | 'focused';

export type BoardLayout = 'grid' | 'canvas';

export type SortKey = 'recent' | 'title' | 'type';
