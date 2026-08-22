import type { Modulation, ModSource } from '@/renderers/control-schema';
import { getTrackBand, type TrackBand } from '@/lib/sound/track';
import { getMicBand, type MicBand } from '@/lib/sound/mic';

/**
 * Visual Mood Lab — the modulation bus.
 *
 * One clock, sampled by every live renderer on the same frame. That is the
 * whole point: three cards routed to the same LFO must move in lockstep, and
 * they only can if they read a single shared time value rather than each
 * keeping its own.
 *
 * Audio sources (Phase 4.9) are one exception to "every card reads the
 * same value from the same source" above: each `audio.*` source is
 * resolved PER CARD, against that card's own uploaded track
 * (lib/sound/track.ts), not a single board-wide feed. Two cards routed to
 * `audio.bass` react to two different tracks, or one reacts and the other
 * doesn't, depending on what's loaded on each. That's why `sample()` and
 * `rawSignal()` both take a `cardId` — every non-audio, non-mic source
 * ignores it.
 *
 * mic.* sources (Phase 4.9.2) are the OPPOSITE exception: unlike audio.*,
 * every card reading a mic.* source DOES read the same value, because
 * there is only one physical microphone — lib/sound/mic.ts holds one
 * shared stream for the whole app, not one per card (see that file's top
 * doc). `cardId` is still threaded through to getMicBand() for interface
 * symmetry with getTrackBand() and so a future per-card mic gain/mute
 * could be added without changing this call site again, but the current
 * implementation ignores it.
 *
 * A card with no track loaded, or with Mic not enabled anywhere, still
 * resolves to the neutral 0.5 ("no modulation") that audio, mic, and MIDI
 * sources all returned before this file changed, so nothing about a
 * routing set up on a track-less/mic-disabled card is different from
 * before.
 *
 * midi.cc remains genuinely unimplemented — no device negotiation exists
 * yet — so it alone still carries `pending: true` in MOD_SOURCES below.
 *
 * Location: lib/modulation/bus.ts
 */

const TAU = Math.PI * 2;

export interface ModContext {
  /** Seconds since the bus started. */
  time: number;
  /** Normalised pointer position over the board, 0..1. */
  pointer: { x: number; y: number };
}

class ModulationBus {
  private startedAt = performance.now();
  private pointer = { x: 0.5, y: 0.5 };

  /** Smoothed values, keyed per routing, so `smoothing` has somewhere to live. */
  private smoothed = new Map<string, number>();

  get time(): number {
    return (performance.now() - this.startedAt) / 1000;
  }

  setPointer(x: number, y: number): void {
    this.pointer = { x, y };
  }

  /**
   * Sample a routing at the current time. Always returns 0..1 — the caller
   * (applyModulation) maps that onto the control's own range, so a source
   * never needs to know anything about what it is driving.
   *
   * `cardId` is only consulted for `audio.*` sources (see the class doc)
   * — every existing call site already has it in scope as part of `key`
   * (`${cardId}:${controlId}`), so this is a second explicit parameter
   * rather than parsing it back out of the string.
   */
  sample(key: string, mod: Modulation, cardId: string, time = this.time): number {
    const raw = this.rawSignal(mod, time, cardId);

    const smoothing = mod.smoothing ?? 0;
    if (smoothing <= 0) return raw;

    // One-pole lowpass. Cheap, stable, and enough to take the edge off a
    // square wave or sample-and-hold without adding a filter dependency.
    const prev = this.smoothed.get(key) ?? raw;
    const next = prev + (raw - prev) * (1 - smoothing);
    this.smoothed.set(key, next);
    return next;
  }

  private rawSignal(mod: Modulation, time: number, cardId: string): number {
    const rate = mod.rate ?? 0.5;
    const phase = time * rate;

    switch (mod.source) {
      case 'time':
        // A continuously rising ramp that wraps — useful for rotation and
        // anything that should travel rather than oscillate.
        return frac(phase);

      case 'lfo.sine':
        return 0.5 + 0.5 * Math.sin(phase * TAU);

      case 'lfo.triangle':
        return Math.abs(frac(phase) * 2 - 1);

      case 'lfo.saw':
        return frac(phase);

      case 'lfo.noise':
        return valueNoise(phase);

      case 'pointer.x':
        return this.pointer.x;

      case 'pointer.y':
        return this.pointer.y;

      case 'audio.rms':
      case 'audio.bass':
      case 'audio.mid':
      case 'audio.high': {
        const band = mod.source.slice('audio.'.length) as TrackBand;
        const value = getTrackBand(cardId, band);
        // null (not 0) means "this card has no track loaded" — 0.5 is the
        // same neutral centre every unimplemented/inactive source falls
        // back to, so a routing set up before a track is uploaded just
        // sits inert rather than reading as silence.
        return value ?? 0.5;
      }

      case 'mic.rms':
      case 'mic.bass':
      case 'mic.mid':
      case 'mic.high': {
        const band = mod.source.slice('mic.'.length) as MicBand;
        // cardId is threaded through for interface symmetry with
        // getTrackBand() (see this file's top doc) — the shared mic
        // implementation doesn't currently use it.
        const value = getMicBand(band);
        // null (not 0) means "Mic isn't enabled anywhere" — same neutral-
        // centre fallback as audio.* above, for the same reason.
        return value ?? 0.5;
      }

      default:
        // midi.cc only, at this point — genuinely unimplemented, no device
        // negotiation exists yet. Same neutral-centre fallback.
        return 0.5;
    }
  }

