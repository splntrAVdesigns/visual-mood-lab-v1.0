/**
 * Visual Mood Lab — sound preset library.
 *
 * Presets are matched to an asset by binding compatibility, not by asset
 * id or seed slug: a preset "fits" a schema if every one of its bindings'
 * sourceParamId exists as a real control on that schema. See getCompatible
 * Presets below.
 *
 * Location: lib/sound/presets.ts
 */

import type { ControlSchema } from '@/renderers/control-schema';
import type { SoundPreset } from './types';

export const SOUND_PRESETS: SoundPreset[] = [
  // ---- Field Lines — arp/chime, up to 5 variants ----
  {
    id: 'field-lines-chime',
    label: 'Field Chime',
    engine: 'arp',
    // Graze-to-pluck redesign: every note comes from an explicit pluck
    // event fired by the sketch, not a hover-gated schedule. See
    // SoundPreset.triggerMode's doc comment in types.ts.
    triggerMode: 'event',
    scale: 'pentatonic',
    defaultOctave: 2,
    defaultNotes: ['C'],
    bindings: [
      { sourceParamId: 'bendStrength', target: 'pitch', range: [0, 1] },
      { sourceParamId: 'fieldRadius', target: 'filterCutoff', range: [0, 1] },
      { sourceParamId: 'glow', target: 'gain', range: [0, 1] },
      { sourceParamId: 'density', target: 'noteDensity', range: [0, 1] },
    ],
  },
  {
    id: 'field-lines-pulse',
    label: 'Field Pulse',
    engine: 'arp',
    // Graze-to-pluck redesign: every note comes from an explicit pluck
    // event fired by the sketch, not a hover-gated schedule. See
    // SoundPreset.triggerMode's doc comment in types.ts.
    triggerMode: 'event',
    scale: 'chromatic',
    defaultOctave: 0,
    defaultNotes: ['C'],
    bindings: [
      { sourceParamId: 'density', target: 'pitch', range: [0, 1] },
      { sourceParamId: 'bendStrength', target: 'noteDensity', range: [0.2, 1] },
      { sourceParamId: 'glow', target: 'filterCutoff', range: [0, 1] },
      { sourceParamId: 'fieldRadius', target: 'gain', range: [0.3, 1] },
    ],
  },
  {
    id: 'field-lines-bell',
    label: 'Field Bell',
    engine: 'arp',
    // Graze-to-pluck redesign: every note comes from an explicit pluck
    // event fired by the sketch, not a hover-gated schedule. See
    // SoundPreset.triggerMode's doc comment in types.ts.
    triggerMode: 'event',
    scale: 'major',
    defaultOctave: 1,
    defaultNotes: ['C'],
    bindings: [
      { sourceParamId: 'fieldRadius', target: 'pitch', range: [0, 1] },
      { sourceParamId: 'glow', target: 'gain', range: [0, 1] },
      { sourceParamId: 'bendStrength', target: 'filterCutoff', range: [0.2, 1] },
    ],
  },
  {
    id: 'field-lines-minor-arp',
    label: 'Field Minor',
    engine: 'arp',
    // Graze-to-pluck redesign: every note comes from an explicit pluck
    // event fired by the sketch, not a hover-gated schedule. See
    // SoundPreset.triggerMode's doc comment in types.ts.
    triggerMode: 'event',
    scale: 'minor',
    defaultOctave: -1,
    defaultNotes: ['C'],
    bindings: [
      { sourceParamId: 'bendStrength', target: 'pitch', range: [0, 1] },
      { sourceParamId: 'density', target: 'filterCutoff', range: [0, 1] },
      { sourceParamId: 'glow', target: 'gain', range: [0.2, 1] },
      { sourceParamId: 'fieldRadius', target: 'noteDensity', range: [0, 0.8] },
    ],
  },
  {
    id: 'field-lines-sparse',
    label: 'Field Sparse',
    engine: 'arp',
    // Graze-to-pluck redesign: every note comes from an explicit pluck
    // event fired by the sketch, not a hover-gated schedule. See
    // SoundPreset.triggerMode's doc comment in types.ts.
    triggerMode: 'event',
    scale: 'pentatonic',
    defaultOctave: -2,
    defaultNotes: ['C'],
    bindings: [
      { sourceParamId: 'fieldRadius', target: 'pitch', range: [0.2, 0.9] },
      { sourceParamId: 'glow', target: 'filterCutoff', range: [0, 1] },
      { sourceParamId: 'bendStrength', target: 'noteDensity', range: [0, 0.4] },
    ],
  },

  // ---- Acid Melt — pad/drone, up to 5 variants, all tremolo-synced ----
  {
    id: 'acid-melt-drone',
    label: 'Melt Drone',
    engine: 'pad',
    scale: 'minor',
    defaultOctave: -1,
    // Single root — a drone is meant to be one grounding tone, not a
    // chord competing with the tremolo for attention.
    defaultNotes: ['C'],
    defaultLfoShape: 'sine',
    bindings: [
      { sourceParamId: 'u_hueSpeed', target: 'pitch', range: [0, 1] },
      { sourceParamId: 'u_warpAmount', target: 'filterCutoff', range: [0, 1] },
      // The tremolo-sync ask: Hue Speed also drives how fast the sound
      // itself pulses, so the pad audibly "breathes" at the same rate the
      // visual is cycling, rather than just being a static held tone with
      // a technically-bound-but-inaudible pitch relationship.
      { sourceParamId: 'u_hueSpeed', target: 'lfoRate', range: [0.1, 1] },
    ],
  },
  {
    id: 'acid-melt-shimmer',
    label: 'Melt Shimmer',
    engine: 'pad',
    scale: 'major',
    defaultOctave: 1,
    // A fifth apart — open and bright, distinct from Drone's single root
    // and Bright's own two-note character.
    defaultNotes: ['C', 'G'],
    defaultLfoShape: 'triangle',
    bindings: [
      { sourceParamId: 'u_warpAmount', target: 'pitch', range: [0, 1] },
      { sourceParamId: 'u_scale', target: 'filterCutoff', range: [0, 1] },
      { sourceParamId: 'u_hueSpeed', target: 'lfoRate', range: [0.2, 1] },
      { sourceParamId: 'u_warpAmount', target: 'lfoDepth', range: [0.2, 0.9] },
    ],
  },
  {
    id: 'acid-melt-deep',
    label: 'Melt Deep',
    engine: 'pad',
    scale: 'chromatic',
    // Single note, not a chord — a second oscillator this low reads as
    // mud/beat artifacts on most speakers rather than a "deep drone"
    // character. -1 rather than -2: -2 sat below what most devices'
    // speakers reproduce cleanly: still the lowest of the four synth
    // pads, but audible as a drone rather than mostly felt as rumble.
    defaultOctave: -1,
    defaultNotes: ['A'],
    defaultLfoShape: 'sine',
    bindings: [
      { sourceParamId: 'u_hueSpeed', target: 'pitch', range: [0, 0.6] },
      { sourceParamId: 'u_warpAmount', target: 'filterCutoff', range: [0, 0.7] },
      { sourceParamId: 'u_hueSpeed', target: 'lfoRate', range: [0.05, 0.5] },
    ],
  },
  {
    id: 'acid-melt-bright',
    label: 'Melt Bright',
    engine: 'pad',
    scale: 'major',
    // A specific two-note chord is what actually gives this its own
    // identity distinct from the other three synth pads, rather than
    // being a filter-cutoff reskin of Shimmer — the octave itself sits
    // at the same middle ground as most of the others (Shimmer's the
    // one that goes up, at +1).
    defaultOctave: 0,
    defaultNotes: ['A', 'F'],
    defaultLfoShape: 'square',
    bindings: [
      { sourceParamId: 'u_hueSpeed', target: 'pitch', range: [0.3, 1] },
      { sourceParamId: 'u_warpAmount', target: 'filterCutoff', range: [0.4, 1] },
      // Deliberately different from the other presets: here the tremolo
      // syncs to Warp Amount instead of Hue Speed — a real alternative
      // character, not just a cosmetic reskin of the same relationship.
      { sourceParamId: 'u_warpAmount', target: 'lfoRate', range: [0.2, 1] },
    ],
  },
  {
    id: 'interpol-pad',
    label: 'Interpol Pad',
    engine: 'pad',
    scale: 'minor',
    defaultLfoShape: 'sine',
    // A real recorded loop rather than synthesis — see lib/sound/engines/
    // pad.ts's sample-mode path. Recorded at A minor, 124bpm; playbackRate
    // transposes it against that root. Small key shifts near A read as
    // pure pitch change; larger ones will audibly speed the groove up or
    // down along with the pitch — the Key control's hint on this preset
    // says so directly.
    sampleUrl: '/sounds/interpol-pad.wav',
    sampleRootNote: 'A',
    sampleRootOctave: 0,
    sampleTempoBpm: 124,
    // Own default now (previously had none — every switch to this preset
    // just kept whatever notes/octave were already selected). A at
    // octave -1 sits the transposition target close to the sample's own
    // recorded root, which is exactly where this preset sounds best —
    // see the sample-mode transposition caveat above.
    defaultOctave: -1,
    defaultNotes: ['A'],
    bindings: [
      { sourceParamId: 'u_hueSpeed', target: 'lfoRate', range: [0.1, 0.8] },
      { sourceParamId: 'u_warpAmount', target: 'filterCutoff', range: [0.2, 1] },
    ],
  },

  // ---- Static Choir — pad, up to 5 variants ----
  // Deliberately distinct from Acid Melt across every axis a pad preset
  // can vary on: oscType gives each one an actually different voice (not
  // just different filter/LFO settings on the same sawtooth), and
  // scale/octave/notes are chosen to not repeat anything Acid Melt uses.
  {
    id: 'static-choir-sine',
    label: 'Choir Sine',
    engine: 'pad',
    oscType: 'sine',
    scale: 'major',
    defaultOctave: -1,
    defaultNotes: ['C', 'E'],
    bindings: [
      { sourceParamId: 'waveFrequency', target: 'pitch', range: [0.35, 0.65] },
      { sourceParamId: 'staticIntensity', target: 'filterCutoff', range: [0.2, 1] },
      { sourceParamId: 'lfoRate', target: 'lfoRate', range: [0, 1] },
      { sourceParamId: 'harmonicMix', target: 'lfoDepth', range: [0, 0.6] },
    ],
  },
  {
    id: 'static-choir-glass',
    label: 'Choir Glass',
    engine: 'pad',
    oscType: 'triangle',
    scale: 'major',
    defaultOctave: 1,
    defaultNotes: ['C', 'G'],
    bindings: [
      { sourceParamId: 'harmonicMix', target: 'filterCutoff', range: [0.3, 1] },
      { sourceParamId: 'glitchFrequency', target: 'lfoDepth', range: [0, 1] },
      { sourceParamId: 'waveAmplitude', target: 'pitch', range: [0.35, 0.65] },
      // Was missing entirely — this preset's tremolo rate had no
      // user-reachable control at all, sound panel or Modulate panel
      // alike, and sat permanently at PadEngine's DEFAULT_LIVE.lfoRate.
      // Same source control every other Static Choir preset already uses
      // for this target, so Wave/lfoShape and this stay consistent
      // across the whole tile family.
      { sourceParamId: 'lfoRate', target: 'lfoRate', range: [0, 1] },
    ],
  },
  {
    id: 'static-choir-hollow',
    label: 'Choir Hollow',
    engine: 'pad',
    oscType: 'square',
    scale: 'minor',
    defaultOctave: -1,
    defaultNotes: ['A'],
    bindings: [
      { sourceParamId: 'layerSpread', target: 'filterCutoff', range: [0.15, 0.85] },
      { sourceParamId: 'lfoRate', target: 'lfoRate', range: [0, 1] },
      { sourceParamId: 'staticIntensity', target: 'lfoDepth', range: [0, 0.7] },
    ],
  },
  {
    id: 'static-choir-wide',
    label: 'Choir Wide',
    engine: 'pad',
    oscType: 'sawtooth',
    scale: 'pentatonic',
    defaultOctave: 1,
    defaultNotes: ['C', 'E', 'G'],
    bindings: [
      { sourceParamId: 'harmonicMix', target: 'filterCutoff', range: [0.2, 1] },
      { sourceParamId: 'waveFrequency', target: 'lfoRate', range: [0, 1] },
      { sourceParamId: 'glitchFrequency', target: 'lfoDepth', range: [0, 0.8] },
    ],
  },
  {
    id: 'static-choir-dark-braam',
    label: 'Dark Braam',
    engine: 'pad',
    scale: 'chromatic',
    // Recorded pitch confirmed by autocorrelation analysis of the actual
    // file: a stable F#1 (~46Hz) across the whole sample, well within the
    // sub-bass/braam range the name promises. defaultOctave held at 0
    // (as specified) rather than pushed negative — the recording is
    // already this heavy on its own; sampleRootOctave matches it so the
    // preset opens at the sample's natural, untransposed pitch instead of
    // compounding the low end with an additional octave-down shift.
    defaultOctave: 0,
    defaultNotes: ['F#'],
    sampleUrl: '/sounds/dark-braam.wav',
    sampleRootNote: 'F#',
    sampleRootOctave: 0,
    bindings: [
      { sourceParamId: 'staticIntensity', target: 'filterCutoff', range: [0.2, 1] },
      { sourceParamId: 'waveFrequency', target: 'lfoRate', range: [0, 0.6] },
    ],
  },

  // ---- Star Field — pad, 3 synth + 2 sample-backed ----
  {
    id: 'star-field-drift',
    label: 'Starlight Drift',
    engine: 'pad',
    oscType: 'sine',
    scale: 'major',
    defaultOctave: -1,
    defaultNotes: ['E', 'B'],
    defaultHumanize: true,
    defaultSwing: true,
    defaultLfoShape: 'triangle',
    bindings: [
      { sourceParamId: 'speed', target: 'lfoRate', range: [0, 1] },
      { sourceParamId: 'turbulence', target: 'filterCutoff', range: [0.2, 1] },
      { sourceParamId: 'glitterIntensity', target: 'lfoDepth', range: [0, 1] },
    ],
  },
  {
    id: 'star-field-nebula',
    label: 'Nebula Swell',
    engine: 'pad',
    oscType: 'triangle',
    scale: 'pentatonic',
    defaultOctave: -1,
    defaultNotes: ['D'],
    bindings: [
      { sourceParamId: 'focalDepth', target: 'filterCutoff', range: [0.15, 0.9] },
      { sourceParamId: 'turbulence', target: 'lfoRate', range: [0, 0.7] },
      { sourceParamId: 'brightness', target: 'lfoDepth', range: [0, 0.6] },
    ],
  },
  {
    id: 'star-field-dust',
    label: 'Cosmic Dust',
    engine: 'pad',
    oscType: 'square',
    scale: 'minor',
    defaultOctave: 1,
    defaultNotes: ['D', 'F'],
    defaultLfoShape: 'sine',
    bindings: [
      { sourceParamId: 'glitterIntensity', target: 'filterCutoff', range: [0.2, 1] },
      // Was [0, 0.8] — at the fast end of that, the tremolo's own period
      // gets short enough that it started reading as crackle/static
      // rather than a smooth pulse (an unset defaultLfoShape compounded
      // this — see the added default above). Narrowed to a slower
      // ceiling so the tremolo stays audibly a *wave*, not a stutter,
      // regardless of where `speed` sits.
      { sourceParamId: 'speed', target: 'lfoRate', range: [0, 0.3] },
      { sourceParamId: 'trailAmount', target: 'lfoDepth', range: [0, 0.7] },
    ],
  },
  {
    id: 'star-field-discover-pad',
    label: 'Discover Pad',
    engine: 'pad',
    scale: 'major',
    defaultLfoShape: 'sine',
    // Recorded pitch: stable B1 (~62Hz) by autocorrelation. defaultOctave
    // held at 0 rather than the true-measured -2 — see Dark Braam's
    // comment for the reasoning: sampleRootOctave matches defaultOctave
    // so the preset opens at its natural pitch, in a register that reads
    // as open/spacey rather than pushed into sub-bass territory.
    defaultOctave: 0,
    defaultNotes: ['B'],
    sampleUrl: '/sounds/discover-pad.wav',
    sampleRootNote: 'B',
    sampleRootOctave: 0,
    sampleTempoBpm: 104,
    bindings: [
      { sourceParamId: 'turbulence', target: 'filterCutoff', range: [0.2, 1] },
      { sourceParamId: 'speed', target: 'lfoRate', range: [0.1, 0.7] },
    ],
  },
  {
    id: 'star-field-jaded-pad',
    label: 'Jaded Pad',
    engine: 'pad',
    scale: 'minor',
    // Recorded pitch: stable C3 (~131Hz), the one sample of the five
    // whose measured pitch landed exactly on this app's octave-0 baseline
    // with no adjustment needed at all.
    defaultOctave: 0,
    defaultNotes: ['C'],
    sampleUrl: '/sounds/jaded-pad.wav',
    sampleRootNote: 'C',
    sampleRootOctave: 0,
    sampleTempoBpm: 174,
    bindings: [
      { sourceParamId: 'focalDepth', target: 'filterCutoff', range: [0.2, 1] },
      { sourceParamId: 'glitterIntensity', target: 'lfoDepth', range: [0, 0.8] },
      // Was missing entirely, same gap as Choir Glass above. Mirrors
      // Discover Pad's own binding exactly — both are sample-backed Star
      // Field pads, so the same source/range keeps their tremolo feel
      // consistent with each other.
      { sourceParamId: 'speed', target: 'lfoRate', range: [0.1, 0.7] },
    ],
  },
  {
    id: 'star-field-rising-star',
    label: 'Rising Star',
    engine: 'pad',
    scale: 'major',
    // Autocorrelation landed on A4 (~450Hz, +39 cents) — a real detection,
    // not boundary-hugging like a couple of the earlier ones, but still a
    // basic single-pass detector; worth a quick listen at octave 0 to
    // confirm before trusting it fully.
    defaultOctave: 1,
    defaultNotes: ['A'],
    sampleUrl: '/sounds/rising-star.wav',
    sampleRootNote: 'A',
    sampleRootOctave: 1,
    sampleTempoBpm: 104,
    bindings: [
      { sourceParamId: 'brightness', target: 'filterCutoff', range: [0.2, 1] },
      { sourceParamId: 'trailAmount', target: 'lfoRate', range: [0.1, 0.6] },
    ],
  },

  // ---- Cursor Ripple — arp, event (each ripple spawn is one pluck) ----
  // Water drops, bells, percussive arpeggio character, per brief. Mirrors
  // Field Lines' graze-to-pluck exactly, just triggered by spawn() in
  // cursor-ripple.js (mouse move, click, or touch) instead of a line
  // crossing — see that file's comment at the call site.
  {
    id: 'cursor-ripple-drop',
    label: 'Ripple Drop',
    engine: 'arp',
    triggerMode: 'event',
    scale: 'pentatonic',
    defaultOctave: 1,
    defaultNotes: ['C'],
    bindings: [
      { sourceParamId: 'rippleSpeed', target: 'pitch', range: [0.3, 0.7] },
      { sourceParamId: 'decay', target: 'filterCutoff', range: [0.3, 1] },
      { sourceParamId: 'maxRipples', target: 'noteDensity', range: [0.2, 0.8] },
    ],
  },
  {
    id: 'cursor-ripple-bell',
    label: 'Ripple Bell',
    engine: 'arp',
    triggerMode: 'event',
    scale: 'major',
    defaultOctave: 2,
    defaultNotes: ['C', 'E'],
    bindings: [
      { sourceParamId: 'decay', target: 'filterCutoff', range: [0.4, 1] },
      { sourceParamId: 'rippleSpeed', target: 'noteDensity', range: [0.2, 0.9] },
    ],
  },
  {
    id: 'cursor-ripple-cascade',
    label: 'Ripple Cascade',
    engine: 'arp',
    triggerMode: 'event',
    scale: 'chromatic',
    defaultOctave: 0,
    defaultNotes: ['C', 'D#', 'G'],
    bindings: [
      { sourceParamId: 'density', target: 'noteDensity', range: [0.3, 1] },
      { sourceParamId: 'rippleSpeed', target: 'pitch', range: [0.2, 0.8] },
    ],
  },
  {
    id: 'cursor-ripple-deep',
    label: 'Ripple Deep',
    engine: 'arp',
    triggerMode: 'event',
    scale: 'minor',
    defaultOctave: -1,
    defaultNotes: ['A'],
    bindings: [
      { sourceParamId: 'decay', target: 'filterCutoff', range: [0.15, 0.7] },
      { sourceParamId: 'maxRipples', target: 'noteDensity', range: [0.15, 0.6] },
    ],
  },
  {
    id: 'cursor-ripple-toll',
    label: 'Ripple Toll',
    engine: 'arp',
    triggerMode: 'event',
    // Replaces the former 'Bell Arp' preset, which used a sample-backed
    // PadEngine loop (only PadEngine can play samples) but Cursor Ripple's
    // sketch fires discrete pluck() events per ripple — and PadEngine has
    // no pluck() at all; pluckTileAudio() only ever forwards to an
    // ArpEngine. The two were structurally incompatible: the sample just
    // looped continuously regardless of cursor activity, no fix short of
    // this swap. This preset is genuinely event-driven instead, at the
    // cost of a synthesized rather than sampled tone. 'square' (rather
    // than every other Ripple arp preset's implicit 'triangle') is the
    // first preset here to actually use ArpEngine's oscType support —
    // added alongside this swap — for a darker, more metallic character
    // that echoes the sample's own low, driving register (which sat on
    // A#2 most consistently) without trying to reproduce it.
    oscType: 'square',
    scale: 'chromatic',
    defaultOctave: -1,
    defaultNotes: ['A#'],
    bindings: [
      { sourceParamId: 'rippleSpeed', target: 'filterCutoff', range: [0.2, 1] },
      { sourceParamId: 'density', target: 'noteDensity', range: [0.2, 0.7] },
    ],
  },

  // ---- Chorus of Eyes — arp, event (each blink is one pluck) ----
  // Oddball/abstract per brief — several presets ship with Humanize
  // and/or Swing pre-engaged via defaultHumanize/defaultSwing, still
  // fully overridable from the header row afterward. Mirrors graze-to-
  // pluck again: the trigger is each eye's blink transition, wired in
  // chorus-of-eyes.js at the point blinking starts.
  {
    id: 'chorus-eyes-flicker',
    label: 'Eye Flicker',
    engine: 'arp',
    triggerMode: 'event',
    scale: 'chromatic',
    defaultOctave: 1,
    defaultNotes: ['C', 'F#'],
    defaultHumanize: true,
    bindings: [
      { sourceParamId: 'trackingSpeed', target: 'pitch', range: [0.2, 0.8] },
      { sourceParamId: 'blinkFrequency', target: 'noteDensity', range: [0.2, 1] },
      { sourceParamId: 'gridDensity', target: 'filterCutoff', range: [0.2, 0.9] },
    ],
  },
  {
    id: 'chorus-eyes-cluster',
    label: 'Eye Cluster',
    engine: 'arp',
    triggerMode: 'event',
    scale: 'pentatonic',
    defaultOctave: 0,
    defaultNotes: ['D', 'A'],
    defaultSwing: true,
    bindings: [
      { sourceParamId: 'blinkFrequency', target: 'pitch', range: [0.2, 0.8] },
      { sourceParamId: 'trackingSpeed', target: 'noteDensity', range: [0.2, 0.9] },
      { sourceParamId: 'gridDensity', target: 'filterCutoff', range: [0.3, 1] },
    ],
  },
  {
    id: 'chorus-eyes-static',
    label: 'Eye Static',
    engine: 'arp',
    triggerMode: 'event',
    scale: 'chromatic',
    defaultOctave: -1,
    defaultNotes: ['C', 'C#'],
    defaultHumanize: true,
    defaultSwing: true,
    bindings: [
      { sourceParamId: 'trackingSpeed', target: 'filterCutoff', range: [0.15, 0.85] },
      { sourceParamId: 'blinkFrequency', target: 'noteDensity', range: [0.3, 1] },
    ],
  },
  {
    id: 'chorus-eyes-watch',
    label: 'Eye Watch',
    engine: 'arp',
    triggerMode: 'event',
    scale: 'major',
    defaultOctave: 1,
    defaultNotes: ['E'],
    bindings: [
      { sourceParamId: 'gridDensity', target: 'pitch', range: [0.2, 0.8] },
      { sourceParamId: 'trackingSpeed', target: 'filterCutoff', range: [0.2, 0.9] },
    ],
  },
  {
    id: 'chorus-eyes-all-eyes',
    label: 'All Eyes',
    engine: 'pad',
    // A looping abstract fx bed, not a played instrument — PadEngine's
    // sample-loop path again, same reasoning as Bell Arp. Recorded pitch:
    // a thin, high G#6 (~1.7kHz) most consistently, well above this app's
    // octave slider's +2 ceiling (true measurement is closer to +3).
    // defaultOctave/sampleRootOctave both clamped to +2 — the practical
    // maximum reachable through the UI — rather than left mismatched,
    // which would otherwise transpose the preset down on open before the
    // user ever touches anything.
    scale: 'chromatic',
    defaultOctave: 2,
    defaultNotes: ['G#'],
    sampleUrl: '/sounds/all-eyes.wav',
    sampleRootNote: 'G#',
    sampleRootOctave: 2,
    sampleTempoBpm: 174,
    bindings: [
      { sourceParamId: 'trackingSpeed', target: 'filterCutoff', range: [0.2, 1] },
      { sourceParamId: 'blinkFrequency', target: 'lfoRate', range: [0.1, 0.7] },
    ],
  },

  // ---- Wound Thread — abstract, foley/texture (4 presets) ----
  // Continuous physics sim (spring-back thread, drag-and-push), not
  // pitched notes in spirit at all — this is the one tile that needed a
  // genuinely new engine class rather than reusing arp/pad. Notes/Scale/
  // Octave are hidden in the Sound panel for engine: 'abstract' (nothing
  // here reads them); `scale: 'chromatic'` below is a required-field
  // placeholder only, never actually used by AbstractEngine.
  //
  // The 5 procedural-noise presets that used to live here (Sinew, Breath,
  // Pulse, Nerve, Hum) are gone, not retuned — dropped by request rather
  // than kept as an option, so this tile is now exactly the 4 supplied
  // one-shot samples below and nothing else.
  //
  // interactionGated REMOVED after several rounds of trying to calibrate
  // it — wound-thread.js no longer computes or sends an energy signal at
  // all; it fires p.pluck() directly (an immediate one on press, then
  // again every ~30px of drag movement), the same proven mechanism Field
  // Lines/Cursor Ripple/SVG Particle/Grid Snake's eat-trigger already
  // use, via pluckTileAudio()'s AbstractEngine + oneShot branch. That
  // also fixed a real, separate bug: interactionGated's continuous
  // energy-floor multiplier was still scaling a triggered one-shot's
  // OVERALL volume for its whole multi-second playback — including via
  // Retrigger, which never touches an energy signal at all — which is
  // why every preset here was reading as barely audible regardless of
  // how it was triggered. See targetGain()'s doc in abstract.ts.
  //
  // Three short (~1s) percussive samples, triggered as one-shots. No
  // sampleRootNote/sampleRootOctave/sampleTempoBpm: those only mean
  // anything for PadEngine's pitch-via-playbackRate transposition, and
  // AbstractEngine never exposes a pitch control surface at all
  // (Notes/Scale/Octave are hidden for every abstract preset), so there's
  // nothing for them to drive here — setting them would imply a
  // capability that doesn't exist.
  {
    id: 'wound-thread-proton-shoot',
    label: 'Proton Shoot',
    engine: 'abstract',
    scale: 'chromatic',
    oneShot: true,
    sampleUrl: '/sounds/proton-shoot.wav',
    noiseFilterType: 'bandpass',
    filterRange: [500, 5000],
    bindings: [
      { sourceParamId: 'pushStrength', target: 'filterCutoff', range: [0.3, 1] },
    ],
  },
  {
    id: 'wound-thread-drop-nickel',
    label: 'Drop Nickel',
    engine: 'abstract',
    scale: 'chromatic',
    oneShot: true,
    sampleUrl: '/sounds/drop-nickel.wav',
    noiseFilterType: 'bandpass',
    filterRange: [400, 4000],
    bindings: [
      { sourceParamId: 'pushRadius', target: 'filterCutoff', range: [0.25, 0.9] },
    ],
  },
  {
    id: 'wound-thread-808-head',
    label: '808 Head',
    engine: 'abstract',
    scale: 'chromatic',
    oneShot: true,
    sampleUrl: '/sounds/808-head.wav',
    noiseFilterType: 'lowpass',
    filterRange: [150, 2500],
    bindings: [
      { sourceParamId: 'neighborStiffness', target: 'filterCutoff', range: [0.2, 0.8] },
    ],
  },
  {
    id: 'wound-thread-abstract-impact',
    label: 'Abstract Impact',
    engine: 'abstract',
    scale: 'chromatic',
    oneShot: true,
    sampleUrl: '/sounds/abstract-impact.wav',
    noiseFilterType: 'bandpass',
    filterRange: [300, 4500],
    bindings: [
      { sourceParamId: 'pulseRate', target: 'filterCutoff', range: [0.25, 0.9] },
    ],
  },

  // ---- SVG Particle — arp, scheduled (hover-gated), 4 presets ----
  // No natural discrete "moment" the way Field Lines has a line-crossing
  // or Cursor Ripple has a spawn — this is continuous repel/return
  // physics, so event-mode (graze-to-pluck) is the wrong fit. Hover-gated
  // SCHEDULED mode (triggerMode omitted, defaults to 'scheduled') is the
  // right one instead: hovering the tile activates the schedule loop
  // exactly like Field Lines did before graze-to-pluck existed, and
  // `spin` — the particles' own rotation speed — drives noteDensity, so
  // the arp's pace visibly tracks the particles' own motion.
  //
  // REWRITTEN from hover-gated scheduled mode to genuine event mode —
  // hover was a proxy for "near the tile," not "touching a particle": it
  // meant sound played even with the cursor sitting in a ring shape's
  // hollow center, where no particle exists at all. svg-particle.js now
  // detects, per particle per frame, the moment it crosses INTO
  // repelRadius (not while it stays inside — a rising edge, same "graze,
  // don't buzz" instinct as Field Lines' line-crossing pluck) and fires
  // p.pluck() at that particle's own position. triggerMode: 'event' below
  // is what stops setTileHovering() from ALSO starting the old scheduled
  // loop — without it, hovering would still trigger sound on top of the
  // new proximity triggering, which is exactly the bug being fixed.
  //
  // Verified by simulation, not just by reasoning about it: hovering a
  // ring shape's hollow center produced zero plucks; sweeping the cursor
  // through the actual particle band produced hundreds (which ArpEngine's
  // own pluck() rate-limiting then throttles to a musical cadence on the
  // engine side — the sketch's only job is to report genuine crossings).
  //
  // spin -> noteDensity kept, but its role changed: pluck()'s own rate-
  // limiter reads noteDensity as a MAX-RATE ceiling (see arp.ts), so this
  // is no longer "the tempo" the way it was in scheduled mode — it's a
  // safety ceiling that happens to scale with spin, so a fast-spinning
  // field sweeping many particles past the cursor per second doesn't
  // overwhelm the engine with an unmusical wall of notes. The actual
  // number of notes per second now emerges from real particle crossings,
  // not a formula.
  //
  // curve: 'abs' on every spin binding, kept from the previous pass:
  // spin is bipolar (-1.5..1.5, default 0.08), and linear normalization
  // treats 0 as the range's middle rather than its own resting point —
  // 'abs' normalizes by distance from zero instead. oscType assigned
  // distinctly per preset (all four previously fell through to the same
  // shared 'triangle' default).
  {
    id: 'svg-particle-ring-chime',
    label: 'Ring Chime',
    engine: 'arp',
    triggerMode: 'event',
    oscType: 'sine',
    scale: 'major',
    defaultOctave: 1,
    defaultNotes: ['C', 'G'],
    bindings: [
      { sourceParamId: 'spin', target: 'noteDensity', range: [0.08, 0.55], curve: 'abs' },
      { sourceParamId: 'repelForce', target: 'pitch', range: [0.3, 0.7] },
    ],
  },
  {
    id: 'svg-particle-grid-pulse',
    label: 'Grid Pulse',
    engine: 'arp',
    triggerMode: 'event',
    oscType: 'square',
    scale: 'pentatonic',
    defaultOctave: 0,
    defaultNotes: ['D'],
    bindings: [
      { sourceParamId: 'spin', target: 'noteDensity', range: [0.08, 0.5], curve: 'abs' },
      { sourceParamId: 'scale', target: 'filterCutoff', range: [0.2, 1] },
    ],
  },
  {
    id: 'svg-particle-burst-arp',
    label: 'Burst Arp',
    engine: 'arp',
    triggerMode: 'event',
    oscType: 'sawtooth',
    scale: 'chromatic',
    defaultOctave: 1,
    defaultNotes: ['E', 'A#'],
    defaultHumanize: true,
    bindings: [
      { sourceParamId: 'spin', target: 'noteDensity', range: [0.1, 0.65], curve: 'abs' },
      { sourceParamId: 'repelRadius', target: 'filterCutoff', range: [0.2, 0.9] },
    ],
  },
  {
    id: 'svg-particle-wave-drift',
    label: 'Wave Drift',
    engine: 'arp',
    triggerMode: 'event',
    oscType: 'triangle',
    scale: 'minor',
    defaultOctave: -1,
    defaultNotes: ['A'],
    bindings: [
      { sourceParamId: 'spin', target: 'noteDensity', range: [0.06, 0.45], curve: 'abs' },
      { sourceParamId: 'drift', target: 'pitch', range: [0.3, 0.7] },
    ],
  },

  // ---- Digital Matrix — pad, 6 presets ----
  // IDs kept stable from the previous round (digital-matrix-drift /
  // digital-matrix-pulse) even though labels changed — renaming an id
  // outright breaks any board that already had the old one selected
  // (SoundPanel falls back to the first compatible preset for DISPLAY,
  // but engine.ts's startTileAudio() reads the raw stored id directly and
  // just refuses to start if it's gone — a silent, confusing failure).
  // Policy going forward: relabel/retune in place, never delete/rename an
  // id.
  //
  // gainTrim added to both synth presets — reported as too loud even
  // after their filter/LFO retune. A limiter now exists on the master bus
  // (lib/sound/context.ts) as a safety net, but the actual fix for "this
  // specific preset is hot" belongs at the source, not leaned on the
  // limiter to squash after the fact.
  {
    id: 'digital-matrix-drift',
    label: 'Signal Drift',
    engine: 'pad',
    oscType: 'triangle',
    scale: 'chromatic',
    defaultOctave: 0,
    defaultNotes: ['C#', 'F#'],
    gainTrim: 0.55,
    bindings: [
      { sourceParamId: 'fallSpeed', target: 'lfoRate', range: [0.05, 0.35] },
      { sourceParamId: 'swapRate', target: 'filterCutoff', range: [0.08, 0.35] },
    ],
  },
  {
    id: 'digital-matrix-pulse',
    label: 'Cipher Pulse',
    engine: 'pad',
    oscType: 'square',
    scale: 'chromatic',
    defaultOctave: 0,
    defaultNotes: ['G#'],
    defaultLfoShape: 'square',
    gainTrim: 0.45,
    bindings: [
      { sourceParamId: 'fallSpeed', target: 'lfoRate', range: [0.15, 0.55] },
      { sourceParamId: 'columns', target: 'filterCutoff', range: [0.1, 0.45] },
    ],
  },
  {
    id: 'digital-matrix-glitch-mode',
    label: 'Glitch Mode',
    engine: 'pad',
    scale: 'chromatic',
    defaultOctave: 0,
    defaultNotes: ['C'],
    sampleUrl: '/sounds/glitch-mode.wav',
    sampleRootNote: 'C',
    sampleRootOctave: 0,
    sampleTempoBpm: 91,
    bindings: [
      { sourceParamId: 'swapRate', target: 'filterCutoff', range: [0.2, 1] },
      { sourceParamId: 'trailLen', target: 'lfoRate', range: [0.1, 0.6] },
    ],
  },
  {
    id: 'digital-matrix-tension',
    label: 'Matrix Tension',
    engine: 'pad',
    scale: 'chromatic',
    defaultOctave: -1,
    defaultNotes: ['G'],
    sampleUrl: '/sounds/matrix-tension.wav',
    // Autocorrelation landed on G1 (~50Hz) — right at the edge of the
    // search range, so treat as a rough starting point, not a
    // measurement.
    sampleRootNote: 'G',
    sampleRootOctave: -1,
    sampleTempoBpm: 104,
    bindings: [
      { sourceParamId: 'fallSpeed', target: 'lfoRate', range: [0.1, 0.5] },
      { sourceParamId: 'columns', target: 'filterCutoff', range: [0.15, 0.5] },
    ],
  },
  {
    id: 'digital-matrix-drone',
    label: 'Texture Drone',
    engine: 'pad',
    scale: 'chromatic',
    defaultOctave: -1,
    defaultNotes: ['D'],
    sampleUrl: '/sounds/texture-drone.wav',
    // Autocorrelation's result here didn't look trustworthy — D1 is a
    // placeholder, not a measurement.
    sampleRootNote: 'D',
    sampleRootOctave: -1,
    sampleTempoBpm: 104,
    bindings: [
      { sourceParamId: 'fallSpeed', target: 'lfoRate', range: [0.05, 0.3] },
      { sourceParamId: 'swapRate', target: 'filterCutoff', range: [0.1, 0.4] },
    ],
  },
  {
    id: 'digital-matrix-escape-drone',
    label: 'Escape Drone',
    engine: 'pad',
    scale: 'chromatic',
    // Autocorrelation: stable F#1 (~46Hz, -1 cent) — a confident
    // detection, not boundary-hugging, and it lands on the exact same
    // pitch Dark Braam's own confirmed-by-ear F#1 measurement did, at the
    // same app-octave-0 mapping.
    defaultOctave: 0,
    defaultNotes: ['F#'],
    sampleUrl: '/sounds/escape-drone.wav',
    sampleRootNote: 'F#',
    sampleRootOctave: 0,
    sampleTempoBpm: 104,
    bindings: [
      { sourceParamId: 'fallSpeed', target: 'lfoRate', range: [0.05, 0.35] },
      { sourceParamId: 'trailLen', target: 'filterCutoff', range: [0.1, 0.45] },
    ],
  },

  // ---- Grid Snake — arp + sample, 4 presets ----
  // IDs kept stable from the previous round (grid-snake-drift /
  // grid-snake-pulse) even though the engine changed from pad to arp —
  // same reasoning as Digital Matrix's ids above.
  // The previous pair used PadEngine (sustained drone/pad) — replaced
  // entirely with scheduled arp, which reads as arcade/chiptune in a way
  // a pad fundamentally can't: discrete plucked notes, not a held tone.
  // `speed` (cells moved per second) drives noteDensity, so the arp's
  // pace tracks the snake's own movement exactly like SVG Particle's
  // spin -> noteDensity above (speed is unipolar here, so no curve:'abs'
  // needed — its default sits at a sensible point in its own range
  // already, unlike spin's bipolar-around-zero case).
  {
    id: 'grid-snake-drift',
    label: '8-Bit Chase',
    engine: 'arp',
    scale: 'pentatonic',
    defaultOctave: 1,
    defaultNotes: ['C', 'E'],
    bindings: [
      { sourceParamId: 'speed', target: 'noteDensity', range: [0.2, 0.9] },
      { sourceParamId: 'fade', target: 'filterCutoff', range: [0.3, 0.9] },
    ],
  },
  {
    id: 'grid-snake-pulse',
    label: 'Coin Run',
    engine: 'arp',
    scale: 'major',
    defaultOctave: 2,
    defaultNotes: ['G'],
    defaultSwing: true,
    bindings: [
      { sourceParamId: 'speed', target: 'noteDensity', range: [0.25, 1] },
      { sourceParamId: 'cellSize', target: 'pitch', range: [0.3, 0.7] },
    ],
  },
  // Two percussion-loop samples — root note is a neutral placeholder (no
  // clear singable pitch to detect in a drum loop); transposing these
  // mostly reads as a tempo/character shift rather than a pitch change,
  // same caveat Interpol Pad's own hint text already gives for exactly
  // this situation.
  // Converted from PadEngine (continuous looping pad) to AbstractEngine
  // one-shot — the loop was correct as originally built (both samples
  // are genuinely loop-length material), but it played independently of
  // gameplay, which read as generic background noise rather than
  // something the snake was doing. Now triggered fresh on every eat via
  // the same p.pluck() call grid-snake.js already fires for the arp
  // presets above — pluckTileAudio() forwards to AbstractEngine.
  // retrigger() for a oneShot preset (see that function's own doc), so
  // this is the exact same "play the whole sample, then wait for the
  // next eat to restart it" behavior as pressing Retrigger, just driven
  // by the game instead of a button. No sampleRootNote/sampleRootOctave/
  // sampleTempoBpm — same reasoning as Wound Thread's one-shots: those
  // only mean anything for PadEngine's pitch-via-playbackRate
  // transposition, and AbstractEngine has no pitch control surface at
  // all to drive with them.
  {
    id: 'grid-snake-arcade-drum',
    label: 'Arcade Drum',
    engine: 'abstract',
    scale: 'chromatic',
    oneShot: true,
    sampleUrl: '/sounds/arcade-drum.wav',
    noiseFilterType: 'lowpass',
    filterRange: [800, 8000],
    bindings: [
      { sourceParamId: 'fade', target: 'filterCutoff', range: [0.3, 1] },
    ],
  },
  {
    id: 'grid-snake-digital-safari',
    label: 'Digital Safari',
    engine: 'abstract',
    scale: 'chromatic',
    oneShot: true,
    sampleUrl: '/sounds/digital-safari.wav',
    noiseFilterType: 'lowpass',
    filterRange: [800, 8000],
    bindings: [
      { sourceParamId: 'cellSize', target: 'filterCutoff', range: [0.3, 1] },
    ],
  },
];

export function getPreset(id: string | null): SoundPreset | undefined {
  if (!id) return undefined;
  return SOUND_PRESETS.find((p) => p.id === id);
}

/** Presets whose bindings are all satisfiable against this schema's real
    controls — what the Preset select offers for a given asset. */
export function getCompatiblePresets(schema: ControlSchema | null): SoundPreset[] {
  if (!schema) return [];
  const ids = new Set(schema.controls.map((c) => c.id));
  return SOUND_PRESETS.filter((preset) =>
    preset.bindings.every((b) => ids.has(b.sourceParamId)),
  );
}
