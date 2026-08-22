/**
 * Visual Mood Lab — pad/drone sound engine.
 *
 * Two source modes feeding the same downstream chain (filter -> tremolo ->
 * gain -> master):
 *   - synth mode (default): two detuned sawtooth oscillators
 *   - sample mode (preset.sampleUrl set): a looping recorded pad,
 *     transposed via playbackRate against the preset's declared root note
 *
 * Tremolo is a real Web Audio LFO — an oscillator modulating the tremolo
 * stage's own gain AudioParam — with its rate and depth driven by whatever
 * the preset binds them to (Acid Melt binds rate to Hue Speed, so the
 * pulse audibly syncs to how fast the visual is cycling) and its waveform
 * shape user-adjustable via SoundState.lfoShape.
 *
 * Location: lib/sound/engines/pad.ts
 */

import { getAudioContext, getMasterGain } from '../context';
import { scaleFrequency } from '../theory';
import { loadSample } from '../sample-cache';
import type { SoundState } from '@/renderers/control-schema';
import type { SoundPreset } from '../types';

/** 0..1, normalized live-bound values. lfoRate/lfoDepth default to a
    gentle, always-on breathing motion even for a preset that doesn't
    explicitly bind them — silence-by-default would make the tremolo
    feature invisible on any preset that forgets to wire it. */
export interface PadLiveParams {
  pitch: number;
  filterCutoff: number;
  lfoRate: number;
  lfoDepth: number;
}

const DEFAULT_LIVE: PadLiveParams = { pitch: 0.5, filterCutoff: 0.5, lfoRate: 0.3, lfoDepth: 0.4 };

/** Baseline attack for a voice starting from silence — the very first
    note, or any note added while nothing else is sounding. A note
    stacking onto an already-ringing chord gets double this instead (see
    reconcileVoices) since that jump is far more noticeable than the
    first note of a phrase landing on a silent tile. */
const BASE_ATTACK_S = 0.02;

export class PadEngine {
  private ctx = getAudioContext();
  private filter: BiquadFilterNode;
  private tremoloGain: GainNode;
  private gain: GainNode;
  private lfoOsc: OscillatorNode;
  private lfoDepthGain: GainNode;
  /** Rounds the hard edges out of square/sawtooth before they reach
      tremoloGain.gain — see the wiring comment below for why this exists.
      Sine/triangle pass through it essentially unchanged (they have no
      sharp edges to round), so this is safe to leave in the signal path
      unconditionally rather than switching it in only for those two
      shapes. */
  private lfoSmoother: BiquadFilterNode;

  /**
   * One entry per selected note — each a detuned oscillator pair plus its
   * own gain stage, tagged with the note it plays. Tagged by VALUE rather
   * than array position: the note rack always returns selections in
   * chromatic order, so adding a lower note can shift where an existing
   * note sits in soundState.notes without that note itself changing —
   * a position-based mapping would misread that shift as a note change
   * and retune (or worse, tear down and restart) a voice that never
   * actually moved. See reconcileVoices().
   */
  private voices: Array<{ note: string; oscA: OscillatorNode; oscB: OscillatorNode; gain: GainNode }> = [];
  /** A voice newly added by reconcileVoices() is silent (gain 0) until
      rebalanceVoiceGains() runs immediately after and knows the final
      voice count — this is what tells that pass which voices are new and
      how long THEIR attack ramp should be, vs. which are already sounding
      and just need their shared level retargeted. Cleared as each is
      consumed. */
  private pendingAttacks = new WeakMap<GainNode, number>();
  private sampleSource: AudioBufferSourceNode | null = null;

  private disposed = false;
  private soundState: SoundState;
  private preset: SoundPreset;
  private live: PadLiveParams = { ...DEFAULT_LIVE };

