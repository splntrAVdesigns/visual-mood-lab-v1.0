/**
 * Visual Mood Lab — per-card uploaded audio tracks.
 *
 * Phase 4.9. Sibling to engine.ts (which drives a tile's own generated
 * sound), pointed at a different source: a file the person drops onto a
 * SPECIFIC card, decoded once, and played back through that card's own
 * subgraph. Nothing here is shared across cards — two tiles can have two
 * different tracks running at once, each driving only its own modulation
 * routes. See ModulationBus.sample()'s cardId parameter and this module's
 * getTrackBand(), which is what makes that true rather than aspirational.
 *
 * SESSION-ONLY BY DESIGN. A loaded track lives entirely in memory (an
 * AudioBuffer plus a couple of numbers) and is never uploaded anywhere —
 * no signed URL, no Blob write, no DB row. It's gone on refresh. This is a
 * deliberate v1 scope decision, not a missing feature: it sidesteps
 * storage cost and any question of what the person has the right to persist
 * for material that's very likely someone else's copyrighted music, and it
 * gets the reactive plumbing in front of real use before either of those
 * questions need an answer. Revisit once the feature itself is proven.
 *
 * TWO ANALYSERS PER TRACK, both tapped from the same always-unity gain
 * node (tapGain — see loadTrack()'s doc), feeding three consumers:
 *   1. getTrackBand() — a single 0..1 scalar per band, read by
 *      lib/modulation/bus.ts's rawSignal() for the generic audio.rms/
 *      bass/mid/high modulation sources. Works for ANY renderer type,
 *      since modulation operates on ParamValue, not on GLSL specifically.
 *      Reads the 64-bin frequency analyser.
 *   2. getTrackFrequencyData() — the full 64-bin array, in the exact shape
 *      renderers/types.ts's RenderContext.audio already expects (see that
 *      file's Phase 4 doc comment) and shader.renderer.ts's applyReserved()
 *      already consumes via u_bass/u_mid/u_high/u_rms. That uniform wiring
 *      predates this file and was previously always inert (nothing ever
 *      called pool.setAudio()) — this is the first real signal it receives,
 *      now scoped per-card via pool.ts's tick() rather than the single
 *      board-wide feed the RenderContext doc comment originally described.
 *      Same 64-bin frequency analyser as (1).
 *   3. getTrackWaveform()/getTrackLevel() — a separate, dedicated
 *      time-domain analyser (see TrackHandle's waveAnalyser field for why
 *      this can't share a node with 1/2 above), feeding p5.renderer.ts's
 *      audioWaveform bridge and SoundMeter.tsx's level dots respectively.
 *
 * AudioBufferSourceNode, not <audio>/MediaElementSourceNode: sample-accurate
 * looping (a board tile loops constantly — a seam at the loop point would
 * be far more noticeable here than in a one-shot player) and it composes
 * directly with the app's single shared AudioContext, same as every engine
 * in engines/. The tradeoff is the whole file decodes into memory up front,
 * which is why MAX_TRACK_BYTES exists below.
 *
 * Location: lib/sound/track.ts
 */

import { getAudioContext, getMasterGain, unlockAudio } from './context';
import { BandAutoGain } from './autoGain';

/* ------------------------------------------------------------------ *
 * Limits
 * ------------------------------------------------------------------ */

/** 80MB. Raised from an earlier 20MB cap that undershot common real-world
    track sizes — a lossless WAV/AIFF a few minutes long routinely lands
    in the 40-80MB range even well within MAX_TRACK_SECONDS below, and a
    compressed MP3/AAC at any reasonable bitrate stays far under this
    regardless. Decoded PCM still runs several times larger than the
    compressed file in memory once loaded — MAX_TRACK_SECONDS is what
    actually bounds a single tab's worst case, not this byte limit; this
    exists mainly to fail fast and give a clear error on a wildly
    oversized or wrong-file upload before attempting a slow decode. */
export const MAX_TRACK_BYTES = 80 * 1024 * 1024;

/** 12 minutes. A mood-board tile's track is meant to loop as a bed, not
    play a whole album side — this is a sanity ceiling, not a musical
    opinion, and exists mainly to fail fast on an accidental wrong-file
    upload rather than silently decoding something huge. */
export const MAX_TRACK_SECONDS = 12 * 60;

