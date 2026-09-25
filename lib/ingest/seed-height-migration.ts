/**
 * Height used to mean terrain relief on these two library sketches. The
 * original key remains the relief control, so saved nonzero looks survive.
 * A saved zero meant an invisible/flat tile; promote it to the new bottom
 * position while restoring visible default relief. Repeat calls are safe.
 */
import type { ParamState } from '@/renderers/control-schema';

export function migrateSeedHeightParams(
  seedSlug: string | undefined,
  params: ParamState,
): ParamState {
  const defaultRelief = seedSlug === 'landscape-grid' ? 0.42
    : seedSlug === 'terrain-wireframe' ? 92 : null;
  if (defaultRelief === null || Object.hasOwn(params, 'height')) return params;
  const oldRelief = params.amplitude;
  return {
    ...params,
    height: oldRelief === 0 ? 0 : 0.5,
    ...(oldRelief === 0 ? { amplitude: defaultRelief } : {}),
  };
}
