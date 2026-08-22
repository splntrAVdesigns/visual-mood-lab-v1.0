/**
 * Visual Mood Lab — arp/chime sound engine.
 *
 * Schedules discrete plucked notes at a rate driven by the tile's own
 * live parameters. Each note: oscillator -> short percussive envelope ->
 * shared filter -> gain -> master. Field Lines is the Stage 2 proof of
 * concept for this engine.
 *
 * Location: lib/sound/engines/arp.ts
 */

import { getAudioContext, getMasterGain } from '../context';
import { buildNotePool } from '../theory';
import type { SoundState } from '@/renderers/control-schema';
import type { SoundPreset } from '../types';

/** 0..1, normalized live-bound values — the pool recomputes these every
    frame from the asset's real param values and calls update(). */
export interface ArpLiveParams {
  pitchBend: number;
  filterCutoff: number;
  gainLevel: number;
  /** Scheduled mode: notes/sec, via scheduleNext()'s own mapping. Event
      mode: interpolates the pluck rate-limit floor between
      PLUCK_INTERVAL_MAX_MS (0) and PLUCK_INTERVAL_MIN_MS (1) — see
      pluck(). Both readings are "how busy should this instrument be
      allowed to get," just applied to whichever trigger model is active;
      a preset only ever uses one of the two at a time. */
  noteDensity: number;
}

const DEFAULT_LIVE: ArpLiveParams = {
  pitchBend: 0.5,
  filterCutoff: 0.5,
  gainLevel: 0.5,
  noteDensity: 0.5,
};

/**
 * Floor between two plucks, at the loosest (noteDensity → 0) and
 * tightest (noteDensity → 1) ends of its range — see pluck(). Fixed
 * bounds rather than tempo-synced, same reasoning as before there was a
 * range at all: no global tempo concept exists here, so this is the
 * honest implementation of "roughly a 16th-note gap," now a dial instead
 * of a single point. Coupling this to noteDensity (bound to the grid
 * Density control on three of the five Field Lines presets) means a
 * denser grid — which naturally grazes more lines per unit of cursor
 * movement — gets a looser floor to match, instead of the rate limiter
 * silently swallowing an increasing fraction of its grazes as density
 * climbs. A preset that doesn't bind anything to noteDensity just sits at
 * the DEFAULT_LIVE midpoint, unaffected.
 */
const PLUCK_INTERVAL_MAX_MS = 160;
const PLUCK_INTERVAL_MIN_MS = 50;

/** How many scale degrees the pluck's x-axis spans, left to right. Roughly
    2-3 octaves depending on the active scale's step count — wide enough to
    feel like a real instrument across the tile without going shrill at the
    right edge. */
const PLUCK_DEGREE_SPAN = 15;

/**
 * Humanize magnitudes. Deliberately modest across the board — the goal is
 * "not perfectly machine-quantized," not "loose and sloppy." Applied
 * identically regardless of which trigger model produced a given note
 * (see triggerNote), since both read the same synthesis path.
 */
const HUMANIZE_DETUNE_CENTS = 6;
const HUMANIZE_VELOCITY_JITTER = 0.12;
/** Scheduled mode only — see scheduleNext(). */
const HUMANIZE_SCHEDULE_TIMING_JITTER_MS = 15;
/** Event mode only, and much smaller than the scheduled figure above —
    see pluck(). A pluck is already tied to a live gesture; a large delay
    here would read as lag, not feel. */
const HUMANIZE_PLUCK_TIMING_JITTER_MS = 10;

/**
 * Swing ratio added to every other scheduled note's delay — a gentle
 * shuffle, not full triplet swing. Scheduled mode only: pluck's notes come
 * from the cursor grazing a line, not a fixed grid, so there is nothing to
 * swing them against. Structurally this never runs for an event-mode
 * preset anyway, since scheduleNext() only ever executes after
 * setActive(true), and setTileHovering() (engine.ts) already refuses to
 * call that for a triggerMode: 'event' preset — no separate guard needed
 * here for that case.
 */
const SWING_RATIO = 0.18;