export const ALLOWED_TRACK_MIME = new Set([
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
  'audio/ogg',
  'audio/webm',
  'audio/aac',
  'audio/mp4',
  'audio/m4a',
  'audio/x-m4a',
  'audio/flac',
]);

export function isAllowedTrackMimeType(type: string): boolean {
  // Some browsers report an empty string for a correctly-encoded file
  // (notably .m4a from iOS share sheets) — decodeAudioData is the real
  // gate either way, so an empty/unknown type is let through rather than
  // rejected on a technicality the codec itself will catch if wrong.
  if (!type) return true;
  return ALLOWED_TRACK_MIME.has(type.toLowerCase());
}

/* ------------------------------------------------------------------ *
 * Types
 * ------------------------------------------------------------------ */

export type TrackBand = 'rms' | 'bass' | 'mid' | 'high';

export interface TrackMeta {
  title: string;
  durationSeconds: number;
  playing: boolean;
  loop: boolean;
  volume: number; // 0..1, applied to audible playback only — analysis is unaffected
  /** True mutes audible playback while leaving analysis (and therefore
      modulation) running — see the doc above the toggle in TrackSection.tsx
      for why this is worth having as its own control rather than tying to
      volume === 0. */
  mutedPlayback: boolean;
}

interface TrackHandle {
  buffer: AudioBuffer;
  title: string;
  gain: GainNode;
  /** Always-unity tap feeding both analysers below, independent of gain's
      mute/volume value — see loadTrack()'s doc above for why analysis
      can't simply read downstream of the audible-output gain node. */
  tapGain: GainNode;
  /** Frequency-domain only — fftSize 128, giving 64 bins, matching what
      shader.renderer.ts's applyReserved() and lib/modulation/bus.ts's
      audio.* sources both expect. NOT used for time-domain reads (see
      waveAnalyser below for why those need a different node entirely). */
  analyser: AnalyserNode;
  freqData: Float32Array<ArrayBuffer>; // reused across frames — normalized 0..1
  /** Time-domain only — fftSize 256, matching meter.ts's own analyser
      exactly. This has to be a SEPARATE node from `analyser` above, not
      just a second read method on it: an AnalyserNode's fftSize sets
      both its frequency-bin count (fftSize/2) and its time-domain buffer
      length simultaneously, and those two needs conflict here — 64 bins
      for modulation vs. 256 samples for p5.renderer.ts's audioWaveform
      bridge, which sends whatever it reads straight into the sandbox
      unconditionally, on a channel Static Choir (and the bridge itself)
      were built expecting a fixed 256-length array from. A single node
      at fftSize 128 sending a 128-length waveform where 256 was always
      previously sent is what broke every p5 tile's rendering the moment
      a track went active — not just ones that call p.getAudioWaveform()
      themselves. Giving the waveform its own node at fftSize 256 removes
      that mismatch entirely rather than chasing it inside the sandbox. */
  waveAnalyser: AnalyserNode;
  /** Reused across frames — refilled in place by getTrackWaveform() and
      getTrackLevel(), both of which read waveAnalyser, not analyser. */
  waveBuffer: Float32Array<ArrayBuffer>;
  /** Held peak-with-decay for getTrackLevel(), mirroring meter.ts's own
      algorithm for the synth engine — see that function's doc. */
  level: number;
  /** Auto-gain state for getTrackBand() — see lib/sound/autoGain.ts's
      doc for why this exists and why it's one instance per card rather
      than shared: each card's track has its own dynamics, so each needs
      its own peak history (bass is naturally much louder in raw
      magnitude than high, for most music — a single shared peak across
      bands, or across cards, would leave the quieter ones permanently
      reading near-zero). */
  bandGain: BandAutoGain<TrackBand>;
  source: AudioBufferSourceNode | null; // null while paused/stopped
  playing: boolean;
  loop: boolean;
  volume: number;
  mutedPlayback: boolean;
  /** ctx.currentTime this playback started at, minus the offset it started
      from — so currentTime is always `ctx.currentTime - startedAt` while
      playing, with no per-frame bookkeeping needed. */
  startedAt: number;
  /** Where playback is/was, in seconds into the buffer. The source of
      truth while paused; derived from startedAt while playing. */
  offset: number;
  /** sound.enabled's value at the moment this track was loaded — Phase
      4.9.1 makes Track and the synth preset mutually exclusive, so
      loading a track force-disables the synth (see TrackSection.tsx's
      onFileChange). This is what unloadTrack() hands back so the caller
      can restore it on explicit removal — see that function's return
      value doc. */
  previousSoundEnabled: boolean;
  /** Cached, referentially-stable TrackMeta — see buildMeta()/emitTrack()
      below. getTrackMeta() must return the SAME object reference across
      calls when nothing has changed, or useSyncExternalStore (see
      lib/hooks/useTrackState.ts) re-renders on every read, which
      re-triggers the read, which re-renders again — an infinite loop
      React eventually throws "Maximum update depth exceeded" (error #185)
      over. Rebuilt only at the point of an actual state change (every
      emitTrack() call), not on every read. */
  metaSnapshot: TrackMeta;
}

