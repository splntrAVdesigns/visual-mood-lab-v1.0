// lib/schema/carry.ts
//
// The ONE rule for what happens to parameter values when a control schema
// changes under them (the live-editing case):
//   - a value survives only if its control survives with the SAME id AND kind
//     (a slider that became a select must not inherit a number);
//   - everything else — new controls, retyped controls — starts at its default;
//   - survivors are re-coerced, so a narrowed range clamps them.
//
// Shared by the inspector's updateSchema() and both renderers' setSource(), so
// the visible values, the live renderer and the saved state can never disagree
// about it.

import type { ControlSchema, ParamState } from '@/renderers/control-schema';
import { hydrate } from '@/renderers/control-schema';

export function carryParams(prev: ControlSchema | null, next: ControlSchema, params: ParamState): ParamState {
  const kindBefore = new Map((prev?.controls ?? []).map((c) => [c.id, c.kind] as const));
  const carry: ParamState = {};
  for (const c of next.controls) {
    if (kindBefore.get(c.id) === c.kind && params[c.id] !== undefined) carry[c.id] = params[c.id];
  }
  return hydrate(next, carry);
}