export class ArpEngine {
  private ctx = getAudioContext();
  private filter: BiquadFilterNode;
  private gain: GainNode;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private degree = 0;
  private disposed = false;
  /** Field Lines only makes sound while the cursor is actually engaging
      the tile — see the pool-side hover gating this responds to. Starts
      false: Sound being toggled on doesn't mean playing immediately,
      hovering does. */
  private active = false;
  private soundState: SoundState;
  private preset: SoundPreset;
  private live: ArpLiveParams = { ...DEFAULT_LIVE };
  /** Timestamp (performance.now()) of the last pluck() that actually
      produced a note, for the min-interval rate limit. Deliberately
      separate from the scheduled loop's own timing — a preset uses one
      trigger model or the other, never both, so there's no cross-talk to
      worry about. */
  private lastPluckAt = 0;
  /** Ascending frequencies contributed by every selected note's scale —
      see buildNotePool(). Cached rather than rebuilt per note because it
      only changes when the user edits the selection, while plucks can
      arrive many times a second. Invalidated in setSoundState(). */
  private notePool: number[] = [];
  /** Alternates 0/1 each scheduled note, for swing — see scheduleNext(). */
  private beatParity: 0 | 1 = 0;
  /** Same idea, separate counter, for pluck-mode swing — see pluck().
      Kept independent of beatParity since a preset only ever uses one
      trigger model at a time, but the two counters shouldn't share state
      just because they happen to serve the same knob. */
  private pluckParity: 0 | 1 = 0;

  constructor(soundState: SoundState, preset: SoundPreset) {
    this.soundState = soundState;
    this.preset = preset;
    this.filter = this.ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 1500;

    this.gain = this.ctx.createGain();
    this.gain.gain.value = soundState.volume;

    this.filter.connect(this.gain);
    this.gain.connect(getMasterGain());
    this.rebuildNotePool();
    // Deliberately NOT calling scheduleNext() here — see setActive().
  }

  /** The pool is a pure function of notes/scale/octave, so it's rebuilt
      only when those change rather than on every note. */
  private rebuildNotePool(): void {
    this.notePool = buildNotePool(
      this.soundState.notes,
      this.soundState.scale,
      this.soundState.octave,
      PLUCK_DEGREE_SPAN,
    );
  }