const tracks = new Map<string, TrackHandle>();

/* ------------------------------------------------------------------ *
 * Discrete-event subscription — load/unload/play/pause/seek/volume/loop.
 * NOT for smooth per-frame values (currentTime, level) — callers polling
 * those should read getTrackMeta()/getTrackCurrentTime() from their own
 * requestAnimationFrame loop, same convention as SoundMeter.tsx already
 * uses for the synth engine's level. This just tells a listener "something
 * about this card's track state changed, re-read it" — cheap for the
 * common case (ModulationPanel checking whether a track exists at all).
 * ------------------------------------------------------------------ */

type TrackListener = () => void;
const listeners = new Map<string, Set<TrackListener>>();

function emit(cardId: string): void {
  listeners.get(cardId)?.forEach((fn) => fn());
}

/** Builds a fresh TrackMeta from a handle's current field values. Called
    only from emitTrack() below — never from getTrackMeta() directly, which
    is what keeps the object referentially stable between real changes. */
function buildMeta(handle: TrackHandle): TrackMeta {
  return {
    title: handle.title,
    durationSeconds: handle.buffer.duration,
    playing: handle.playing,
    loop: handle.loop,
    volume: handle.volume,
    mutedPlayback: handle.mutedPlayback,
  };
}

/** The real notification path for anything that mutates a handle's public
    fields: refreshes the cached snapshot BEFORE notifying listeners, so a
    subscriber that reads getTrackMeta() inside its callback (or on the
    render triggered by it) sees the new values immediately, not the ones
    from before this change. Every mutator below calls this instead of the
    bare emit() above — the one exception is unloadTrack(), where the
    handle is being deleted rather than updated, so there's nothing to
    snapshot; it calls emit() directly. */
function emitTrack(cardId: string, handle: TrackHandle): void {
  handle.metaSnapshot = buildMeta(handle);
  emit(cardId);
}

export function subscribeTrack(cardId: string, fn: TrackListener): () => void {
  if (!listeners.has(cardId)) listeners.set(cardId, new Set());
  listeners.get(cardId)!.add(fn);
  return () => {
    listeners.get(cardId)?.delete(fn);
  };
}

/* ------------------------------------------------------------------ *
 * Loading
 * ------------------------------------------------------------------ */

export type LoadTrackResult = { ok: true } | { ok: false; error: string };

/**
 * Decode a File into this card's track. Replaces any track already loaded
 * for the card. Does NOT require a user gesture to succeed — decoding is
 * independent of AudioContext unlock state; see the fire-and-forget
 * unlockAudio() call below for why that used to be conflated and what
 * broke because of it.
 *
 * `previousSoundEnabled` is the caller's current sound.enabled value —
 * Track and the synth preset are mutually exclusive as of Phase 4.9.1
 * (TrackSection.tsx force-disables sound.enabled on a successful load),
 * and this is threaded through purely so unloadTrack() can hand it back
 * later for the caller to restore. track.ts otherwise has no knowledge
 * of SoundState at all — this is the one deliberate exception, kept as a
 * single passed-through value rather than importing the store's types.
 */
