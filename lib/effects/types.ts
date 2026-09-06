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

// 'texture' and 'feedback' added for the Tier 1+2 batch (Grain, CRT;
// Turbulent Feedback respectively). 'slice' was already reserved — see
// its own FAMILY_ORDER comment in VfxPanel.tsx — and now has its first
// member, Graphic Slice.
export type EffectFamily = 'strobe' | 'color' | 'mirror' | 'warp' | 'slice' | 'texture' | 'feedback';

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
   * Phase 4.96 — per-effect identity color in the browse list and, once
   * added to a chain, the row's own label text. Deliberately optional,
   * not universal: Dark Strobe has none and falls back to a neutral gray
   * in the render layer — "vibes with the name" per direct instruction,
   * and it's also the one effect that's temporal rather than a color/
   * spatial transform, so it reads correctly as the odd one out rather
   * than an oversight. Kept muted, not neon, and picked to sit clearly
   * apart from `--accent` (cyan) — this app's one existing accent color
   * means "focused/active" everywhere else, and introducing five bright
   * per-effect colors that could be confused with that would undercut a
   * rule the rest of the UI depends on, not just add color.
   */
  accentColor?: string;
  /**
   * Whether this effect treats the shared echo/feedback buffer
   * (lib/gl/effects-compositor.ts's echoCanvases + u_echoBuffer) as
   * something it needs maintained while active. Added for the Tier 1+2
   * batch alongside Turbulent Feedback, the buffer's second consumer —
   * see compositeEffectsUnsafe's `usesEcho` computation for exactly how
   * this is read. Dark Strobe is a special case kept for backward
   * compatibility: it declares `usesEcho: true` here but is ADDITIONALLY
   * gated on its own `echo` param being above 0, so switching Echo to 0
   * still costs nothing extra, same as before this field existed. Any
   * other effect that sets this true is treated as needing the buffer
   * whenever the instance itself is enabled — the buffer isn't an
   * optional bonus knob for those effects, it's load-bearing to the look.
   */
  usesEcho?: boolean;
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
