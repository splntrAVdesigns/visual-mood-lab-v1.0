import type { Modulation, ModSource } from '@/renderers/control-schema';

/**
 * Visual Mood Lab — the modulation bus.
 *
 * One clock, sampled by every live renderer on the same frame. That is the
 * whole point: three cards routed to the same LFO must move in lockstep, and
 * they only can if they read a single shared time value rather than each
 * keeping its own.
 *
 * Audio sources are declared in ModSource but deliberately not implemented
 * yet — LFOs need no permissions, no device negotiation, and no fallback
 * path, so the plumbing gets proven before a microphone prompt is added to
 * the mix. `sample()` returns a neutral 0.5 for audio sources, which reads
 * as "no modulation" rather than pinning a parameter to an extreme.
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
   */
  sample(key: string, mod: Modulation, time = this.time): number {
    const raw = this.rawSignal(mod, time);

    const smoothing = mod.smoothing ?? 0;
    if (smoothing <= 0) return raw;

    // One-pole lowpass. Cheap, stable, and enough to take the edge off a
    // square wave or sample-and-hold without adding a filter dependency.
    const prev = this.smoothed.get(key) ?? raw;
    const next = prev + (raw - prev) * (1 - smoothing);
    this.smoothed.set(key, next);
    return next;
  }

  private rawSignal(mod: Modulation, time: number): number {
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

      default:
        // Audio and MIDI sources are declared but not wired yet. 0.5 is the
        // neutral centre: applyModulation treats it as zero deviation, so an
        // unimplemented source leaves the parameter exactly where the person
        // set it instead of slamming it to a limit.
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
  /** Sources that are declared but not yet wired. Shown, but disabled. */
  pending?: boolean;
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
  { value: 'audio.rms', label: 'Audio — Level', pending: true },
  { value: 'audio.bass', label: 'Audio — Bass', pending: true },
  { value: 'audio.mid', label: 'Audio — Mid', pending: true },
  { value: 'audio.high', label: 'Audio — High', pending: true },
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