export async function loadTrack(
  cardId: string,
  file: File,
  previousSoundEnabled: boolean,
): Promise<LoadTrackResult> {
  if (!isAllowedTrackMimeType(file.type)) {
    return { ok: false, error: `"${file.type || 'unknown type'}" isn't a supported audio type.` };
  }
  if (file.size > MAX_TRACK_BYTES) {
    const mb = Math.round(file.size / (1024 * 1024));
    const maxMb = Math.round(MAX_TRACK_BYTES / (1024 * 1024));
    return { ok: false, error: `File is ${mb}MB — the limit is ${maxMb}MB.` };
  }

  // NOT awaited — fire-and-forget, same pattern playTrack() already uses
  // for its own unlockAudio() call. This used to block here, and that
  // was the actual bug behind "upload gets stuck on Decoding… on mobile
  // until an unrelated tap": AudioContext.decodeAudioData() below needs
  // no 'running' context at all — decoding is pure format conversion,
  // not playback — so there was never a real reason to gate it on
  // resume() succeeding. iOS Safari's native file-picker UI sits between
  // the "Upload Audio" tap and this onChange firing, and that intervening
  // OS-level surface can sever the "trusted gesture" WebKit requires to
  // resume a suspended AudioContext, so resume() can sit pending
  // indefinitely rather than rejecting — awaiting it here just hung the
  // whole load forever with no error surfaced (loading stayed true until
  // some unrelated genuine tap elsewhere, e.g. the Sound toggle, finally
  // resumed the same shared context and let this stalled await resolve
  // too). Playback still gets properly unlocked, from a guaranteed-clean
  // gesture — the Play button's own onClick, via playTrack() below.
  void unlockAudio().catch(() => {});
  const ctx = getAudioContext();

  let buffer: AudioBuffer;
  try {
    const bytes = await file.arrayBuffer();
    // Safari still wants the callback-style overload in some versions;
    // the promise form is used first and this falls back only on throw,
    // same pattern lib/sound/sample-cache.ts already uses for presets.
    buffer = await ctx.decodeAudioData(bytes);
  } catch {
    return { ok: false, error: "Couldn't read that file as audio. Try exporting to MP3 or WAV." };
  }

  if (buffer.duration > MAX_TRACK_SECONDS) {
    const mins = Math.round(MAX_TRACK_SECONDS / 60);
    return { ok: false, error: `Track is longer than ${mins} minutes — trim it and try again.` };
  }

  unloadTrack(cardId);

  const gain = ctx.createGain();
  gain.gain.value = 0.8;
  gain.connect(getMasterGain());

  // Analysis taps a SEPARATE, always-unity gain node, not `gain` above.
  // `gain`'s value carries volume AND mute (setTrackMutedPlayback sets it
  // to 0) — an analyser connected downstream of it would go silent on
  // mute right along with the speakers, which directly contradicts what
  // the Mute toggle promises ("keeps driving Modulate silently, without
  // audible playback" — TrackSection.tsx). tapGain never changes value,
  // so getTrackBand/getTrackFrequencyData/getTrackWaveform/getTrackLevel
  // all keep reading the real signal regardless of mute or volume.
  const tapGain = ctx.createGain();
  tapGain.gain.value = 1;

  // 128 -> 64 frequency bins, matching what shader.renderer.ts's
  // applyReserved() already expects from RenderContext.audio (u_bass/
  // u_mid/u_high average bins 0-8/8-32/32-64) — see this file's top doc.
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 128;
  analyser.smoothingTimeConstant = 0.75;
  tapGain.connect(analyser);

  // Separate node, NOT a second use of `analyser` above — see
  // TrackHandle's waveAnalyser doc for why fftSize 128 (64 bins, for
  // modulation) and fftSize 256 (time-domain, for the p5 bridge) can't
  // share one node, and why sending the wrong length here previously
  // crashed every p5 tile's rendering the moment a track went active.
  const waveAnalyser = ctx.createAnalyser();
  waveAnalyser.fftSize = 256;
  tapGain.connect(waveAnalyser);

  const title = titleFromFilename(file.name);
  const handle: TrackHandle = {
    buffer,
    title,
    gain,
    tapGain,
    analyser,
    freqData: new Float32Array(analyser.frequencyBinCount) as Float32Array<ArrayBuffer>,
    waveAnalyser,
    waveBuffer: new Float32Array(waveAnalyser.fftSize) as Float32Array<ArrayBuffer>,
    level: 0,
    bandGain: new BandAutoGain<TrackBand>(),
    source: null,
    playing: false,
    loop: true, // a board tile's track is a bed, not a one-shot — loop by default
    volume: 0.8,
    mutedPlayback: false,
    startedAt: 0,
    offset: 0,
    previousSoundEnabled,
    // Built directly rather than via buildMeta(handle) — handle doesn't
    // exist as a complete object until this literal finishes, so there's
    // nothing to pass yet. Every subsequent change goes through
    // emitTrack(), which does use buildMeta().
    metaSnapshot: {
      title,
      durationSeconds: buffer.duration,
      playing: false,
      loop: true,
      volume: 0.8,
      mutedPlayback: false,
    },
  };
  tracks.set(cardId, handle);

  emitTrack(cardId, handle);
  return { ok: true };
}

