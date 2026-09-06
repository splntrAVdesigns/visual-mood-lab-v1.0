import type { Control, Modulation, ModSource } from '@/renderers/control-schema';
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

/** How long a freshly-active routing takes to reach its full configured
    depth, in ms — see ModulationBus.applyEngageRamp()'s doc. 350ms reads
    as an intentional, smooth fade-in rather than a perceptible delay;
    short enough that a person adjusting Amount in real time still feels
    immediate, long enough to fully absorb autoGain's ~150ms attack (see
    autoGain.ts's ATTACK_PER_SECOND) plus a margin. */
const ENGAGE_RAMP_MS = 350;

/** Smoothing's "per-frame fraction toward raw" is calibrated against this
    reference rate so a given Smoothing value reads the same regardless
    of the device's actual refresh rate — see sample()'s doc. */
const SMOOTHING_REFERENCE_FPS = 60;

class ModulationBus {
  private startedAt = performance.now();
  private pointer = { x: 0.5, y: 0.5 };

  /** Smoothed values, keyed per routing, so `smoothing` has somewhere to live. */
  private smoothed = new Map<string, number>();
  /** Wall-clock time of the last sample() call for a smoothed routing —
      what makes the one-pole filter below dt-normalized rather than a
      flat per-call fraction. Only populated for routings that currently
      have smoothing > 0; see sample()'s else-branch. */
  private smoothTicks = new Map<string, number>();
  /** Wall-clock time a routing was FIRST sampled since its last forget()
      — i.e. since it was last removed/reassigned. Drives the engage-ramp
      in applyEngageRamp() below. Deliberately a separate map from
      `smoothed`/`smoothTicks`: the ramp applies to every source (LFO,
      pointer, audio, mic), not only smoothed ones. */
  private engaged = new Map<string, number>();

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
   *
   * Two shaping stages happen here, in order:
   *  1. Optional one-pole smoothing (`mod.smoothing`), now dt-normalized
   *     — see the fraction-per-second comment below. Previously this was
   *     a flat `(1 - smoothing)` fraction applied once per call, which
   *     made a given Smoothing value smooth roughly twice as slowly on a
   *     30fps device as on 60fps, and twice as fast on 120fps. Every
   *     other rate-like constant in this codebase (autoGain.ts's
   *     ATTACK_PER_SECOND/BASELINE_CONVERGE_PER_SECOND, meter.ts's
   *     DECAY_PER_SECOND) is already expressed as a per-second rate
   *     scaled by measured `dt` for exactly this reason; this brings
   *     smoothing in line with that convention instead of being the one
   *     outlier.
   *  2. The engage-ramp (applyEngageRamp), which runs unconditionally —
   *     including when smoothing is 0 — since it fixes a different
   *     problem: a routing with NO history yet (just assigned, or a
   *     track that just started playing) jumping straight to its full
   *     configured Amount on the very first frame it's read, regardless
   *     of how volatile the underlying source is. See that method's doc.
   */
  sample(key: string, mod: Modulation, cardId: string, time = this.time): number {
    const raw = this.rawSignal(mod, time, cardId);
    const now = performance.now();

    const smoothing = mod.smoothing ?? 0;
    let shaped = raw;

    if (smoothing > 0) {
      const lastTick = this.smoothTicks.get(key) ?? now;
      const dt = Math.max(0, (now - lastTick) / 1000);
      this.smoothTicks.set(key, now);

      // One-pole lowpass. `stepAt60` is the fraction-per-call this used
      // to move at unconditionally; scaling it into a per-second rate
      // and re-applying it against measured `dt` reproduces the exact
      // same feel at 60fps while correctly tracking real time at any
      // other refresh rate.
      const prev = this.smoothed.get(key) ?? raw;
      const stepAt60 = 1 - smoothing;
      const ratePerSecond = stepAt60 * SMOOTHING_REFERENCE_FPS;
      const frac = Math.min(1, ratePerSecond * dt);
      shaped = prev + (raw - prev) * frac;
      this.smoothed.set(key, shaped);
    } else {
      // Not smoothing this routing right now — drop any stale filter
      // state so a routing that had smoothing turned off, then back on
      // later, doesn't resume from a long-cold `prev` value as if no
      // time had passed.
      this.smoothed.delete(key);
      this.smoothTicks.delete(key);
    }

    return this.applyEngageRamp(key, shaped, now);
  }

