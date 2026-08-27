/**
 * Visual Mood Lab — Phase 4.96, GPU Post-Processing Effects ("VFX")
 * ------------------------------------------------------------------
 * Deliberately thin. An effect definition is just a shader source plus a
 * declared list of params in the SAME `Control` shape every renderer's
 * ControlSchema already uses (renderers/control-schema.ts) — so `coerce()`,
 * `applyModulation()`, `defaultsOf()`, and every existing inspector control
 * component work against an effect param with zero new code. The only
 * genuinely new concept here is the chain itself (EffectInstance[]) and the
 * registry that resolves an effectType id to its definition.
 *
 * Location: lib/effects/types.ts
 */

import type { Control, ModState, ParamState } from '@/renderers/control-schema';

/** Hard cap for this round — see IMPLEMENTATION_PLAN.md §7 Phase 4.96.
    Protects the frame budget and keeps the rack UI from needing scroll
    management before real usage data justifies raising it. */
export const MAX_EFFECTS_PER_CHAIN = 3;

export type EffectFamily = 'strobe' | 'color' | 'mirror' | 'warp' | 'slice';

/**
 * A registry entry — shared, global, loaded once from effects/manifest.json.
 * Never mutated per-tile; EffectInstance below is the per-tile part.
 */
export interface EffectDefinition {
  /** Registry key. Stable, never reused even if an effect is retired —
      an old EffectInstance.effectType pointing at a removed id should
      fail closed (skip the pass), not silently resolve to a different
      effect that happens to reuse the id. */
  id: string;
  title: string;
  family: EffectFamily;
  /** Relative to effects/shaders/, same convention as seed/manifest.json's
      `file` field relative to seed/. */
  file: string;
  /** One-line description for the effect browser card. */
  hint?: string;
  /**
   * Effect-specific params, in Control shape. The base `mix` control is
   * NOT declared here — every effect gets it for free, added by the
   * registry loader (see registry.ts's `toControlSchema`), so an effect
   * definition only ever lists what's unique to it.
   */
  params: Control[];
}

export interface EffectsManifest {
  version: number;
  effects: EffectDefinition[];
}

/**
 * The per-tile part. Lives on BoardItem.effects (see IMPLEMENTATION_PLAN.md
 * §6) — an ordered array, opt-in, capped at MAX_EFFECTS_PER_CHAIN.
 *
 * `id` is stable across reorder — modulation targets key off it, never off
 * array position (§7 Phase 4.96's "instance-stable modulation targeting"
 * decision). `mod` lives directly on the instance, not in a separate
 * global keyed table: this is what makes prune-on-removal automatic
 * (delete the instance, its routing goes with it, no separate cleanup
 * step to forget) and reorder-safety free (the object carries its own
 * mod state with it when the array is reordered).
 */
export interface EffectInstance {
  id: string;
  effectType: string;
  enabled: boolean;
  /** 0..1. Base control on every effect — see IMPLEMENTATION_PLAN.md §7
      Phase 4.96, confirmed non-negotiable. Not part of `params` because
      every effect has it, the same way every renderer gets BASE_CONTROLS
      merged in rather than declaring opacity itself. */
  mix: number;
  params: ParamState;
  mod: ModState;
}

export function createEffectInstance(effectType: string, defaults: ParamState): EffectInstance {
  return {
    id: crypto.randomUUID(),
    effectType,
    // Off by default — adding an effect to the chain is a distinct act
    // from applying it. Turning it on is a deliberate second step, same
    // as a DAW plugin landing on the chain bypassed until you engage it.
    enabled: false,
    mix: 1,
    params: defaults,
    mod: {},
  };
}
