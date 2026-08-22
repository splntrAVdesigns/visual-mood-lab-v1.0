/**
 * Visual Mood Lab — tile sound presets.
 *
 * Sibling to lib/modulation/bus.ts, running in the opposite direction: that
 * system samples a SOURCE (LFO, pointer, eventually audio-in) and drives a
 * visual control. This module samples a visual control's CURRENT VALUE and
 * drives an audio parameter — audio-out rather than audio-in.
 *
 * SoundState (the persisted per-card shape) lives in
 * renderers/control-schema.ts alongside ModState, which it mirrors — see
 * that file. Everything here is the engine's own vocabulary instead,
 * mirroring how ModSource/MOD_SOURCES live in lib/modulation/bus.ts rather
 * than in control-schema.ts.
 *
 * Location: lib/sound/types.ts
 */

import type { SoundState, MusicalScale, LfoShape } from '@/renderers/control-schema';

export type SoundEngine = 'arp' | 'pad' | 'retro-oneshot' | 'abstract';

export type SoundTarget = 'pitch' | 'filterCutoff' | 'gain' | 'noteDensity' | 'tempo' | 'lfoRate' | 'lfoDepth';

export type { MusicalScale, LfoShape };

/**
 * Wave/Waveform-Shape sync convention — Static Choir's own visual
 * generator has a 'waveShape' select control (values SINE/SAW/SQUARE/
 * TRIANGLE, its own established vocabulary, predating Sound entirely)
 * that visually shapes the mock waveform. SoundState.lfoShape is the
 * Sound panel's "Wave" control, shaping the tremolo LFO's actual
 * oscillator. When a tile has both AND Sound is enabled, the two should
 * read as one control shown in two places rather than two independent
 * ones that happen to overlap in meaning — see InspectorDrawer's and
 * SoundPanel's onChange wiring, both of which import this mapping rather
 * than hardcoding it twice.
 *
 * Deliberately a naming + value-shape CONVENTION rather than a check
 * against a specific asset id — any control literally named
 * WAVE_SHAPE_CONTROL_ID using this exact four-value vocabulary opts in
 * automatically, the same way a SoundBinding's sourceParamId is just a
 * string match rather than being wired to a specific tile by name.
 */
export const WAVE_SHAPE_CONTROL_ID = 'waveShape';

export type WaveShapeValue = 'SINE' | 'SAW' | 'SQUARE' | 'TRIANGLE';

const LFO_SHAPE_TO_WAVE_SHAPE: Record<LfoShape, WaveShapeValue> = {
  sine: 'SINE',
  sawtooth: 'SAW',
  square: 'SQUARE',
  triangle: 'TRIANGLE',
};

const WAVE_SHAPE_TO_LFO_SHAPE: Record<WaveShapeValue, LfoShape> = {
  SINE: 'sine',
  SAW: 'sawtooth',
  SQUARE: 'square',
  TRIANGLE: 'triangle',
};

export function lfoShapeToWaveShapeValue(shape: LfoShape): WaveShapeValue {
  return LFO_SHAPE_TO_WAVE_SHAPE[shape];
}

/** Undefined for anything outside the known four values — a schema that
    happens to have some OTHER control named 'waveShape' with a different
    option set simply doesn't sync, rather than crashing on an unmapped
    value. Callers should treat undefined as "don't sync this control." */
export function waveShapeValueToLfoShape(value: unknown): LfoShape | undefined {
  return typeof value === 'string' && value in WAVE_SHAPE_TO_LFO_SHAPE
    ? WAVE_SHAPE_TO_LFO_SHAPE[value as WaveShapeValue]
    : undefined;
}

/**
 * One visual-control-to-audio-parameter mapping. Mirrors Modulation's
 * shape in spirit (a source plus a range, at apply time), just pointed the
 * other way: a visual param's live value in, an audio param's own range
 * out — rather than an LFO/pointer signal in, a visual param's range out.
 */
export interface SoundBinding {
  /** Which of the asset's own live controls drives this audio parameter. */
  sourceParamId: string;
  target: SoundTarget;
  /** [min, max] the audio parameter is mapped onto. */
  range: [number, number];
  /** 'abs' normalizes by distance from zero rather than position in
      min..max — see normalizeControlValue in engine.ts for the full
      reasoning. Use it for a bipolar source control (spin, scanline
      motion) where the target should track how much motion there is,
      not which direction it's signed. */
  curve?: 'linear' | 'exp' | 'abs';
}

