/**
 * Visual Mood Lab — per-card sound lifecycle and live binding updates.
 *
 * Stage 1 was a silent placeholder proving the pool<->audio lifecycle.
 * Stage 2 makes it real: dispatches to the arp or pad engine based on the
 * active preset, and normalizes each bound control's live value into the
 * engine's own parameter space once per frame.
 *
 * Location: lib/sound/engine.ts
 */

import type { Control, ControlSchema, ParamState, ParamValue, SoundState } from '@/renderers/control-schema';
import { getPreset } from './presets';
import type { SoundPreset } from './types';
import { ArpEngine, type ArpLiveParams } from './engines/arp';
import { PadEngine, type PadLiveParams } from './engines/pad';
import { AbstractEngine, type AbstractLiveParams } from './engines/abstract';
import { attachMeter, detachMeter } from './meter';

type ActiveEngine = ArpEngine | PadEngine | AbstractEngine;

interface TileAudioHandle {
  cardId: string;
  engine: ActiveEngine;
  preset: SoundPreset;
}

const active = new Map<string, TileAudioHandle>();

/**
 * Starts (or updates in place) a card's audio subgraph to match the given
 * SoundState. Safe to call every time soundState changes, not just once:
 * if the same preset is already running, this just pushes the new
 * key/scale/octave/volume into it rather than tearing anything down — a
 * key change shouldn't cut off a note that's currently playing. Switching
 * to a genuinely different preset (or a different engine type) does tear
 * down and rebuild, since there's no meaningful way to morph one engine
 * into another.
 */
export function startTileAudio(cardId: string, soundState: SoundState): void {
  if (!soundState.enabled) {
    stopTileAudio(cardId);
    return;
  }

  const preset = getPreset(soundState.presetId);
  if (!preset) {
    stopTileAudio(cardId);
    return;
  }

  const existing = active.get(cardId);
  if (existing && existing.preset.id === preset.id) {
    existing.engine.setSoundState(soundState);
    return;
  }

  if (existing) stopTileAudio(cardId);

  let engine: ActiveEngine;
  if (preset.engine === 'arp') {
    engine = new ArpEngine(soundState, preset);
  } else if (preset.engine === 'pad') {
    engine = new PadEngine(soundState, preset);
  } else if (preset.engine === 'abstract') {
    engine = new AbstractEngine(soundState, preset);
  } else {
    // retro-oneshot remains genuinely unbuilt — nothing to start yet for
    // a preset declaring it. (The speculative 'pluck' engine type was
    // removed from the SoundEngine union entirely rather than carried
    // here forever unbuilt — event-mode ArpEngine covered every sparse-
    // trigger case that came up across all ten tiles, including SVG
    // Particle, which was the one still-open candidate for it.)
    return;
  }

  active.set(cardId, { cardId, engine, preset });
  attachMeter(cardId, engine.outputNode);
}

/** Disconnects and forgets a card's audio subgraph. Safe to call on a card
    that was never started. */
export function stopTileAudio(cardId: string): void {
  const handle = active.get(cardId);
  if (!handle) return;
  handle.engine.dispose();
  active.delete(cardId);
  detachMeter(cardId);
}

/**
 * Called once per frame (from lib/render/pool.ts's tick loop) for every
 * focused, sound-enabled card. Reads the preset's bindings, normalizes
 * each bound control's current value against its own min/max, scales that
 * onto the binding's declared output range, and pushes the result into
 * whichever engine is running. Silently does nothing for a control kind
 * that isn't numeric (color, select, etc.) — a binding aimed at one of
 * those just never updates, rather than throwing.
 */
export function updateTileAudio(cardId: string, schema: ControlSchema, baseParams: ParamState): void {
  const handle = active.get(cardId);
  if (!handle) return;

  const live: Record<string, number> = {};

  for (const binding of handle.preset.bindings) {
    const control = schema.controls.find((c) => c.id === binding.sourceParamId);
    const raw = baseParams[binding.sourceParamId];
    if (!control || raw === undefined) continue;

    const normalized = normalizeControlValue(control, raw, binding.curve);
    if (normalized === undefined) continue;

    const [lo, hi] = binding.range;
    live[binding.target] = lo + normalized * (hi - lo);
  }

  if (handle.engine instanceof ArpEngine) {
    const patch: Partial<ArpLiveParams> = {};
    if (live.pitch !== undefined) patch.pitchBend = live.pitch;
    if (live.filterCutoff !== undefined) patch.filterCutoff = live.filterCutoff;
    if (live.gain !== undefined) patch.gainLevel = live.gain;
    if (live.noteDensity !== undefined) patch.noteDensity = live.noteDensity;
    handle.engine.update(patch);
  } else if (handle.engine instanceof PadEngine) {
    const patch: Partial<PadLiveParams> = {};
    if (live.pitch !== undefined) patch.pitch = live.pitch;
    if (live.filterCutoff !== undefined) patch.filterCutoff = live.filterCutoff;
    if (live.lfoRate !== undefined) patch.lfoRate = live.lfoRate;
    if (live.lfoDepth !== undefined) patch.lfoDepth = live.lfoDepth;
    handle.engine.update(patch);
  } else if (handle.engine instanceof AbstractEngine) {
    const patch: Partial<AbstractLiveParams> = {};
    if (live.filterCutoff !== undefined) patch.filterCutoff = live.filterCutoff;
    if (live.gain !== undefined) patch.gainLevel = live.gain;
    if (live.lfoRate !== undefined) patch.lfoRate = live.lfoRate;
    if (live.lfoDepth !== undefined) patch.lfoDepth = live.lfoDepth;
    handle.engine.update(patch);
  }
}

