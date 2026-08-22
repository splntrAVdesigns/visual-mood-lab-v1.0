/**
 * Visual Mood Lab — abstract/texture sound engine.
 *
 * The third engine class, for tiles whose natural voice isn't pitched notes
 * at all — Wound Thread's foley presets (creak, breath, thump, crackle,
 * hum, plus a set of short punchy "tick" samples) rather than a chord or
 * an arpeggio. No oscillator, no notes/scale/octave concept: the
 * "instrument" is either a looped filtered-noise bed or a loaded sample
 * (looping or one-shot), shaped by a bandpass/lowpass filter and a
 * tremolo-style breathing LFO, both driven by the same live-bound visual
 * controls every other engine reads. SoundPanel hides Notes/Scale/Octave
 * for an 'abstract' preset — see its own comment for why; nothing here
 * reads soundState.notes/scale at all.
 *
 * Deliberately reuses PadEngine's exact tremolo wiring (LFO -> depth gain
 * -> anti-click smoothing lowpass -> tremoloGain.gain) rather than
 * inventing a second implementation of the same fix — see PadEngine's own
 * comment on lfoSmoother for why that filter exists at all.
 *
 * Humanize/Swing answers (see SOUND_PRESETS_CONCEPT.md's "what does
 * Humanize/Swing mean here" flag):
 *   - Humanize: slow randomized drift on the filter's cutoff — no pitch to
 *     detune, so this is the organic "not perfectly settled" analogue
 *     applied to the one continuous parameter this engine actually has.
 *   - Swing: alternating tremolo depth every other LFO half-cycle — the
 *     literal same mechanism PadEngine's swing already uses, reused
 *     verbatim rather than invented twice, since this engine's tremolo is
 *     structurally identical to PadEngine's.
 *
 * Interaction gating (preset.interactionGated — see the type's own doc):
 * the engine starts near-silent and swells in proportional to a 0..1
 * "energy" signal the sketch reports every frame via setEnergy(), rather
 * than sounding continuously the instant Sound is switched on. Wound
 * Thread derives its energy from the physics sim's own current velocity —
 * see wound-thread.js. A preset with sampleUrl + oneShot set plays a fresh
 * one-shot copy of the sample on each rising edge across the interaction
 * threshold instead of looping continuously — for short, percussive
 * "tick" samples that should punch in on each push.
 *
 * Location: lib/sound/engines/abstract.ts
 */

import { getAudioContext, getMasterGain } from '../context';
import { loadSample } from '../sample-cache';
import type { SoundState } from '@/renderers/control-schema';
import type { SoundPreset } from '../types';

export interface AbstractLiveParams {
  filterCutoff: number;
  gainLevel: number;
  lfoRate: number;
  lfoDepth: number;
}

const DEFAULT_LIVE: AbstractLiveParams = {
  filterCutoff: 0.5,
  gainLevel: 0.5,
  lfoRate: 0.3,
  lfoDepth: 0.4,
};

/** Length of the procedurally-generated looped noise buffer, in seconds.
    Irrelevant to sample-backed presets — they loop (or one-shot) the
    sample's own real length. */
const NOISE_BUFFER_SECONDS = 4;

/** Humanize's filter-cutoff wobble, as a fraction of the live-computed
    target frequency each side. */
const HUMANIZE_FILTER_DRIFT = 0.08;

/** How quiet an interaction-gated preset is at zero energy — not
    literally silent (a hard mute reads as broken, not "waiting for
    input"), just far enough down that the swell on actually pushing the
    thread is the obviously dominant thing happening. */
const ENERGY_GAIN_FLOOR = 0.03;

/** Energy has to rise above this to count as a genuine push, not idle
    jitter in whatever the sketch is smoothing on its end. */
const ONE_SHOT_THRESHOLD = 0.35;

/** Minimum time between one-shot retriggers even if energy oscillates
    rapidly across the threshold — same rate-limiting instinct as
    ArpEngine's PLUCK_INTERVAL, applied to a different trigger source. */
const ONE_SHOT_MIN_INTERVAL_S = 0.35;

export class AbstractEngine {
  private ctx = getAudioContext();
  private filter: BiquadFilterNode;
  private tremoloGain: GainNode;
  private gain: GainNode;
  private lfoOsc: OscillatorNode;
  private lfoDepthGain: GainNode;
  private lfoSmoother: BiquadFilterNode;