  /**
   * Humanize on a sustained tone has no per-note timing to jitter — the
   * ArpEngine sense of the word doesn't apply — so this is a slow, subtle
   * detune drift instead: a real analog synth's oscillators are never
   * perfectly locked to their nominal pitch, they wander a few cents over
   * seconds. Recurring timer rather than an audio-rate LFO because the
   * target is "occasionally re-aim," not continuous audio-rate modulation.
   */
  private humanizeTimer: ReturnType<typeof setTimeout> | null = null;
  private humanizeDriftCents = 0;
  /**
   * Swing on a sustained tone has no discrete notes to delay either, so
   * this alternates the EXISTING tremolo's depth every other cycle — a
   * lopsided "breathe deep, breathe shallow" pulse instead of a perfectly
   * even one. Reuses the tremolo that's already there rather than
   * fabricating an unrelated second mechanism. Synced to the current LFO
   * rate each cycle (recomputed every call, not fixed at start), so it
   * keeps tracking lfoRate if that's itself live-bound and moves.
   */
  private swingTimer: ReturnType<typeof setTimeout> | null = null;
  private swingParity: 0 | 1 = 0;

  constructor(soundState: SoundState, preset: SoundPreset) {
    this.soundState = soundState;
    this.preset = preset;
    const now = this.ctx.currentTime;

    this.filter = this.ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 800;

    // The LFO modulates THIS node's gain, kept separate from the final
    // Volume gain below so tremolo depth and overall level never fight
    // each other.
    this.tremoloGain = this.ctx.createGain();
    this.tremoloGain.gain.value = 1;

    this.gain = this.ctx.createGain();
    this.gain.gain.setValueAtTime(0, now);
    // Synth mode already goes silent naturally with zero notes selected
    // (reconcileVoices/startSynthSource just have nothing to build), but
    // sample mode doesn't — it's a single looping buffer that keeps
    // playing at a 'C' fallback root regardless. Gating the shared output
    // stage here covers both the same way, and lets the loop keep running
    // silently underneath rather than stopping/restarting it, so
    // reselecting a note resumes instantly with no reload glitch.
    this.gain.gain.linearRampToValueAtTime(this.targetGain(), now + 0.8);

    this.filter.connect(this.tremoloGain);
    this.tremoloGain.connect(this.gain);
    this.gain.connect(getMasterGain());

    // Standard Web Audio tremolo wiring: an oscillator through a small
    // gain (the depth control) feeding directly into another node's gain
    // AudioParam, which sums with that param's own base value.
    this.lfoOsc = this.ctx.createOscillator();
    this.lfoOsc.type = soundState.lfoShape;
    this.lfoOsc.frequency.value = 0.1 + this.live.lfoRate * 7.9;

    this.lfoDepthGain = this.ctx.createGain();
    this.lfoDepthGain.gain.value = this.live.lfoDepth * 0.5;

    // Web Audio's built-in oscillator types are band-limited against
    // aliasing, but 'square' and 'sawtooth' still have a genuinely sharp
    // (near-vertical) edge once per cycle — inaudible on an audio-rate
    // tone, but landing that same edge directly on a gain AudioParam at
    // 0.1-8Hz tremolo rates reads as a periodic click/tick, not a smooth
    // pulse. A gentle lowpass on the modulation signal itself (well above
    // the LFO's own top rate, well below audio range) rounds that corner
    // off before it reaches tremoloGain.gain — the shape stays
    // recognizably square/saw at these slow rates, it just stops
    // clicking. Sine/triangle have no sharp edge to round, so this is
    // inert for them rather than something to special-case around.
    this.lfoSmoother = this.ctx.createBiquadFilter();
    this.lfoSmoother.type = 'lowpass';
    this.lfoSmoother.frequency.value = 30;
    this.lfoSmoother.Q.value = 0.707;

    this.lfoOsc.connect(this.lfoDepthGain);
    this.lfoDepthGain.connect(this.lfoSmoother);
    this.lfoSmoother.connect(this.tremoloGain.gain);
    this.lfoOsc.start(now);

    if (preset.sampleUrl) {
      this.startSampleSource();
    } else {
      this.startSynthSource(now);
    }

    if (soundState.humanize) this.scheduleHumanizeDrift();
    if (soundState.swing) this.scheduleSwingPulse();
  }