  /** The hover-gating hook: true while the pointer is over this tile,
      false otherwise. Starting the schedule loop only on activation (and
      stopping it on deactivation) is what makes this an instrument you
      play rather than a switch you flip. */
  setActive(active: boolean): void {
    if (active === this.active) return;
    this.active = active;
    if (active) {
      this.scheduleNext();
    } else if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private scheduleNext(): void {
    if (this.disposed || !this.active) return;
    // Was a flat 2..12 notes/sec — even the floor read as too fast for a
    // preset whose bound control sits near its own resting/near-zero
    // point (SVG Particle's spin, barely turning by default). Widened to
    // 0.6..12: still caps at the same energetic top end for anything that
    // wants it, but now actually reaches "one note every second and a
    // half" territory at the low end instead of never going below 2/sec
    // regardless of how still the visual actually looks.
    const notesPerSec = 0.6 + this.live.noteDensity * 11.4;
    let delayMs = 1000 / notesPerSec;

    // Swing: every other note lands a little late — the classic
    // straight-into-shuffled feel. Alternates regardless of density, so
    // it stays audible as "swung" rather than "occasionally late" at any
    // tempo this maps to.
    if (this.soundState.swing) {
      if (this.beatParity === 1) delayMs += delayMs * SWING_RATIO;
      this.beatParity = this.beatParity === 0 ? 1 : 0;
    }

    // Humanize timing: a little random wobble around the computed
    // interval. Capped rather than proportional, so it reads as a
    // consistent human touch at both slow and fast note densities rather
    // than swamping an already-tight interval at high density.
    if (this.soundState.humanize) {
      const jitter = (Math.random() * 2 - 1) * HUMANIZE_SCHEDULE_TIMING_JITTER_MS;
      delayMs = Math.max(20, delayMs + jitter);
    }

    this.timer = setTimeout(() => {
      this.playNote();
      this.scheduleNext();
    }, delayMs);
  }

  /** The actual synthesis: one oscillator, one percussive envelope, at a
      caller-supplied frequency. Shared by both trigger models — the
      scheduled loop and pluck() differ only in how they pick freq, not in
      how a note sounds once triggered. */
  private triggerNote(freq: number, accent = 1): void {
    const now = this.ctx.currentTime;

    // Humanize: a few cents of random detune and a little velocity
    // variance per note, on top of whatever timing jitter/swing already
    // happened upstream (scheduleNext, pluck). Exact scale degrees still
    // land on the right pitch class — this just keeps every hit from
    // sounding like a sample played back identically.
    const detuneCents = this.soundState.humanize
      ? (Math.random() * 2 - 1) * HUMANIZE_DETUNE_CENTS
      : 0;
    const actualFreq = detuneCents !== 0 ? freq * Math.pow(2, detuneCents / 1200) : freq;
    const velocityJitter = this.soundState.humanize
      ? 1 + (Math.random() * 2 - 1) * HUMANIZE_VELOCITY_JITTER
      : 1;

    const osc = this.ctx.createOscillator();
    // Falls back to 'triangle' — the only shape that existed before this
    // field, so every existing arp preset (Field Lines, and the four
    // Cursor Ripple presets that predate this) sounds exactly as it did.
    // Mirrors PadEngine.addVoice()'s identical fallback pattern for its
    // own oscType, just applied to a plucked note instead of a sustained
    // voice.
    osc.type = this.preset.oscType ?? 'triangle';
    osc.frequency.value = actualFreq;

    // Short percussive envelope — a pluck, not a sustained tone.
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(0.9 * velocityJitter * accent, now + 0.008);
    env.gain.exponentialRampToValueAtTime(0.001, now + 0.28);

    this.filter.frequency.setTargetAtTime(200 + this.live.filterCutoff * 4200, now, 0.05);
    this.gain.gain.setTargetAtTime(this.targetGain(), now, 0.05);

    osc.connect(env);
    env.connect(this.filter);
    osc.start(now);
    osc.stop(now + 0.3);
    osc.onended = () => {
      osc.disconnect();
      env.disconnect();
    };
  }

  /** Scheduled-mode pitch selection: steps up the merged note pool,
      offset by pitchBend, wrapping at the top. Reads the same pool the
      pluck path does, so a multi-note selection widens both trigger
      models identically rather than only mattering for one.
      pitchBend - 0.5, matching pluck()'s already-correct pattern below —
      NOT the previous `pitchBend * 14`, which put ZERO shift at
      pitchBend=0 rather than at pitchBend=0.5 (the actual unbound
      default, and the resting point any binding's own range midpoint
      sits at when it isn't actively pulling one direction). At the
      default, unbound value that meant this always offset SEVEN whole
      degrees up by default — for a 5-7 note scale, over a full octave
      sharp of the selected note, always, silently, for any scheduled-
      mode preset that didn't happen to bind pitch specifically to
      compensate. Centering here the same way pluck() already does
      fixes that, and also fixes why several presets sharing this trigger
      mode read as barely distinguishable — a pitch binding's actual
      sweep was a small wobble on top of a large constant bias, not the
      dominant effect it was supposed to be. */
  private playNote(): void {
    if (this.disposed || this.notePool.length === 0) return;
    const degreeOffset = Math.round((this.live.pitchBend - 0.5) * 14);
    // degreeOffset can now be negative (pitchBend below its 0.5 center) —
    // JS's % returns a negative result for a negative left operand, which
    // would index the array out of bounds (returning undefined, not
    // wrapping). The double-modulo is the standard fix, same pattern
    // theory.ts's scaleFrequency already uses for the identical problem.
    const len = this.notePool.length;
    const index = (((this.degree + degreeOffset) % len) + len) % len;
    const freq = this.notePool[index];
    this.degree = (this.degree + 1) % 1000;
    this.triggerNote(freq);
  }

  /** Event-mode pitch selection: graze-to-pluck's entry point. x is
      normalized 0..1 across the tile — leftmost line lowest note,
      rightmost highest, walking up the active scale, like a harp. Rate
      limited independently of the scheduled loop's own timing so a fast
      swipe across many lines reads as a quick run of distinct notes
      rather than a dozen overlapping hits collapsing into noise. */
  pluck(x: number): void {
    if (this.disposed || this.notePool.length === 0) return;
    const now = performance.now();
    const minInterval =
      PLUCK_INTERVAL_MAX_MS - this.live.noteDensity * (PLUCK_INTERVAL_MAX_MS - PLUCK_INTERVAL_MIN_MS);
    if (now - this.lastPluckAt < minInterval) return;
    this.lastPluckAt = now;

    const clamped = x < 0 ? 0 : x > 1 ? 1 : x;
    const span = this.notePool.length - 1;
    const baseIndex = Math.round(clamped * span);
    // The preset's own bound 'pitch' control transposes the whole
    // instrument up or down, layered on TOP of the graze position rather
    // than replacing it — pitchBend at 0.5 (unbound, or a binding
    // sitting at its own midpoint) means no shift at all, so this is a
    // pure addition, not a second competing pitch source. Restores the
    // thing that most differentiated the five Field Lines presets before
    // graze-to-pluck: each one binds a DIFFERENT visual control here
    // (Bend Strength, Density, Field Radius...), so each now genuinely
    // has its own register/character again, on top of the shared
    // left-low/right-high spatial mapping every preset keeps.
    const offset = Math.round((this.live.pitchBend - 0.5) * span);
    const index = Math.min(span, Math.max(0, baseIndex + offset));
    const freq = this.notePool[index];

    // Swing here means accent, not delay — a pluck has no fixed grid to
    // land late against, since it fires whenever the cursor actually
    // crosses a line. Alternating velocity instead gives the same
    // weak-beat "swung" feel, just driven by the player's own rhythm
    // rather than a metronome.
    let accent = 1;
    if (this.soundState.swing) {
      accent = this.pluckParity === 1 ? 0.8 : 1;
      this.pluckParity = this.pluckParity === 0 ? 1 : 0;
    }

    if (this.soundState.humanize) {
      // A small, deliberately subtle defer — real fingers don't land at
      // a mathematically exact instant either. Much smaller than the
      // scheduled loop's own timing jitter below, since this note is
      // already tied to a live gesture; too much delay here reads as lag
      // rather than feel.
      const delay = Math.random() * HUMANIZE_PLUCK_TIMING_JITTER_MS;
      setTimeout(() => this.triggerNote(freq, accent), delay);
    } else {
      this.triggerNote(freq, accent);
    }
  }

  /** Called every frame by the pool with fresh normalized values. */
  update(live: Partial<ArpLiveParams>): void {
    Object.assign(this.live, live);
  }

  /** Current target for this.gain.gain — volume, the live-bound gain
      control, and the preset's own gainTrim (see that field's doc in
      types.ts), combined in one place so PadEngine's identical pattern
      and this one can't drift apart, and so a future third call site
      here can't accidentally skip gainTrim by recomputing the formula
      inline. */
  private targetGain(): number {
    return this.soundState.volume * (0.3 + this.live.gainLevel * 0.7) * (this.preset.gainTrim ?? 1);
  }

  setSoundState(soundState: SoundState): void {
    const poolChanged =
      soundState.scale !== this.soundState.scale ||
      soundState.octave !== this.soundState.octave ||
      soundState.notes.join() !== this.soundState.notes.join();
    this.soundState = soundState;
    if (poolChanged) this.rebuildNotePool();
    this.gain.gain.setTargetAtTime(this.targetGain(), this.ctx.currentTime, 0.05);
  }

  /** Retrigger control (Stage 2 UI) — plays one note immediately, outside
      the normal schedule, without disturbing it. */
  /** The engine's own final gain stage, right before it connects to
      master — what a meter or (later) an ADSR rewrite should tap or
      touch, respectively, rather than reaching into private fields. */
  get outputNode(): AudioNode {
    return this.gain;
  }

  retrigger(): void {
    this.playNote();
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.filter.disconnect();
    this.gain.disconnect();
  }
}