  /** Procedural-noise mode only (no sampleUrl). */
  private noiseSource: AudioBufferSourceNode | null = null;
  /** Sample mode, looping variant only (sampleUrl set, oneShot falsy). */
  private loopSampleSource: AudioBufferSourceNode | null = null;
  /** Sample mode, either variant — kept once loaded so oneShot mode has
      something to spin up a fresh AudioBufferSourceNode from on each
      trigger (a buffer can back any number of simultaneous/sequential
      sources; the source node itself is one-shot-use only). */
  private sampleBuffer: AudioBuffer | null = null;
  /** oneShot mode only — the currently-playing one-shot's source and its
      own gain stage, if any. Tracked specifically so a new trigger can
      cut the previous one off first — see triggerOneShot(). Without
      this, a sample long enough to still be playing when the next
      trigger arrives (Grid Snake's eat event can fire faster than a
      multi-second drum loop finishes) just stacks a new copy on top of
      the old one every time, which is what "retrigger" very much did
      NOT mean — the reported symptom (audio "multiplying," several
      overlapping copies going at once) is exactly what having no
      previous-instance bookkeeping at all looks like. */
  private activeOneShotSource: AudioBufferSourceNode | null = null;
  private activeOneShotGain: GainNode | null = null;

  private disposed = false;
  private soundState: SoundState;
  private preset: SoundPreset;
  private live: AbstractLiveParams = { ...DEFAULT_LIVE };

  private humanizeDriftFactor = 0;
  private humanizeTimer: ReturnType<typeof setTimeout> | null = null;
  private swingTimer: ReturnType<typeof setTimeout> | null = null;
  private swingParity: 0 | 1 = 0;

  /** Interaction-energy state — see the module doc and preset.interactionGated. */
  private energyLevel = 0;
  private lastOneShotAt = -Infinity;

  constructor(soundState: SoundState, preset: SoundPreset) {
    this.soundState = soundState;
    this.preset = preset;
    const now = this.ctx.currentTime;

    this.filter = this.ctx.createBiquadFilter();
    this.filter.type = preset.noiseFilterType ?? 'bandpass';
    this.filter.frequency.value = 800;
    this.filter.Q.value = 1;

    this.tremoloGain = this.ctx.createGain();
    this.tremoloGain.gain.value = 1;

    this.gain = this.ctx.createGain();
    this.gain.gain.setValueAtTime(0, now);
    this.gain.gain.linearRampToValueAtTime(this.targetGain(), now + 0.8);

    this.filter.connect(this.tremoloGain);
    this.tremoloGain.connect(this.gain);
    this.gain.connect(getMasterGain());

    // Tremolo wiring, identical to PadEngine's — including the anti-click
    // smoothing filter.
    this.lfoOsc = this.ctx.createOscillator();
    this.lfoOsc.type = soundState.lfoShape;
    this.lfoOsc.frequency.value = 0.1 + this.live.lfoRate * 7.9;

    this.lfoDepthGain = this.ctx.createGain();
    this.lfoDepthGain.gain.value = this.live.lfoDepth * 0.5;

    this.lfoSmoother = this.ctx.createBiquadFilter();
    this.lfoSmoother.type = 'lowpass';
    this.lfoSmoother.frequency.value = 30;
    this.lfoSmoother.Q.value = 0.707;

    this.lfoOsc.connect(this.lfoDepthGain);
    this.lfoDepthGain.connect(this.lfoSmoother);
    this.lfoSmoother.connect(this.tremoloGain.gain);
    this.lfoOsc.start(now);

    if (preset.sampleUrl) {
      loadSample(preset.sampleUrl).then((buffer) => {
        if (this.disposed || !buffer) return;
        this.sampleBuffer = buffer;
        if (!preset.oneShot) {
          this.loopSampleSource = this.ctx.createBufferSource();
          this.loopSampleSource.buffer = buffer;
          this.loopSampleSource.loop = true;
          this.loopSampleSource.connect(this.filter);
          this.loopSampleSource.start();
        }
      });
    } else {
      this.noiseSource = this.ctx.createBufferSource();
      this.noiseSource.buffer = createNoiseBuffer(this.ctx, preset.noiseColor ?? 'white');
      this.noiseSource.loop = true;
      this.noiseSource.connect(this.filter);
      this.noiseSource.start(now);
    }

    if (soundState.humanize) this.scheduleHumanizeDrift();
    if (soundState.swing) this.scheduleSwingPulse();
  }

  private scheduleHumanizeDrift(): void {
    if (this.disposed || !this.soundState.humanize) return;
    this.humanizeDriftFactor = (Math.random() * 2 - 1) * HUMANIZE_FILTER_DRIFT;
    const nextMs = 600 + Math.random() * 500;
    this.humanizeTimer = setTimeout(() => this.scheduleHumanizeDrift(), nextMs);
  }

  private stopHumanizeDrift(): void {
    if (this.humanizeTimer !== null) {
      clearTimeout(this.humanizeTimer);
      this.humanizeTimer = null;
    }
    this.humanizeDriftFactor = 0;
  }