  /** Picks a new random detune target and glides every current voice
      toward it. Reschedules itself at a randomized 500-900ms interval —
      randomized rather than fixed so the drift doesn't itself read as a
      metronomic, machine-quantized wobble, which would defeat the point. */
  private scheduleHumanizeDrift(): void {
    if (this.disposed || !this.soundState.humanize) return;
    const now = this.ctx.currentTime;
    this.humanizeDriftCents = (Math.random() * 2 - 1) * 5;
    for (const voice of this.voices) {
      voice.oscA.detune.setTargetAtTime(this.humanizeDriftCents, now, 0.4);
      voice.oscB.detune.setTargetAtTime(8 + this.humanizeDriftCents, now, 0.4);
    }
    const nextMs = 500 + Math.random() * 400;
    this.humanizeTimer = setTimeout(() => this.scheduleHumanizeDrift(), nextMs);
  }

  private stopHumanizeDrift(): void {
    if (this.humanizeTimer !== null) {
      clearTimeout(this.humanizeTimer);
      this.humanizeTimer = null;
    }
    this.humanizeDriftCents = 0;
    const now = this.ctx.currentTime;
    for (const voice of this.voices) {
      voice.oscA.detune.setTargetAtTime(0, now, 0.3);
      voice.oscB.detune.setTargetAtTime(8, now, 0.3);
    }
  }