export interface SoundPreset {
  id: string;
  label: string;
  engine: SoundEngine;
  scale: MusicalScale;
  bindings: SoundBinding[];
  /** For 'retro-oneshot' (a single hit) and for a sample-backed 'pad' (a
      looping recorded pad, like Interpol Pad) alike — path/URL to the
      audio file. */
  sampleUrl?: string;
  /**
   * Only meaningful alongside sampleUrl on a looping pad. The sample's own
   * recorded root note/octave and tempo, used to compute a playbackRate
   * that transposes it to the user's chosen key — the same technique real
   * hardware samplers have always used for pitched material. Pitch and
   * tempo shift together (playbackRate can't separate them without real
   * pitch-correction, which is out of scope here) — fine for small shifts
   * near the recorded root, audibly a tempo change for large ones. The
   * Key control's hint text says as much for any preset that sets this.
   */
  sampleRootNote?: string;
  sampleRootOctave?: number;
  sampleTempoBpm?: number;
  /** Default LFO wave shape for a tremolo-capable preset, used the first
      time a user enables it — SoundState.lfoShape overrides this once
      they've touched the control. */
  defaultLfoShape?: LfoShape;
  /**
   * Same idea as `scale`, applied the same way (see SoundPanel's preset
   * switch handler): the character-defining defaults a preset wants to
   * open with, applied on switch, still overridable afterward via the
   * Octave slider / note rack same as Scale is via its own select.
   * Omitted on most presets, which just keep whatever the user already
   * has selected — these exist for presets where a specific starting
   * point is part of the preset's actual identity (Field Chime's higher
   * register, Melt Bright's specific two-note chord).
   */
  defaultOctave?: number;
  defaultNotes?: string[];
  /**
   * Pad engine only. The oscillator waveform each voice uses —
   * PadEngine's addVoice() reads this, falling back to 'sawtooth' (the
   * only shape that existed before this field, so every preset that
   * predates it sounds unchanged). This is what gives presets on the same
   * tile genuinely different timbral character beyond just which controls
   * are bound to what: a sine-wave choir and a square-wave choir are
   * differently-voiced instruments, not the same voice with different
   * filter settings.
   */
  oscType?: 'sine' | 'sawtooth' | 'square' | 'triangle';
  /**
   * Same idea as defaultOctave/defaultNotes, applied the same way in
   * SoundPanel's preset switch handler: a preset can open with Humanize
   * and/or Swing already engaged as part of its own character, rather
   * than requiring the user to discover and enable them separately. Still
   * just setting the same toggles the header row exposes — fully
   * overridable afterward, nothing preset-exclusive about the behavior
   * itself.
   */
  defaultHumanize?: boolean;
  defaultSwing?: boolean;
  /**
   * Only meaningful for engine: 'arp'. 'scheduled' (the default, and the
   * only mode that existed before graze-to-pluck) runs ArpEngine's
   * self-driven note-per-interval loop, active only while the pool's
   * hover signal says the pointer is on the tile. 'event' does the
   * opposite: the schedule loop never starts, and hover state is ignored
   * entirely — every note comes from an explicit pluck() call, fired by
   * the sketch itself (Field Lines' graze detection is the first and so
   * far only source). A preset picks one model, not both; an engine that
   * both self-schedules AND responds to plucks would double up notes
   * with no way to tell which one produced a given hit.
   */
  triggerMode?: 'scheduled' | 'event';
  /**
   * Abstract engine only (see lib/sound/engines/abstract.ts). The
   * "instrument" is a looped noise buffer, not an oscillator — these
   * three shape which noise color feeds which filter, and across what
   * frequency range the bound filterCutoff control actually sweeps.
   * Omitted (== undefined) falls back to white noise through a bandpass
   * centered around 800Hz, same defaults the engine itself would use for
   * a preset that doesn't care to be more specific.
   */
  noiseColor?: 'white' | 'pink';
  noiseFilterType?: BiquadFilterType;
  filterRange?: [number, number];
  /**
   * Abstract engine only. When true, the engine stays near-silent until
   * the sketch actually reports interaction via setEnergy() (see
   * lib/sandbox/protocol.ts's `energy` doc and AbstractEngine.setEnergy),
   * then swells in proportionally — for tiles like Wound Thread where
   * the sound should be a direct consequence of the user pushing on it,
   * not a continuous drone that starts the moment Sound is switched on.
   * Omitted/false keeps the older always-on continuous behavior, for any
   * future abstract preset that genuinely wants an ambient bed instead.
   */
  interactionGated?: boolean;
  /**
   * Abstract engine + sampleUrl only. True plays a fresh one-shot copy of
   * the sample on each rising-edge crossing of the interaction-energy
   * threshold (rate-limited — see ONE_SHOT_MIN_INTERVAL_S in
   * abstract.ts), instead of looping the sample continuously. For short,
   * percussive/impact-style samples (a "tick", a hit) that should punch
   * in on each push rather than loop as a bed. Meaningless without both
   * sampleUrl and interactionGated set — a one-shot with nothing to
   * trigger it, or nothing to gate it, just never fires.
   */
  oneShot?: boolean;
  /**
   * Per-preset output trim, multiplied straight into whichever engine's
   * final gain computation applies (all three read it the same way).
   * Default 1 (no change) when omitted. Exists because some presets are
   * just inherently louder than others at the same Volume slider setting
   * — a chromatic 2-note chord on a bright oscillator sums hotter than a
   * single sine tone — and that's a source-level problem the master
   * limiter (see lib/sound/context.ts) is a safety net for, not a fix
   * for. Set this instead of asking the user's Volume control to
   * compensate for one specific preset being hot.
   */
  gainTrim?: number;
}