/** Full teardown — stops playback, disconnects every node, drops the
    buffer. Called on explicit remove, on loading a replacement track, and
    from lib/render/pool.ts's demote() so a card scrolled off (or evicted
    under budget) doesn't leave a decoded buffer and a running source node
    behind. Safe to call on a card with no track (returns false).
    
    Returns the sound.enabled value captured when this track was loaded
    (see loadTrack()'s previousSoundEnabled param) — TrackSection.tsx's
    "Remove track" handler uses this to restore the synth preset's enabled
    state exactly as it was before Track took it over. pool.ts's demote()
    call site ignores the return value; a card scrolled away mid-track
    doesn't attempt to resurrect its previous sound state, since nothing
    is watching it happen and there's no React layer in scope there to
    act on it anyway — an accepted, deliberately unhandled edge case. */
export function unloadTrack(cardId: string): boolean {
  const handle = tracks.get(cardId);
  if (!handle) return false;

  if (handle.source) {
    try {
      handle.source.stop();
    } catch {
      // already stopped/ended
    }
    handle.source.disconnect();
    handle.source = null;
  }
  try {
    handle.analyser.disconnect();
  } catch {
    // already disconnected
  }
  try {
    handle.waveAnalyser.disconnect();
  } catch {
    // already disconnected
  }
  try {
    handle.tapGain.disconnect();
  } catch {
    // already disconnected
  }
  try {
    handle.gain.disconnect();
  } catch {
    // already disconnected
  }

  tracks.delete(cardId);
  emit(cardId);
  return handle.previousSoundEnabled;
}

function titleFromFilename(name: string): string {
  const withoutExt = name.replace(/\.[^./\\]+$/, '');
  return withoutExt.trim() || name;
}

/* ------------------------------------------------------------------ *
 * Transport
 * ------------------------------------------------------------------ */

export function hasTrack(cardId: string): boolean {
  return tracks.has(cardId);
}

function currentTimeOf(handle: TrackHandle): number {
  if (!handle.playing) return handle.offset;
  const ctx = getAudioContext();
  const elapsed = ctx.currentTime - handle.startedAt;
  return handle.loop ? elapsed % handle.buffer.duration : Math.min(elapsed, handle.buffer.duration);
}

export function getTrackCurrentTime(cardId: string): number {
  const handle = tracks.get(cardId);
  return handle ? currentTimeOf(handle) : 0;
}

export function getTrackMeta(cardId: string): TrackMeta | null {
  return tracks.get(cardId)?.metaSnapshot ?? null;
}

/** Builds and starts a fresh AudioBufferSourceNode at `offset` — the node
    is one-shot per the Web Audio spec (start() can only be called once),
    so "resume" always means "make a new node," never reuse the old one. */
function startSourceAt(cardId: string, handle: TrackHandle, offset: number): void {
  const ctx = getAudioContext();
  const source = ctx.createBufferSource();
  source.buffer = handle.buffer;
  source.loop = handle.loop;
  // Web Audio permits fanning one source out to multiple destinations —
  // gain carries the audible, mute/volume-affected path to the master
  // output; tapGain carries the same signal, unaffected, to the analyser.
  // See loadTrack()'s doc on tapGain for why these have to be separate.
  source.connect(handle.gain);
  source.connect(handle.tapGain);

  source.onended = () => {
    // Fires both on a natural end-of-buffer AND on any of our own stop()
    // calls (pause, seek, unload, or replacing the track) — the Web Audio
    // spec gives no way to tell those apart from the event itself.
    //
    // Identity check, not a shared flag: only apply the natural-end reset
    // if THIS closure's source is still the handle's current source. Every
    // intentional stop below sets handle.source to something else (null,
    // or a freshly started replacement) before or immediately after
    // calling stop() — so a stale onended from a source that's already
    // been superseded finds handle.source !== source and no-ops instead
    // of clobbering whatever (possibly newer, still-playing) state exists
    // by the time it actually fires. A single shared boolean on the
    // handle doesn't survive two overlapping stop/restart cycles (e.g.
    // two quick scrubs) — the first onended to fire would clear it for
    // both, letting the second, stale one fall through and reset state
    // out from under a source that's actually still playing.
    if (handle.source !== source) return;
    handle.playing = false;
    handle.offset = 0;
    handle.source = null;
    emitTrack(cardId, handle);
  };

  source.start(0, offset);
  handle.source = source;
  handle.playing = true;
  handle.startedAt = ctx.currentTime - offset;
}

