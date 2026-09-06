/**
 * Visual Mood Lab — effects registry.
 *
 * Parallel to renderers/registry.ts in spirit (one place mapping an id to
 * an implementation) but resolves data, not a class: an effectType id ->
 * { definition, shader source, synthetic ControlSchema }.
 *
 * Location: lib/effects/registry.ts
 *
 * BUGFIX (post-Part-1 testing): manifest.json and the shader sources used
 * to live at repo-root `effects/`, sibling to `seed/`. That's correct for
 * `seed/` — its files are read server-side via Node `fs` at ingest time,
 * never fetched by the browser. But `getEffectShaderSource` below fetches
 * a .frag file client-side via `fetch('/effects/shaders/...')`, and
 * anything outside `public/` is invisible to that — it 404s silently
 * (`getEffectShaderSource` returns null on a non-ok response), so
 * `compiledSourceCache` never populates and `compositeEffects` quietly
 * skips the pass forever. This is why Dark Strobe toggled on and showed
 * 100% mix with zero visible effect on the canvas: the shader never
 * loaded, not a compositing or modulation bug. Moved both the manifest
 * and the shaders under `public/effects/` — one location, matching the
 * exact precedent `public/fonts/manifest.json` already set as "single
 * source of truth for both host and sandbox."
 */

import manifest from '@/public/effects/manifest.json';
import { createSchema, defaultsOf, type Control, type ControlSchema, type ParamState } from '@/renderers/control-schema';
import type { EffectDefinition, EffectsManifest } from './types';

const typedManifest = manifest as EffectsManifest;

/** The base control every effect gets for free — see EffectInstance's doc
    in types.ts for why this lives here rather than on each definition.
    Per-instance modulation routing is resolved directly against
    `${cardId}:fx:${instanceId}:${controlId}` mod-bus keys in
    lib/render/pool.ts's resolveEffectsForFrame — this schema fragment is
    reused verbatim for every instance of the same effectType and never
    bakes in a specific instance id itself. */
const MIX_CONTROL: Control = {
  id: 'mix', kind: 'slider', label: 'Mix', group: 'params',
  default: 1, min: 0, max: 1, step: 0.01, order: -1,
  modulatable: true, binding: { target: 'uniform', name: 'u_fxMix', glslType: 'float' },
};

const definitions = new Map<string, EffectDefinition>(
  typedManifest.effects.map((e) => [e.id, e]),
);

const shaderSourceCache = new Map<string, string>();

export function listEffectDefinitions(): EffectDefinition[] {
  return typedManifest.effects;
}

export function getEffectDefinition(effectType: string): EffectDefinition | undefined {
  return definitions.get(effectType);
}

/** Effect-param schema for a given effectType, mix control included. Used
    for defaultsOf()/hydrate() when an instance is first added, and as the
    base for the rack's inline control group. */
export function getEffectSchema(effectType: string): ControlSchema | null {
  const def = definitions.get(effectType);
  if (!def) return null;
  return createSchema(`effect:${effectType}`, [MIX_CONTROL, ...def.params]);
}

export function defaultEffectParams(effectType: string): ParamState {
  const schema = getEffectSchema(effectType);
  if (!schema) return {};
  const defaults = defaultsOf(schema);
  // `mix` lives on EffectInstance.mix directly, not in params — drop it
  // from the defaults blob so params stays exactly what params.<->uniform
  // binding expects, nothing more.
  delete defaults.mix;
  return defaults;
}

/**
 * Fragment shader source for an effect, fetched once and cached — same
 * "compile by source hash, never twice" spirit as GLStage.compile(), one
 * level up (this caches the fetch, GLStage still caches the compiled
 * program keyed by whatever cache key the caller passes it).
 *
 * Async because effect shader files ship as static assets under
 * effects/shaders/ (mirrors seed/shaders/ exactly) rather than bundled
 * inline — same reasoning as seed shader sources being loaded at ingest,
 * not compiled into the JS bundle.
 */
export async function getEffectShaderSource(effectType: string): Promise<string | null> {
  const cached = shaderSourceCache.get(effectType);
  if (cached) return cached;

  const def = definitions.get(effectType);
  if (!def) return null;

  const res = await fetch(`/effects/shaders/${def.file}`);
  if (!res.ok) return null;

  const source = await res.text();
  shaderSourceCache.set(effectType, source);
  return source;
}

// NOTE (VFX diagnostic pass): an earlier draft of this file had a
// `toModulationControls()` export here, documented as namespacing an
// effect instance's modulatable controls onto the asset's own schema for
// the existing ModulationPanel. That approach was superseded before
// shipping — VfxPanel.tsx renders its own per-effect ModRow directly
// instead, and pool.ts's resolveEffectsForFrame keys the mod bus off
// `${cardId}:fx:${instanceId}:${controlId}` without needing a
// concatenated control list at all (see resolveEffectsForFrame's own doc
// comment for the real mechanism). The function was dead code — zero
// call sites — and its doc described a design that was never actually
// wired up, so it's removed rather than left to mislead the next read.
