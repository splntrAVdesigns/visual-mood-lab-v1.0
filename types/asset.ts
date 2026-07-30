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
  id: string;
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