export function playTrack(cardId: string): void {
  const handle = tracks.get(cardId);
  if (!handle || handle.playing) return;
  void unlockAudio().catch(() => {});
  startSourceAt(cardId, handle, handle.offset);
  emitTrack(cardId, handle);
}

export function pauseTrack(cardId: string): void {
  const handle = tracks.get(cardId);
  if (!handle || !handle.playing || !handle.source) return;
  handle.offset = currentTimeOf(handle);
  try {
    handle.source.stop();
  } catch {
    // already stopped
  }
  handle.source = null;
  handle.playing = false;
  emitTrack(cardId, handle);
}

export function seekTrack(cardId: string, seconds: number): void {
  const handle = tracks.get(cardId);
  if (!handle) return;
  const clamped = Math.max(0, Math.min(seconds, handle.buffer.duration));
  const wasPlaying = handle.playing;

  if (handle.source) {
    try {
      handle.source.stop();
    } catch {
      // already stopped
    }
    handle.source = null;
  }

  handle.offset = clamped;
  handle.playing = false;

  if (wasPlaying) startSourceAt(cardId, handle, clamped);
  emitTrack(cardId, handle);
}

export function setTrackLoop(cardId: string, loop: boolean): void {
  const handle = tracks.get(cardId);
  if (!handle) return;
  handle.loop = loop;
  if (handle.source) handle.source.loop = loop;
  emitTrack(cardId, handle);
}

export function setTrackVolume(cardId: string, volume: number): void {
  const handle = tracks.get(cardId);
  if (!handle) return;
  const clamped = Math.max(0, Math.min(1, volume));
  handle.volume = clamped;
  handle.gain.gain.value = handle.mutedPlayback ? 0 : clamped;
  emitTrack(cardId, handle);
}

/** Mutes audible output only — the analyser tap lives on tapGain, not
    gain, so it keeps reading the real signal regardless (see loadTrack()'s
    tapGain doc for why that separation exists). See TrackMeta's
    mutedPlayback doc for why this is a separate control from volume. */
export function setTrackMutedPlayback(cardId: string, muted: boolean): void {
  const handle = tracks.get(cardId);
  if (!handle) return;
  handle.mutedPlayback = muted;
  handle.gain.gain.value = muted ? 0 : handle.volume;
  emitTrack(cardId, handle);
}

/* ------------------------------------------------------------------ *
 * Analysis — the two consumers described in the file-level doc.
 * ------------------------------------------------------------------ */

/** Bin ranges mirror shader.renderer.ts's avg(ctx.audio, ...) calls
    exactly, so a track feeds the generic modulation scalar and a shader's
    raw uniform the same underlying energy, just resampled differently. */
const BAND_RANGES: Record<TrackBand, [number, number]> = {
  bass: [0, 8],
  mid: [8, 32],
  high: [32, 64],
  rms: [0, 64],
};

/** Refreshes and returns the handle's own frequency buffer — internal;
    both public readers below call this so a single analyser read serves
    both a shader's raw uniform and this frame's modulation sample rather
    than pulling from the AnalyserNode twice. */
function refresh(handle: TrackHandle): Float32Array<ArrayBuffer> {
  // getByteFrequencyData writes into a Uint8Array (0-255); normalized to
  // 0..1 here so this lines up with what a shader author or the
  // modulation bus would sanely expect an "amplitude" uniform/signal to
  // be, and so BAND_RANGES' averaging in getTrackBand produces 0..1 too.
  const bytes = new Uint8Array(handle.analyser.frequencyBinCount);
  handle.analyser.getByteFrequencyData(bytes);
  for (let i = 0; i < bytes.length; i++) handle.freqData[i] = bytes[i] / 255;
  return handle.freqData;
}

/**
 * 0..1 scalar for one band, read by lib/modulation/bus.ts. Returns null
 * for a card with no track loaded (NOT 0) so the caller can fall back to
 * the existing neutral-0.5 "no modulation" behavior rather than reading
 * an audio source as permanently silent.
 *
 * Auto-gained against this band's own recent peak before returning — see
 * lib/sound/autoGain.ts's doc for why. Without this, the raw byte-
 * frequency average for typical music sits low and fairly flat — nowhere
 * near the 0..1 swing an LFO source produces — so a control routed to
 * Audio and cranked to max Amount still barely visibly moved, even
 * though applyModulation() in control-schema.ts applies the exact same
 * math to every source. The signal itself needed the dynamic range, not
 * the application of it.
 */