  /** Drops smoothing state for a routing that no longer exists. */
  forget(key: string): void {
    this.smoothed.delete(key);
  }

  reset(): void {
    this.startedAt = performance.now();
    this.smoothed.clear();
  }
}

function frac(n: number): number {
  return n - Math.floor(n);
}

/** Smoothly interpolated value noise. Deterministic for a given phase. */
function valueNoise(x: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return lerp(hash(i), hash(i + 1), u);
}

function hash(n: number): number {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return s - Math.floor(s);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/* ------------------------------------------------------------------ *
 * Source metadata — drives the assignment menu
 * ------------------------------------------------------------------ */

export interface ModSourceOption {
  value: ModSource;
  label: string;
  /** Sources that are declared but not yet wired AT ALL, for anyone. Shown,
      but disabled, with no per-card escape — currently just midi.cc. This
      is distinct from `requiresTrack` below: an audio.* source is fully
      wired, just conditionally inert until that specific card has
      something to analyse. */
  pending?: boolean;
  /** Only meaningful for audio.* sources. The caller (ModulationPanel)
      disables the option per-card when the open card has no track loaded,
      using a different, more specific label ("— load a track") than
      `pending`'s "— soon" — see useTrackLoaded in lib/hooks/useTrackState.
      Kept as metadata here rather than hardcoding the four audio values
      at the call site, same reasoning as `hasRate` below. */
  requiresTrack?: boolean;
  /** Only meaningful for mic.* sources. Same mechanism as requiresTrack
      above, gated on useMicEnabled instead — disables the option with
      "— enable mic" until Mic is actually on for the open card. Gated
      per-card even though the underlying stream is shared app-wide (see
      lib/sound/mic.ts's top doc): a routing on a card that's never
      turned Mic on should still read as unavailable, not silently active
      because some OTHER card happens to have it enabled. */
  requiresMic?: boolean;
  /** Whether a rate control is meaningful for this source. */
  hasRate?: boolean;
}

export const MOD_SOURCES: ModSourceOption[] = [
  { value: 'lfo.sine', label: 'LFO — Sine', hasRate: true },
  { value: 'lfo.triangle', label: 'LFO — Triangle', hasRate: true },
  { value: 'lfo.saw', label: 'LFO — Saw', hasRate: true },
  { value: 'lfo.noise', label: 'LFO — Noise', hasRate: true },
  { value: 'time', label: 'Time ramp', hasRate: true },
  { value: 'pointer.x', label: 'Pointer X' },
  { value: 'pointer.y', label: 'Pointer Y' },
  { value: 'audio.rms', label: 'Audio — Level', requiresTrack: true },
  { value: 'audio.bass', label: 'Audio — Bass', requiresTrack: true },
  { value: 'audio.mid', label: 'Audio — Mid', requiresTrack: true },
  { value: 'audio.high', label: 'Audio — High', requiresTrack: true },
  { value: 'mic.rms', label: 'Mic — Level', requiresMic: true },
  { value: 'mic.bass', label: 'Mic — Bass', requiresMic: true },
  { value: 'mic.mid', label: 'Mic — Mid', requiresMic: true },
  { value: 'mic.high', label: 'Mic — High', requiresMic: true },
  { value: 'midi.cc', label: 'MIDI CC', pending: true },
];

export function sourceMeta(source: ModSource): ModSourceOption | undefined {
  return MOD_SOURCES.find((s) => s.value === source);
}

/* ------------------------------------------------------------------ */

let bus: ModulationBus | null = null;

export function getModBus(): ModulationBus {
  if (!bus) bus = new ModulationBus();
  return bus;
}

export type { ModulationBus };