export const DEFAULT_SOUND_STATE: SoundState = {
  enabled: false,
  presetId: null,
  notes: ['C'],
  scale: 'major',
  octave: 0,
  lfoShape: 'sine',
  volume: 0.7,
  humanize: false,
  swing: false,
};

/** Ceiling on simultaneously selected notes. Three is a chord for the pad
    and a genuinely wide pool for the arp; past that a pad turns to mud and
    the arp's pitch mapping stops being legible as position-on-the-tile. */
export const MAX_SELECTED_NOTES = 3;

/**
 * Coerces a persisted (or partial) sound object into a complete, valid
 * SoundState.
 *
 * Two jobs, both load-bearing:
 *
 * 1. MIGRATION. `sound` is a JSONB column, so rows written before the note
 *    rack landed still carry the old `key: string` field and no `notes`
 *    array at all. Rather than a DB migration, those are lifted here on
 *    read: `{ key: 'F' }` becomes `{ notes: ['F'] }`. This is why every
 *    read path (the pool, the inspector store) must go through this
 *    function rather than spreading a raw row — a missing `notes` would
 *    otherwise reach an engine as undefined and throw on .map().
 *
 * 2. INVARIANTS. Guarantees notes is non-empty, contains only real
 *    chromatic roots, has no duplicates, and is within MAX_SELECTED_NOTES.
 *    The rack enforces all of this at the UI layer already; enforcing it
 *    here too means an engine can index notes[0] without a guard, and a
 *    hand-edited or corrupted row degrades to the default root instead of
 *    producing silence with no explanation.
 */
export function normalizeSoundState(raw: unknown): SoundState {
  const src = (raw ?? {}) as Partial<SoundState> & { key?: unknown };

  let notes: string[] = [];
  // Tracks whether `raw` actually HAD a notes array at all, as opposed to
  // ending up empty after filtering. That distinction matters: a
  // deliberately empty selection (the note rack now allows toggling off
  // the last note, meaning "mute this tile") must be respected as-is, but
  // a row that never had a notes field to begin with — pre-note-rack
  // legacy data, or something genuinely malformed — still needs the
  // ['C'] fallback below so an engine has SOMETHING to build from rather
  // than silently doing nothing for a reason nobody chose.
  const hadNotesField = Array.isArray(src.notes);
  if (hadNotesField) {
    notes = (src.notes as unknown[]).filter((n): n is string => typeof n === 'string');
  } else if (typeof src.key === 'string') {
    // Legacy single-key row, pre-note-rack.
    notes = [src.key];
  }

  const valid = (ROOT_NOTES as readonly string[]);
  notes = [...new Set(notes)].filter((n) => valid.includes(n)).slice(0, MAX_SELECTED_NOTES);
  if (notes.length === 0 && !hadNotesField) notes = [...DEFAULT_SOUND_STATE.notes];

  return {
    enabled: typeof src.enabled === 'boolean' ? src.enabled : DEFAULT_SOUND_STATE.enabled,
    presetId: typeof src.presetId === 'string' ? src.presetId : DEFAULT_SOUND_STATE.presetId,
    notes,
    scale: src.scale ?? DEFAULT_SOUND_STATE.scale,
    octave: typeof src.octave === 'number' ? src.octave : DEFAULT_SOUND_STATE.octave,
    lfoShape: src.lfoShape ?? DEFAULT_SOUND_STATE.lfoShape,
    volume: typeof src.volume === 'number' ? src.volume : DEFAULT_SOUND_STATE.volume,
    // Both new fields, both booleans, both absent on any row written
    // before this pass — same typeof guard pattern as everything else
    // here, defaulting a pre-existing row to "off" rather than throwing.
    humanize: typeof src.humanize === 'boolean' ? src.humanize : DEFAULT_SOUND_STATE.humanize,
    swing: typeof src.swing === 'boolean' ? src.swing : DEFAULT_SOUND_STATE.swing,
  };
}

/** All 12 chromatic root notes. The note rack renders these in order, two
    rows of six — see NoteRack.tsx. */
export const ROOT_NOTES = [
  'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B',
] as const;