  /** Alternates the tremolo's depth every other LFO cycle instead of
      leaving it perfectly even. Owns lfoDepthGain exclusively while
      running — see update()'s own guard around that same param, which
      steps aside for this instead of fighting it every frame. */
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
    // No explicit reset needed here — update() resumes owning
    // lfoDepthGain the instant its own guard sees soundState.swing is
    // false again, on the very next frame.
  }

  private startSynthSource(now: number): void {
    // Every note at boot comes in together at the same, non-doubled
    // BASE_ATTACK_S — "twice the attack for a note stacking onto an
    // already-sounding chord" only applies once something is already
    // ringing, which nothing is yet here.
    for (const note of this.soundState.notes) {
      this.addVoice(note, now, BASE_ATTACK_S);
    }
    this.rebalanceVoiceGains(now);
    this.applyPitch();
  }

  private startSampleSource(): void {
    loadSample(this.preset.sampleUrl!).then((buffer) => {
      if (this.disposed || !buffer) return;

      this.sampleSource = this.ctx.createBufferSource();
      this.sampleSource.buffer = buffer;
      this.sampleSource.loop = true;
      this.sampleSource.connect(this.filter);
      this.applySamplePlaybackRate();
      this.sampleSource.start();
    });
  }

  /**
   * Each voice tracks its OWN selected root through the same scale and
   * the same live pitch position — so the chord's shape stays intact as
   * the bound visual parameter sweeps it, rather than the intervals
   * collapsing or drifting apart. Reads each voice's own tagged .note
   * directly — see the voices field's comment for why that, and not
   * array position, is the correct key.
   *
   * `this.live.pitch - 0.5`, not raw `this.live.pitch`: 0.5 is the
   * unbound default (DEFAULT_LIVE.pitch), and any binding's own range
   * sits centered near there too unless deliberately skewed — so it has
   * to be the zero-shift point. The previous, uncentered version put
   * zero shift at pitch=0 instead, meaning the actual resting/default
   * state was always degree 7 — for most scales, a full octave sharp of
   * whatever note was actually selected, silently, for every preset that
   * didn't happen to bind pitch. ArpEngine's pluck() already used this
   * centered form; this brings PadEngine's synth voicing in line with it.
   */
  private applyPitch(): void {
    if (this.voices.length === 0) return;
    const now = this.ctx.currentTime;
    const degree = (this.live.pitch - 0.5) * 14;
    const lower = Math.floor(degree);
    const frac = degree - lower;

    for (const voice of this.voices) {
      const freqLower = scaleFrequency(voice.note, this.soundState.scale, this.soundState.octave, lower);
      const freqUpper = scaleFrequency(voice.note, this.soundState.scale, this.soundState.octave, lower + 1);
      const freq = freqLower + (freqUpper - freqLower) * frac;
      voice.oscA.frequency.setTargetAtTime(freq, now, 0.15);
      voice.oscB.frequency.setTargetAtTime(freq, now, 0.15);
    }
  }

  /**
   * Transposes the recorded sample by adjusting its playback rate against
   * the preset's declared root note — the same technique real hardware
   * samplers use for pitched material. Pitch and tempo shift together
   * (there's no real-time pitch correction here); fine for small shifts
   * near the recorded root, an audible tempo change for large ones. The
   * Key control's hint text says this explicitly for any preset that sets
   * sampleRootNote, so it's not a silent surprise.
   */
  /**
   * Adds or removes exactly the voices for notes actually added/removed
   * from the selection, leaving every unaffected voice completely
   * untouched — no restart, no gap, no click on a note that didn't
   * change. Diffed by note VALUE (see the voices field's comment), not
   * by comparing array lengths or positions.
   */
  private reconcileVoices(added: string[], removed: string[]): void {
    const now = this.ctx.currentTime;

    for (const note of removed) {
      const idx = this.voices.findIndex((v) => v.note === note);
      if (idx === -1) continue;
      const [voice] = this.voices.splice(idx, 1);
      // Short release, not an instant stop — scoped to just this one
      // voice rather than the whole engine the way dispose()'s does.
      voice.gain.gain.cancelScheduledValues(now);
      voice.gain.gain.setTargetAtTime(0, now, 0.03);
      setTimeout(() => {
        try {
          voice.oscA.stop();
          voice.oscB.stop();
        } catch {
          // already stopped — nothing to do
        }
        voice.oscA.disconnect();
        voice.oscB.disconnect();
        voice.gain.disconnect();
      }, 200);
    }

    for (const note of added) {
      // The actual "twice the attack" rule: a note landing on top of a
      // chord that's already sounding (this.voices is non-empty BEFORE
      // this addition) gets double BASE_ATTACK_S. A note added while
      // nothing else is voiced yet — e.g. the very first selection after
      // Sound was off — gets the normal, non-doubled attack, same as
      // startSynthSource's initial boot.
      const attackSeconds = this.voices.length === 0 ? BASE_ATTACK_S : BASE_ATTACK_S * 2;
      this.addVoice(note, now, attackSeconds);
    }

    this.rebalanceVoiceGains(now);
  }

  /** Creates one new voice, silent until rebalanceVoiceGains() gives it
      its ramp — see pendingAttacks' comment for why the two are split
      across two passes rather than one. */
  private addVoice(note: string, now: number, attackSeconds: number): void {
    // Falls back to 'sawtooth' — the only shape that existed before
    // oscType — so Acid Melt's five presets and Interpol Pad, none of
    // which set it, sound exactly as they did before this field existed.
    const waveform = this.preset.oscType ?? 'sawtooth';
    const oscA = this.ctx.createOscillator();
    oscA.type = waveform;
    const oscB = this.ctx.createOscillator();
    oscB.type = waveform;
    oscB.detune.value = 8;

    const voiceGain = this.ctx.createGain();
    voiceGain.gain.setValueAtTime(0, now);

    oscA.connect(voiceGain);
    oscB.connect(voiceGain);
    voiceGain.connect(this.filter);
    // Join whatever humanize drift is already in progress rather than
    // starting at a flat baseline while every other voice has wandered —
    // otherwise a note added mid-drift would audibly stick out as the
    // one perfectly-in-tune voice in an otherwise-drifting chord.
    if (this.soundState.humanize) {
      oscA.detune.value = this.humanizeDriftCents;
      oscB.detune.value = 8 + this.humanizeDriftCents;
    }

    this.voices.push({ note, oscA, oscB, gain: voiceGain });
    oscA.start(now);
    oscB.start(now);
    this.pendingAttacks.set(voiceGain, attackSeconds);
  }

  /**
   * Sets every voice's target level to 1/count — the same clip-avoiding
   * compensation as before, just reapplied here instead of only at boot,
   * since the count can now change one note at a time. A voice with a
   * pending attack (just added by addVoice, still silent) ramps UP to
   * that level over its own attack time; every other, already-sounding
   * voice eases smoothly to the new shared level instead of jumping,
   * exactly like an existing note easing down to make room for a second.
   */
  private rebalanceVoiceGains(now: number): void {
    const count = Math.max(1, this.voices.length);
    const perVoice = 1 / count;
    for (const voice of this.voices) {
      const attackSeconds = this.pendingAttacks.get(voice.gain);
      if (attackSeconds !== undefined) {
        voice.gain.gain.cancelScheduledValues(now);
        voice.gain.gain.setValueAtTime(0, now);
        voice.gain.gain.linearRampToValueAtTime(perVoice, now + attackSeconds);
        this.pendingAttacks.delete(voice.gain);
      } else {
        voice.gain.gain.setTargetAtTime(perVoice, now, 0.05);
      }
    }
  }

  private applySamplePlaybackRate(): void {
    if (!this.sampleSource || !this.preset.sampleRootNote) return;
    const rootOctave = this.preset.sampleRootOctave ?? 0;
    // Same centering fix as applyPitch() above, and for the identical
    // reason: pitch=0.5 (unbound default) has to mean "play the sample at
    // its recorded pitch," not "transpose it up ~an octave by default."
    // This was the actual cause of a sample-backed preset without a pitch
    // binding sounding sped-up even with sampleRootNote/Octave and the
    // selected note/octave matching exactly — degree was landing on 7
    // instead of 0 regardless, so rate was never really 1.0 to begin
    // with.
    const degree = Math.round((this.live.pitch - 0.5) * 14);
    // Sample mode uses the FIRST selected note only, deliberately. A
    // recorded loop can't be chorded the way synth voices can — playing
    // three transposed copies of the same performance layers three
    // slightly-offset copies of its rhythm, which reads as flamming and
    // phase mush rather than harmony. The note rack still works here, it
    // just transposes rather than stacks.
    const rootNote = this.soundState.notes[0] ?? 'C';
    const targetFreq = scaleFrequency(rootNote, this.soundState.scale, this.soundState.octave, degree);
    // 'chromatic' with degreeIndex 0 is a neutral way to get the raw
    // frequency of the recorded root note/octave, independent of whatever
    // scale the user has selected for the target side of the ratio.
    const rootFreq = scaleFrequency(this.preset.sampleRootNote, 'chromatic', rootOctave, 0);
    const rate = targetFreq / rootFreq;
    this.sampleSource.playbackRate.setTargetAtTime(rate, this.ctx.currentTime, 0.15);
  }

  /** Called every frame by the pool with fresh normalized values. */
  update(live: Partial<PadLiveParams>): void {
    Object.assign(this.live, live);
    const now = this.ctx.currentTime;

    if (this.voices.length > 0) this.applyPitch();
    if (this.sampleSource) this.applySamplePlaybackRate();

    this.filter.frequency.setTargetAtTime(150 + this.live.filterCutoff * 5000, now, 0.1);

    // 0..1 maps to roughly 0.1..8Hz — slow, audible-as-breathing tremolo
    // across the whole range, nowhere near audio-rate modulation.
    const hz = 0.1 + this.live.lfoRate * 7.9;
    this.lfoOsc.frequency.setTargetAtTime(hz, now, 0.1);
    // Swing owns lfoDepthGain exclusively while it's running (see
    // scheduleSwingPulse) — this per-frame reset would otherwise pull the
    // accented depth back toward baseline within a couple hundred ms,
    // long before the next natural half-cycle, erasing the swing almost
    // as soon as it happened.
    if (!this.soundState.swing) {
      this.lfoDepthGain.gain.setTargetAtTime(this.live.lfoDepth * 0.5, now, 0.1);
    }
  }

  /** Current target for this.gain.gain — the single place volume,
      whether any notes are actually selected, and the preset's own
      gainTrim (see that field's doc in types.ts) combine, so the three
      inputs can't drift out of sync by being combined in more than one
      place. Every write to this.gain.gain in this engine goes through
      here. */
  private targetGain(): number {
    if (this.soundState.notes.length === 0) return 0;
    return this.soundState.volume * (this.preset.gainTrim ?? 1);
  }

  setSoundState(soundState: SoundState): void {
    const shapeChanged = soundState.lfoShape !== this.soundState.lfoShape;
    const humanizeChanged = soundState.humanize !== this.soundState.humanize;
    const swingChanged = soundState.swing !== this.soundState.swing;
    const prevNotes = this.soundState.notes;
    const nextNotes = soundState.notes;
    this.soundState = soundState;

    if (!this.preset.sampleUrl) {
      const added = nextNotes.filter((n) => !prevNotes.includes(n));
      const removed = prevNotes.filter((n) => !nextNotes.includes(n));
      if (added.length > 0 || removed.length > 0) this.reconcileVoices(added, removed);
      if (this.voices.length > 0) this.applyPitch();
    }

    if (humanizeChanged) {
      if (soundState.humanize) this.scheduleHumanizeDrift();
      else this.stopHumanizeDrift();
    }
    if (swingChanged) {
      if (soundState.swing) this.scheduleSwingPulse();
      else this.stopSwingPulse();
    }

    this.gain.gain.setTargetAtTime(this.targetGain(), this.ctx.currentTime, 0.1);
    if (this.sampleSource) this.applySamplePlaybackRate();
    if (shapeChanged) this.lfoOsc.type = soundState.lfoShape;
  }

  /** Retrigger re-attacks the envelope rather than playing a separate note
      — there's no discrete note to repeat, in either source mode. */
  /** The engine's own final gain stage, right before it connects to
      master — what a meter or (later) an ADSR rewrite should tap or
      touch, respectively, rather than reaching into private fields. */
  get outputNode(): AudioNode {
    return this.gain;
  }

  retrigger(): void {
    const now = this.ctx.currentTime;
    this.gain.gain.cancelScheduledValues(now);
    this.gain.gain.setValueAtTime(0, now);
    this.gain.gain.linearRampToValueAtTime(this.targetGain(), now + 0.5);
  }

  dispose(): void {
    this.disposed = true;
    if (this.humanizeTimer !== null) clearTimeout(this.humanizeTimer);
    if (this.swingTimer !== null) clearTimeout(this.swingTimer);
    const now = this.ctx.currentTime;
    // Fade out rather than hard-stop — an abrupt cutoff on a sustained
    // tone is audibly jarring in a way a short arp note never is.
    this.gain.gain.cancelScheduledValues(now);
    this.gain.gain.setTargetAtTime(0, now, 0.08);

    const sources: Array<OscillatorNode | AudioBufferSourceNode | null> = [
      ...this.voices.flatMap((v) => [v.oscA, v.oscB]),
      this.sampleSource,
      this.lfoOsc,
    ];
    const nodes: AudioNode[] = [
      this.filter,
      this.tremoloGain,
      this.gain,
      this.lfoDepthGain,
      this.lfoSmoother,
      ...this.voices.map((v) => v.gain),
    ];

    setTimeout(() => {
      for (const src of sources) {
        if (!src) continue;
        try {
          src.stop();
        } catch {
          // already stopped or never started (e.g. sample still loading
          // when dispose() was called) — nothing to do
        }
        src.disconnect();
      }
      for (const n of nodes) n.disconnect();
    }, 300);
  }
}