export function getTrackBand(cardId: string, band: TrackBand): number | null {
  const handle = tracks.get(cardId);
  if (!handle) return null;
  const data = refresh(handle);
  const [from, to] = BAND_RANGES[band];
  let sum = 0;
  const end = Math.min(to, data.length);
  for (let i = from; i < end; i++) sum += data[i];
  const raw = sum / Math.max(end - from, 1);

  return handle.bandGain.apply(band, raw);
}

/** The full 64-bin array, in the shape renderers/types.ts's
    RenderContext.audio expects. Returns null for a card with no track —
    lib/render/pool.ts falls back to its existing board-wide `this.audio`
    (always null today; reserved for a future global source) when this is
    null, so a card without a track behaves exactly as it does now. */
export function getTrackFrequencyData(cardId: string): Float32Array<ArrayBuffer> | null {
  const handle = tracks.get(cardId);
  if (!handle) return null;
  return refresh(handle);
}

/**
 * Current time-domain waveform for a card's uploaded track — reads
 * waveAnalyser, the dedicated fftSize-256 node (see TrackHandle's doc for
 * why this can't share a node with the frequency analyser getTrackBand()/
 * getTrackFrequencyData() use). Mirrors lib/sound/meter.ts's getWaveform()
 * exactly, both in algorithm and buffer length, which is what lets
 * p5.renderer.ts treat "this card's audio, whatever's driving it" as one
 * concept rather than needing a track-specific code path — see that
 * file's render() for the priority order (track over the synth engine
 * when both happen to be present on the same card).
 *
 * Returns the SAME Float32Array instance on every call for a given card,
 * same caveat as getWaveform: fine for P5Renderer, which hands it
 * straight to postMessage's structured clone (a copy by construction)
 * each frame; a caller holding onto it across frames must copy it first.
 */
export function getTrackWaveform(cardId: string): Float32Array<ArrayBuffer> | null {
  const handle = tracks.get(cardId);
  if (!handle) return null;
  handle.waveAnalyser.getFloatTimeDomainData(handle.waveBuffer);
  return handle.waveBuffer;
}

/** How fast a held peak falls back toward 0, in units per second — same
    constant and same reasoning as meter.ts's DECAY_PER_SECOND, kept in
    sync so a track's meter and the synth engine's meter feel identical
    when SoundMeter.tsx switches between them (see that file's Phase 4.9.1
    change). */
const LEVEL_DECAY_PER_SECOND = 3.5;

/** Shared across every card's level reads, same reasoning as meter.ts's
    module-level lastTick: this is just wall-clock elapsed time since the
    last read, which is meaningful regardless of which card asked. */
let lastLevelTick = performance.now();

/**
 * Call from a UI-driven requestAnimationFrame loop — updates the held
 * peak against elapsed time and returns the current 0..1 level, same
 * contract as meter.ts's getMeterLevel(). Returns 0 for a card with no
 * track, rather than throwing.
 *
 * Reads from tapGain's always-unity signal (via waveAnalyser), so this
 * reflects the track's real level regardless of mutedPlayback — see
 * loadTrack()'s tapGain doc. Deliberately NOT gated on mutedPlayback:
 * the meter's job is to show what's actually feeding modulation/analysis,
 * which keeps running while muted by design, not just what's audible.
 */
export function getTrackLevel(cardId: string): number {
  const handle = tracks.get(cardId);
  const now = performance.now();
  const dt = Math.max(0, (now - lastLevelTick) / 1000);
  lastLevelTick = now;

  if (!handle) return 0;

  handle.waveAnalyser.getFloatTimeDomainData(handle.waveBuffer);
  let peak = 0;
  for (let i = 0; i < handle.waveBuffer.length; i++) {
    const abs = Math.abs(handle.waveBuffer[i]);
    if (abs > peak) peak = abs;
  }

  const decayed = handle.level * Math.max(0, 1 - LEVEL_DECAY_PER_SECOND * dt);
  handle.level = Math.min(1, Math.max(peak, decayed));
  return handle.level;
}