  private scheduleSwingPulse(): void {
    if (this.disposed || !this.soundState.swing) return;
    const now = this.ctx.currentTime;
    const hz = 0.1 + this.live.lfoRate * 7.9;
    const periodMs = 1000 / hz;
    const baseDepth = this.live.lfoDepth * 0.5;
    const target = this.swingParity === 1 ? baseDepth * 1.4 : baseDepth * 0.7;
    this.lfoDepthGain.gain.setTargetAtTime(target, now, periodMs / 2000);
    this.swingParity = this.swingParity === 0 ? 1 : 0;
    this.swingTimer = setTimeout(() => this.scheduleSwingPulse(), periodMs);
  }

  private stopSwingPulse(): void {
    if (this.swingTimer !== null) {
      clearTimeout(this.swingTimer);
      this.swingTimer = null;
    }
    this.swingParity = 0;
  }

  /** Current target for this.gain.gain, folding together volume, the
      live-bound gain control, and (for an interaction-gated preset) how
      much energy is currently coming in. Every write to this.gain.gain
      goes through here so the three inputs can never drift out of sync by
      being combined in two different places. */
  /** Current target for this.gain.gain, folding together volume, the
      live-bound gain control, and (for an interaction-gated CONTINUOUS
      preset) how much energy is currently coming in.

      One-shot presets are explicitly excluded from the energy-floor
      gating below (`&& !this.preset.oneShot`) — this was the actual
      cause of one-shot samples reading as barely audible, including via
      the Retrigger button, which doesn't touch energyLevel at all and
      was still being scaled by whatever it last happened to decay to. A
      discrete trigger already represents "the interaction happened";
      gating its overall volume by a continuously-decaying energy level
      moments into a multi-second sample's playback double-penalizes it
      for the push not having lasted as long as the sample does, which it
      essentially never will. Every write to this.gain.gain goes through
      here so these inputs can't drift out of sync by being combined in
      more than one place. */
  private targetGain(): number {
    const mult = this.preset.interactionGated && !this.preset.oneShot
      ? ENERGY_GAIN_FLOOR + this.energyLevel * (1 - ENERGY_GAIN_FLOOR)
      : 1;
    return this.soundState.volume * (0.4 + this.live.gainLevel * 0.6) * mult * (this.preset.gainTrim ?? 1);
  }

  /** Called every frame by the sketch (via the p.setEnergy bridge) with a
      fresh 0..1 "how much interaction right now" value. No-ops entirely
      unless the active preset opted into gating. */
  setEnergy(value: number): void {
    if (!this.preset.interactionGated) return;
    const now = this.ctx.currentTime;
    const prev = this.energyLevel;
    this.energyLevel = value < 0 ? 0 : value > 1 ? 1 : value;
    this.gain.gain.setTargetAtTime(this.targetGain(), now, 0.12);

    if (this.preset.oneShot && this.sampleBuffer) {
      const crossedUp = prev < ONE_SHOT_THRESHOLD && this.energyLevel >= ONE_SHOT_THRESHOLD;
      const rateLimitOk = now - this.lastOneShotAt > ONE_SHOT_MIN_INTERVAL_S;
      if (crossedUp && rateLimitOk) {
        this.triggerOneShot();
        this.lastOneShotAt = now;
      }
    }
  }

  /** Spins up a fresh, disposable AudioBufferSourceNode for one playthrough
      of the sample — the standard Web Audio one-shot pattern, since a
      source node can only ever be started once. Routed through the same
      filter every other source in this engine uses.

      Cuts off any PREVIOUS one-shot still playing before starting the new
      one, rather than letting them stack — "retrigger" means replace, not
      layer. A hard .stop() on the old source would click, so its own
      small gain stage is ramped down fast (10ms) first and stopped once
      that ramp completes, rather than stopping it immediately. */
  private triggerOneShot(): void {
    if (!this.sampleBuffer || this.disposed) return;
    const now = this.ctx.currentTime;

    if (this.activeOneShotSource && this.activeOneShotGain) {
      const prevSource = this.activeOneShotSource;
      const prevGain = this.activeOneShotGain;
      prevGain.gain.cancelScheduledValues(now);
      prevGain.gain.setTargetAtTime(0, now, 0.01);
      setTimeout(() => {
        try {
          prevSource.stop();
        } catch {
          // already stopped — nothing to do
        }
        prevSource.disconnect();
        prevGain.disconnect();
      }, 50);
    }

    const src = this.ctx.createBufferSource();
    src.buffer = this.sampleBuffer;
    const oneShotGain = this.ctx.createGain();
    oneShotGain.gain.value = 1;
    src.connect(oneShotGain);
    oneShotGain.connect(this.filter);
    src.start();
    src.onended = () => {
      src.disconnect();
      oneShotGain.disconnect();
      // Only clear the tracked "active" pair if this source is still the
      // one they point at — a source that was cut off early by a NEWER
      // trigger (the block above) already got its own cleanup scheduled,
      // and its onended firing after that shouldn't clobber whatever the
      // newer trigger has since set these to.
      if (this.activeOneShotSource === src) {
        this.activeOneShotSource = null;
        this.activeOneShotGain = null;
      }
    };

    this.activeOneShotSource = src;
    this.activeOneShotGain = oneShotGain;
  }

