import type { AssetType } from '@/types/asset';
import type { AssetRenderer } from './types';
import { ShaderRenderer } from './shader.renderer';
import { P5Renderer } from './p5.renderer';
import { MediaRenderer } from './media.renderer';

/**
 * type -> adapter. The only place in the codebase that maps an asset type to
 * an implementation; adding a sixth type means one line here and one new
 * adapter file, with zero UI changes.
 */
export function createRenderer(type: AssetType, assetId: string): AssetRenderer {
  switch (type) {
    case 'shader':
      return new ShaderRenderer(assetId);
    case 'p5':
      return new P5Renderer(assetId);
    case 'image':
    case 'svg':
    case 'video':
      return new MediaRenderer(assetId, type);
  }
}

export { ShaderRenderer, P5Renderer, MediaRenderer };
export type { AssetRenderer };
