/**
 * Visual Mood Lab — LFO rate divisions.
 *
 * Sibling to bus.ts, one level narrower: bus.ts owns the shared clock and
 * how a source's raw signal is generated; this owns only the RATE
 * vocabulary — the button-strip of musical-feeling divisions (1/1..1/16)
 * plus a free Hz value — that both ModulationPanel's Rate control and any
 * sound-engine target riding the same routing present to the person.
 *
 * There is no global tempo/BPM concept anywhere in this app (see
 * ArpEngine's own PLUCK_INTERVAL comment for the same reasoning applied to
 * note timing) — so "1/1" here is NOT beat-synced to anything real. It's
 * an honest, self-contained ladder: 1/1 is one full LFO cycle every
 * REFERENCE_PERIOD_S seconds, and each further division halves that
 * period, mirroring the standard DAW note-division convention's SHAPE
 * (a doubling ladder) without pretending there's a transport clock behind
 * it. A person who's used a tempo-synced LFO before will recognize the
 * pattern immediately; nothing here claims to be locked to a beat.
 *
 * Kept separate from bus.ts on purpose, per the plan that put it here:
 * this module has no dependency on AudioContext, the render pool, or
 * SoundState — it's pure rate math, safe to import from UI code, engine
 * code, or a future Phase 4 shared-clock rewrite without dragging
 * anything else along.
 *
 * Location: lib/modulation/lfo.ts
 */

export type LfoRateDivision = '1/1' | '1/2' | '1/4' | '1/8' | '1/16' | 'hz';

/** The "1/1" period, in seconds. 4s reads as a slow, deliberate breathing
    pulse — slow enough to feel musical rather than jittery, and it centers
    the five fixed divisions (0.25..4Hz) comfortably inside both
    ModulationPanel's existing 0.01-8Hz rate slider and PadEngine's
    tremolo range (0.1-7.9Hz), so nothing here can ask either consumer for
    a rate it can't actually reach. */
const REFERENCE_PERIOD_S = 4;

export const RATE_DIVISIONS: Array<{ value: LfoRateDivision; label: string }> = [
  { value: '1/1', label: '1/1' },
  { value: '1/2', label: '1/2' },
  { value: '1/4', label: '1/4' },
  { value: '1/8', label: '1/8' },
  { value: '1/16', label: '1/16' },
  { value: 'hz', label: 'Hz' },
];

/** Free-Hz mode's own slider bounds — matches ModulationPanel's prior bare
    rate slider (0.01-8Hz) closely enough that nothing already-saved falls
    outside the new control's range. */
export const CUSTOM_HZ_MIN = 0.01;
export const CUSTOM_HZ_MAX = 8;

/** Fraction denominator for each fixed division, used only to derive its
    Hz below — 1/1 = 1/REFERENCE_PERIOD_S Hz, 1/2 doubles that, etc. */
const DIVISION_MULTIPLIER: Record<Exclude<LfoRateDivision, 'hz'>, number> = {
  '1/1': 1,
  '1/2': 2,
  '1/4': 4,
  '1/8': 8,
  '1/16': 16,
};

/** How close (relative) a raw Hz value has to be to a fixed division's Hz
    to be considered "that division" for display purposes — see
    hzToDivision. Generous enough to survive float round-tripping through
    persisted JSON, tight enough that two adjacent divisions (0.25/0.5Hz,
    an octave apart) never both match. */
const DIVISION_MATCH_TOLERANCE = 0.02;

/** Resolves a rate selection to the Hz value the modulation bus (or a
    sound engine reading the same routing) should actually use. A fixed
    division always resolves to its own exact Hz, ignoring customHz — the
    two are mutually exclusive, not layered. */
export function divisionToHz(division: LfoRateDivision, customHz: number): number {
  if (division === 'hz') {
    return clamp(customHz, CUSTOM_HZ_MIN, CUSTOM_HZ_MAX);
  }
  return DIVISION_MULTIPLIER[division] / REFERENCE_PERIOD_S;
}

/** Reverse lookup for display: given a persisted Hz value (which is all
    Modulation.rate / a sound routing actually stores — see the module doc
    for why there's no separate "division" field to persist), which button
    should read as active? Falls back to 'hz' for anything that isn't
    close enough to one of the five fixed points, which is exactly right
    for a value the person dialed in on the Hz slider themselves. */
export function hzToDivision(hz: number): LfoRateDivision {
  for (const [division, multiplier] of Object.entries(DIVISION_MULTIPLIER) as Array<
    [Exclude<LfoRateDivision, 'hz'>, number]
  >) {
    const target = multiplier / REFERENCE_PERIOD_S;
    if (Math.abs(hz - target) / target <= DIVISION_MATCH_TOLERANCE) return division;
  }
  return 'hz';
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}