/**
 * Hover-gating entry point for scheduled-mode interaction-driven presets.
 * No-op for anything that isn't an ArpEngine — a pad has no concept of
 * "only sound while hovering", it's either on or off via the Sound
 * toggle — and now also a no-op for an ArpEngine whose preset declares
 * triggerMode: 'event' (graze-to-pluck presets, currently all five Field
 * Lines variants): those never run the self-scheduling loop at all, so
 * there's nothing for hover to start or stop. Their notes come from
 * pluckTileAudio() below instead.
 */
export function setTileHovering(cardId: string, hovering: boolean): void {
  const handle = active.get(cardId);
  if (!(handle?.engine instanceof ArpEngine)) return;
  if (handle.preset.triggerMode === 'event') return;
  handle.engine.setActive(hovering);
}

/**
 * Graze-to-pluck entry point. The sketch fires this itself (via
 * p.pluck(x) in the sandbox) on each line it crosses; x is normalized
 * 0..1 across the tile and becomes the note's pitch — see
 * ArpEngine.pluck(). Deliberately does NOT check triggerMode — a sketch
 * that emits pluck events is opting into this model by construction;
 * gating here would just be a second place for that decision to live,
 * out of sync with the first.
 *
 * Also forwards to an AbstractEngine running a oneShot preset (Grid
 * Snake's Arcade Drum / Digital Safari, eat-triggered) — x is discarded
 * there, since a one-shot sample has no pitch/position concept the way a
 * plucked note does; the event itself is the whole signal. Reuses
 * retrigger() rather than a separate method: it already does exactly
 * "play the one-shot now" for a oneShot preset (see AbstractEngine's own
 * retrigger() doc), so a discrete game event and the Retrigger button
 * produce identical playback by construction, not by two implementations
 * that happen to agree today.
 */
export function pluckTileAudio(cardId: string, x: number): void {
  const handle = active.get(cardId);
  if (handle?.engine instanceof ArpEngine) {
    handle.engine.pluck(x);
  } else if (handle?.engine instanceof AbstractEngine && handle.preset.oneShot) {
    handle.engine.retrigger();
  }
}

/**
 * Interaction-energy entry point (see lib/sandbox/protocol.ts's `energy`
 * doc and AbstractEngine.setEnergy()). The sketch fires this every frame
 * with its own continuous 0..1 signal — Wound Thread derives it from the
 * physics sim's own velocity, smoothed. No-op for anything that isn't an
 * AbstractEngine, same reasoning as pluckTileAudio; AbstractEngine itself
 * further no-ops unless the active preset opted in via
 * `interactionGated: true`, so a future abstract preset that wants to
 * stay a continuous ambient bed rather than being interaction-gated just
 * never calls setEnergy() at all and nothing here forces it to.
 */
export function setTileEnergy(cardId: string, value: number): void {
  const handle = active.get(cardId);
  if (handle?.engine instanceof AbstractEngine) {
    handle.engine.setEnergy(value);
  }
}

/** The Retrigger control (Stage 2 UI) calls this. */
export function retriggerTileAudio(cardId: string): void {
  active.get(cardId)?.engine.retrigger();
}

export function isTileAudioActive(cardId: string): boolean {
  return active.has(cardId);
}

/** Stop everything — used by disposeAll()-style full teardown paths. */
export function stopAllTileAudio(): void {
  for (const cardId of [...active.keys()]) stopTileAudio(cardId);
}

/** Normalizes a control's current value to 0..1 against its own min/max —
    or, for `curve: 'abs'`, against its own DISTANCE FROM ZERO, ignoring
    sign. That second mode exists for bipolar controls (spin, scanline
    motion, anything with a negative min and positive max around a
    meaningful zero) where an audio target should track how much motion
    there is, not which direction it's signed. The default linear mode
    would normalize a bipolar control's near-zero value to somewhere near
    the MIDDLE of 0..1 (0 sits in the middle of a symmetric range), which
    reads as "moderate" to whatever it drives even though the control
    itself is barely moving — exactly the bug that made SVG Particle's
    arp feel too fast at its default (near-zero) spin. `curve: 'exp'`
    keeps its original meaning (linear, then squared) for anything that
    already relied on it. Only slider/stepper controls are numeric ranges
    in the sense a sound binding can use — color/select/etc return
    undefined, and the binding that referenced them simply doesn't update
    this frame. */
function normalizeControlValue(
  control: Control,
  value: ParamValue,
  curve?: 'linear' | 'exp' | 'abs',
): number | undefined {
  if ((control.kind === 'slider' || control.kind === 'stepper') && typeof value === 'number') {
    if (curve === 'abs') {
      const extent = Math.max(Math.abs(control.min), Math.abs(control.max)) || 1;
      const n = Math.abs(value) / extent;
      return n < 0 ? 0 : n > 1 ? 1 : n;
    }
    const span = control.max - control.min;
    if (span <= 0) return 0.5;
    let n = (value - control.min) / span;
    n = n < 0 ? 0 : n > 1 ? 1 : n;
    if (curve === 'exp') n = n * n;
    return n;
  }
  return undefined;
}
