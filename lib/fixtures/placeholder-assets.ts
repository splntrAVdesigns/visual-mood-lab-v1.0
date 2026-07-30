import type { Asset } from '@/types/asset';

/**
 * Phase 0 fixture data. These exist only to give the shell something to lay
 * out and to exercise the filter and selection paths — Phase 1 replaces this
 * module with a fetch against the assets API.
 *
 * Titles match the planned seed library (plan §8) so the grid already reads
 * like the real thing.
 */

/* Fixed epoch, not Date.now(): fixture timestamps must be identical on the
   server and the client or React reports a hydration mismatch. */
const EPOCH = Date.parse('2026-07-27T00:00:00.000Z');
const now = new Date(EPOCH).toISOString();

function stub(id: string, title: string, type: Asset['type'], tags: string[], i: number): Asset {
  return {
    id,
    itemId: id,
    type,
    title,
    tags,
    createdAt: now,
    updatedAt: new Date(EPOCH - i * 60_000).toISOString(),
  };
}

export const PLACEHOLDER_ASSETS: Asset[] = [
  stub('gradient-grid', 'Gradient Grid', 'shader', ['gradient', 'grid', 'geometric'], 0),
  stub('ascii-mosaic', 'ASCII Mosaic', 'shader', ['ascii', 'text', 'raster'], 1),
  stub('ordered-dither', 'Ordered Dither', 'shader', ['dither', 'raster', 'monochrome'], 2),
  stub('halftone-screen', 'Halftone Screen', 'shader', ['halftone', 'print', 'raster'], 3),
  stub('kaleidoscope', 'Kaleidoscope', 'shader', ['symmetry', 'geometric'], 4),
  stub('noise-field', 'Noise Field', 'shader', ['noise', 'organic'], 5),
  stub('feedback-trails', 'Feedback Trails', 'shader', ['feedback', 'motion'], 6),
  stub('truchet-weave', 'Truchet Weave', 'shader', ['tiles', 'geometric'], 7),
  stub('sdf-sphere', 'SDF Sphere', 'shader', ['3d', 'raymarch'], 8),
  stub('chromatic-glitch', 'Chromatic Glitch', 'shader', ['glitch', 'post'], 9),

  stub('particle-burst', 'Particle Burst', 'p5', ['particles', 'physics', 'motion'], 10),
  stub('flow-field', 'Flow Field', 'p5', ['noise', 'particles'], 11),
  stub('recursive-tree', 'Recursive Tree', 'p5', ['recursion', 'organic'], 12),
  stub('koch-snowflake', 'Koch Snowflake', 'p5', ['fractal', 'recursion'], 13),
  stub('bezier-lab', 'Bezier Lab', 'p5', ['curves', 'interactive'], 14),
  stub('orbit-sphere', 'Orbit Sphere', 'p5', ['3d', 'interactive'], 15),
  stub('terrain-wireframe', 'Terrain Wireframe', 'p5', ['3d', 'noise', 'wireframe'], 16),
  stub('shader-texture', 'Shader Texture', 'p5', ['3d', 'shader'], 17),
  stub('harmonograph', 'Harmonograph', 'p5', ['curves', 'math'], 18),
  stub('type-grid', 'Type Grid', 'p5', ['typography', 'grid'], 19),
];