  /**
   * Fades a routing in from neutral (0.5 — "no modulation") up to its
   * full shaped value over ENGAGE_RAMP_MS, starting from the first
   * sample() call this routing has had since it was last forget()'d.
   *
   * This is the general fix for "toggling a source on causes a visible
   * jump," not an audio-specific patch: the same zero-ramp-time gap
   * exists for a brand new LFO assignment landing mid-cycle, a pointer
   * routing whose first read happens far from center, etc. — audio/mic
   * sources just make it most visible, because autoGain.ts's own attack
   * (already fast, ~150ms) had nothing above it absorbing the very first
   * moment of a signal existing at all. Ramping the DEVIATION from 0.5
   * (rather than fading `raw` itself toward some target) is deliberate:
   * a source could start already off-center, and this still guarantees
   * zero net motion on the control at t=0, opening smoothly to whatever
   * the real signal is doing by ENGAGE_RAMP_MS in.
   *
   * Engagement state is per-key and cleared by forget()/reset(), so
   * removing a routing and reassigning it later re-runs the ramp rather
   * than resuming as if it had been active the whole time.
   */
  private applyEngageRamp(key: string, signal: number, now: number): number {
    let startedAt = this.engaged.get(key);
    if (startedAt === undefined) {
      startedAt = now;
      this.engaged.set(key, now);
    }

    const t = Math.min(1, (now - startedAt) / ENGAGE_RAMP_MS);
    if (t >= 1) return signal;

    // Smoothstep rather than linear — eases both into and out of the
    // ramp, which reads as an intentional fade rather than a ramp with a
    // visible kink at either end.
    const eased = t * t * (3 - 2 * t);
    return 0.5 + (signal - 0.5) * eased;
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

  /** Drops smoothing AND engage-ramp state for a routing that no longer
      exists — clearing `engaged` here is what makes reassigning the same
      control later re-run the fade-in rather than resuming mid-ramp or
      skipping it entirely. */
  forget(key: string): void {
    this.smoothed.delete(key);
    this.smoothTicks.delete(key);
    this.engaged.delete(key);
  }

  reset(): void {
    this.startedAt = performance.now();
    this.smoothed.clear();
    this.smoothTicks.clear();
    this.engaged.clear();
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

/* ------------------------------------------------------------------ *
 * Assignment defaults — the sensible-starting-point policy for a
 * routing, used by both the manual assign path (ModulationPanel's
 * ModRow) and the auto-assign convenience helpers (SoundPanel's
 * autoAssignTrackModulation/autoAssignMicModulation). Centralized here
 * rather than as separate literals in each call site, per the
 * modulation diagnostic (2026-09), fixes #4–#6: previously each site
 * hardcoded its own amount/smoothing/target-picking logic, which is how
 * "manually assigned Audio keeps smoothing=0 unless it goes through
 * auto-assign" and "auto-assign blindly grabs whatever's first in
 * schema order, including wide-range controls like Scale" both
 * happened — two different symptoms of the same root cause: no single
 * place decided what a sensible default actually was.
 * ------------------------------------------------------------------ */

/** A slider/stepper's declared range width; effectively infinite (never
    the "safest" choice) for any other control kind, so callers that
    compare spans naturally deprioritize non-numeric controls without a
    separate type check at every call site. */
function controlSpan(control: Control): number {
  if (control.kind === 'slider' || control.kind === 'stepper') {
    return control.max - control.min;
  }
  return Infinity;
}

/** Baseline amount for a brand-new routing on a "typical" 0..1-span
    control (Opacity, Tint amount, and similar) — matches what DEFAULT_MOD
    and the pre-fix auto-assign literals already used, so a control this
    size behaves exactly as it did before this pass. */
const REFERENCE_SPAN = 1;
const BASE_DEFAULT_AMOUNT = 0.3;
/** Default amount is never pushed below/above these regardless of how
    extreme a control's span is — a hard floor so an enormous-range
    control still visibly reacts at all, and a ceiling so a tiny-range
    control's inverse-scaled amount doesn't blow past what the Amount
    slider's own -1..1 UI range treats as "a lot." */
const MIN_DEFAULT_AMOUNT = 0.05;
const MAX_DEFAULT_AMOUNT = 0.5;

/**
 * Fix #5 (targeted version — see the diagnostic's own note that this is
 * the lower-risk sibling of rescaling applyModulation()'s core formula):
 * rather than changing how amount is APPLIED — which would silently
 * re-scale every already-tuned routing across the whole seed library —
 * this only changes what amount a FRESH, never-before-configured routing
 * starts at. A control's default amount scales inversely with its own
 * range, so "Scale" (min 0.1, max 4 — span 3.9, and log-mapped, which
 * makes a given linear excursion read as an even bigger relative jump
 * near the low end) starts out visibly gentler than "Opacity" (span 1)
 * does for the exact same nominal starting point, instead of both
 * defaulting to the same flat 0.3-0.35 regardless of how different those
 * two controls' absolute ranges actually are. Amount is still a fully
 * user-adjustable dial afterward — this only picks where it starts.
 */
export function defaultAmountFor(control: Control): number {
  const span = controlSpan(control);
  if (!Number.isFinite(span) || span <= 0) return BASE_DEFAULT_AMOUNT;
  const scaled = BASE_DEFAULT_AMOUNT * (REFERENCE_SPAN / span);
  return clampAmount(scaled);
}

function clampAmount(n: number): number {
  return n < MIN_DEFAULT_AMOUNT ? MIN_DEFAULT_AMOUNT : n > MAX_DEFAULT_AMOUNT ? MAX_DEFAULT_AMOUNT : n;
}

/**
 * Fix #4: a source-aware smoothing default, replacing the two separate
 * hardcoded values SoundPanel.tsx's auto-assign helpers used to carry
 * (0.25 for audio.rms, 0 — unchanged — for mic.rms) and the flat 0 every
 * OTHER assignment path (including a manual Source-dropdown switch) fell
 * back to regardless of source. LFO/time/pointer sources stay at 0 — see
 * the per-source audit in the modulation diagnostic: those signals are
 * already smooth and bounded, so added smoothing would only add latency
 * with no real benefit. Mic gets a slightly higher default than Track
 * (0.3 vs 0.25): a live mic feed has no mastering/compression behind it
 * the way a track typically does, so its raw band values are the
 * noisier of the two inputs feeding the identical autoGain shaping (see
 * autoGain.ts) — the smoothing value itself became a much more
 * meaningful lever once bus.ts's own smoothing filter was made
 * dt-normalized (fix #3), rather than the ~50ms-at-60fps no-op the flat
 * 0.25 amounted to before that fix.
 */
export function defaultSmoothingFor(source: ModSource): number {
  if (source.startsWith('mic.')) return 0.3;
  if (source.startsWith('audio.')) return 0.25;
  return 0;
}

/**
 * Fix #6: replaces "whatever happens to be first in the schema's
 * declared control order" as the last-resort auto-assign target with
 * "whichever eligible control has the smallest declared range." A
 * narrower span is inherently the gentler, safer thing to hand an
 * always-on reactive source (Audio/Mic) — it's the same underlying
 * property defaultAmountFor() above compensates for, just used here to
 * pick a target instead of to scale an amount. Deliberately span-based
 * rather than a name-based denylist (excluding anything matching
 * /scale|zoom|position/i or similar): a keyword list only ever covers
 * the control names someone thought to add to it, and silently misses
 * the next wide-range control some future tile happens to call
 * something else. Ties keep the first-encountered control, preserving
 * existing behavior when every candidate is equally suitable.
 */
export function pickSafestModulationTarget(controls: Control[]): Control | undefined {
  if (controls.length === 0) return undefined;
  return controls.reduce((safest, c) => (controlSpan(c) < controlSpan(safest) ? c : safest));
}

/* ------------------------------------------------------------------ */

let bus: ModulationBus | null = null;

export function getModBus(): ModulationBus {
  if (!bus) bus = new ModulationBus();
  return bus;
}

export type { ModulationBus };