  /** Called every frame by the pool with fresh normalized values. */
  update(live: Partial<AbstractLiveParams>): void {
    Object.assign(this.live, live);
    const now = this.ctx.currentTime;

    const [lo, hi] = this.preset.filterRange ?? [200, 4000];
    const baseFreq = lo + this.live.filterCutoff * (hi - lo);
    this.filter.frequency.setTargetAtTime(baseFreq * (1 + this.humanizeDriftFactor), now, 0.15);

    const hz = 0.1 + this.live.lfoRate * 7.9;
    this.lfoOsc.frequency.setTargetAtTime(hz, now, 0.1);
    if (!this.soundState.swing) {
      this.lfoDepthGain.gain.setTargetAtTime(this.live.lfoDepth * 0.5, now, 0.1);
    }

    this.gain.gain.setTargetAtTime(this.targetGain(), now, 0.1);
  }

  setSoundState(soundState: SoundState): void {
    const shapeChanged = soundState.lfoShape !== this.soundState.lfoShape;
    const humanizeChanged = soundState.humanize !== this.soundState.humanize;
    const swingChanged = soundState.swing !== this.soundState.swing;
    this.soundState = soundState;

    if (shapeChanged) this.lfoOsc.type = soundState.lfoShape;
    if (humanizeChanged) {
      if (soundState.humanize) this.scheduleHumanizeDrift();
      else this.stopHumanizeDrift();
    }
    if (swingChanged) {
      if (soundState.swing) this.scheduleSwingPulse();
      else this.stopSwingPulse();
    }

    this.gain.gain.setTargetAtTime(this.targetGain(), this.ctx.currentTime, 0.1);
  }

  get outputNode(): AudioNode {
    return this.gain;
  }

  /** No discrete note to repeat — re-attacks the envelope instead, same
      answer PadEngine's own retrigger() gives for the same reason. For a
      one-shot preset this fires the sample once, a reasonable way to
      preview it without needing to push the thread first. */
  retrigger(): void {
    const now = this.ctx.currentTime;
    if (this.preset.oneShot) {
      this.triggerOneShot();
      return;
    }
    this.gain.gain.cancelScheduledValues(now);
    this.gain.gain.setValueAtTime(0, now);
    this.gain.gain.linearRampToValueAtTime(this.targetGain(), now + 0.5);
  }

  dispose(): void {
    this.disposed = true;
    if (this.humanizeTimer !== null) clearTimeout(this.humanizeTimer);
    if (this.swingTimer !== null) clearTimeout(this.swingTimer);
    const now = this.ctx.currentTime;
    this.gain.gain.cancelScheduledValues(now);
    this.gain.gain.setTargetAtTime(0, now, 0.08);

    const sources: Array<OscillatorNode | AudioBufferSourceNode> = [this.lfoOsc];
    if (this.noiseSource) sources.push(this.noiseSource);
    if (this.loopSampleSource) sources.push(this.loopSampleSource);
    if (this.activeOneShotSource) sources.push(this.activeOneShotSource);

    const nodes: AudioNode[] = [this.filter, this.tremoloGain, this.gain, this.lfoDepthGain, this.lfoSmoother];
    if (this.activeOneShotGain) nodes.push(this.activeOneShotGain);

    setTimeout(() => {
      for (const src of sources) {
        try {
          src.stop();
        } catch {
          // already stopped — nothing to do
        }
        src.disconnect();
      }
      for (const n of nodes) n.disconnect();
    }, 300);
  }
}

/** White noise, or a cheap approximation of pink noise (Paul Kellet's
    refined filter — a standard, well-known approximation, not anything
    novel) for a softer, less hissy texture. */
function createNoiseBuffer(ctx: AudioContext, color: 'white' | 'pink'): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * NOISE_BUFFER_SECONDS);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);

  if (color === 'pink') {
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.969 * b2 + white * 0.153852;
      b3 = 0.8665 * b3 + white * 0.3104856;
      b4 = 0.55 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.016898;
      const pink = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
      b6 = white * 0.115926;
      data[i] = pink * 0.11;
    }
  } else {
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  }

  return buffer;
}
