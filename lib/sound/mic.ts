/**
 * Visual Mood Lab — shared microphone input.
 *
 * Phase 4.9.2. Sibling to track.ts (per-card uploaded audio), but a
 * genuinely different shape: there is exactly ONE physical microphone,
 * so unlike a track — where two cards can have two different files
 * loaded — every card with Mic enabled is necessarily reading the exact
 * same live signal. This module holds ONE shared MediaStream for the
 * whole app, ref-counted across every card that has it enabled, rather
 * than one getUserMedia() call per card. Same "one shared resource"
 * principle as lib/sound/context.ts's single AudioContext and
 * lib/gl/context-pool.ts's single WebGL2 context — multiple redundant
 * acquisitions of the same hardware would mean multiple permission
 * prompts (browsers do deduplicate this in practice, but there's no
 * reason to rely on that) and, more concretely, no reason at all: the
 * data is identical regardless of which card asked for it.
 *
 * DELIBERATELY ANALYSIS-ONLY. Unlike a Track, mic input is never
 * connected to getMasterGain() or any other point in the output graph —
 * only to two AnalyserNodes, mirroring track.ts's own two-analyser split
 * (see below). Routing live mic input to the speakers on a device
 * without headphones is a real feedback-loop risk (the mic picks up its
 * own output, re-amplifies, howls), and there's no product reason for
 * Mic to need a Volume control or output path in the first place — its
 * only purpose is feeding lib/modulation/bus.ts's mic.* sources and
 * p5.renderer.ts's audioWaveform bridge, same as Track's audio.* sources
 * and that same bridge. This also means Mic never competes with Track or
 * the synth preset for a card's one output/Volume control the way those
 * two do with each other (see TrackSection.tsx's mutual-exclusivity
 * doc) — Mic can be enabled alongside either or both, independently,
 * since it never touches the thing they're competing over.
 *
 * getUserMedia() is genuinely awaited in enableMic() below, unlike
 * loadTrack()'s unlockAudio() call (see that file's doc for why THAT one
 * changed to fire-and-forget) — there is no way to obtain a MediaStream
 * without the permission promise actually resolving first, so blocking
 * here is correct and unavoidable, not the same mistake repeated.
 * Permission is requested the instant "Mic" is toggled on, not behind an
 * extra confirmation step first — matching the immediate, gesture-driven
 * pattern iOS Safari already requires elsewhere in this app (see
 * track.ts's pickFile doc), and treating the browser's own native
 * permission prompt as the trust boundary rather than adding a second,
 * app-level one in front of it.
 *
 * TWO ANALYSERS, both tapped from the same MediaStreamAudioSourceNode,
 * mirroring track.ts's TrackHandle exactly and for the identical reason
 * (see that file's top doc, point-for-point):
 *   1. getMicBand() — a single 0..1 scalar per band, read by
 *      lib/modulation/bus.ts's rawSignal() for the mic.rms/bass/mid/high
 *      modulation sources. 128-bin frequency analyser, same fftSize and
 *      same BAND_RANGES split as track.ts, so a control modulated by
 *      Track vs Mic reads consistently regardless of which is driving it.
 *   2. getMicWaveform()/getMicLevel() — a separate, dedicated time-domain
 *      analyser at fftSize 256, feeding p5.renderer.ts's audioWaveform
 *      bridge and a future Mic meter respectively. Can't share a node
 *      with (1) for the same reason TrackHandle's waveAnalyser can't —
 *      an AnalyserNode's fftSize sets both its bin count and its time-
 *      domain buffer length at once, and 64 bins (modulation) and 256
 *      samples (the waveform bridge) are two different, simultaneous
 *      needs. See TrackHandle's waveAnalyser doc in track.ts for the
 *      exact failure mode a single shared node produced there.
 *
 * Location: lib/sound/mic.ts
 */

import { getAudioContext } from './context';
import { BandAutoGain } from './autoGain';

export type MicBand = 'rms' | 'bass' | 'mid' | 'high';

export type MicResult = { ok: true } | { ok: false; error: string };

// Same split shader.renderer.ts's applyReserved() and track.ts's
// BAND_RANGES already use for u_bass/u_mid/u_high — kept identical here
// so a card modulated by Audio vs Mic reads consistently. rms covers the
// analyser's full bin range rather than a sub-band.
const BAND_RANGES: Record<Exclude<MicBand, 'rms'>, [number, number]> = {
  bass: [0, 8],
  mid: [8, 32],
  high: [32, 64],
};

let stream: MediaStream | null = null;
let sourceNode: MediaStreamAudioSourceNode | null = null;
let analyser: AnalyserNode | null = null;
let freqData: Float32Array<ArrayBuffer> | null = null;
let waveAnalyser: AnalyserNode | null = null;
let waveBuffer: Float32Array<ArrayBuffer> | null = null;

/** Cards that currently have Mic toggled on — the ref-count. The shared
    stream is acquired when this goes from empty to non-empty, and fully
    released when it goes back to empty. A card's own membership here,
    not any property of the stream itself, is what isMicEnabled(cardId)
    answers — every enabled card shares one stream, but each still has
    its own independent on/off state. */
const enabledCards = new Set<string>();

/** One shared auto-gain instance, not one per card — there is exactly
    one signal (see this file's top doc), so unlike track.ts (one
    BandAutoGain per TrackHandle) there is nothing to key it by. Reset on
    every fresh acquisition, not just left running, so a peak held from a
    previous enable/disable cycle doesn't suppress this session's early
    dynamics. */
const bandGain = new BandAutoGain<MicBand>();

type MicListener = () => void;
const listeners = new Set<MicListener>();

function emit(): void {
  listeners.forEach((fn) => fn());
}

/** Discrete-event subscription, same shape and same reasoning as
    track.ts's subscribeTrack — "something about mic state changed,
    re-read it," for lib/hooks/useTrackState.ts's useMicEnabled. Global
    rather than keyed per card (unlike subscribeTrack): mic state changes
    are infrequent user actions, not a per-card continuous stream, so one
    shared listener set is simpler and there's no meaningful cost to a
    card re-checking isMicEnabled(itsOwnId) on every mic-related change
    anywhere. */
export function subscribeMic(fn: MicListener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function isMicEnabled(cardId: string): boolean {
  return enabledCards.has(cardId);
}

/** Whether the shared stream is actually live right now — distinct from
    isMicEnabled(cardId), which answers for one specific card. Exists for
    completeness/debugging; most callers want isMicEnabled(cardId). */
export function isMicActive(): boolean {
  return stream !== null;
}

async function acquireStream(): Promise<MicResult> {
  if (stream) return { ok: true }; // already live — another card got here first

  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return { ok: false, error: "This browser doesn't support microphone access." };
  }

  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    stream = null;
    // NotAllowedError (denied, or dismissed without a choice) is the
    // overwhelmingly common failure — worth its own message, since a
    // person who just tapped a toggle and got silence with no
    // explanation has no way to tell whether that's a bug or a
    // deliberate no from the browser/OS.
    if (err instanceof DOMException && err.name === 'NotAllowedError') {
      return {
        ok: false,
        error: 'Microphone access was denied. Check your browser or system settings and try again.',
      };
    }
    if (err instanceof DOMException && err.name === 'NotFoundError') {
      return { ok: false, error: 'No microphone was found on this device.' };
    }
    return { ok: false, error: "Couldn't access the microphone. Try again." };
  }

  const ctx = getAudioContext();
  sourceNode = ctx.createMediaStreamSource(stream);

  // 128 -> 64 frequency bins, matching track.ts's analyser exactly (see
  // that file's doc) — same shape shader.renderer.ts's applyReserved()
  // and lib/modulation/bus.ts's rawSignal() already expect.
  analyser = ctx.createAnalyser();
  analyser.fftSize = 128;
  analyser.smoothingTimeConstant = 0.75;
  sourceNode.connect(analyser);
  freqData = new Float32Array(analyser.frequencyBinCount) as Float32Array<ArrayBuffer>;

  // Separate node, NOT a second use of `analyser` above — see this
  // file's top doc and TrackHandle's waveAnalyser doc in track.ts for
  // why fftSize 128 (64 bins, modulation) and fftSize 256 (time-domain,
  // the p5 waveform bridge) can't share one node.
  waveAnalyser = ctx.createAnalyser();
  waveAnalyser.fftSize = 256;
  sourceNode.connect(waveAnalyser);
  waveBuffer = new Float32Array(waveAnalyser.fftSize) as Float32Array<ArrayBuffer>;

  // Deliberately NOT connected to getMasterGain() or ctx.destination
  // anywhere above — see this file's top doc for why Mic never reaches
  // the output graph.

  bandGain.reset();
  return { ok: true };
}

function releaseStream(): void {
  stream?.getTracks().forEach((t) => t.stop());
  sourceNode?.disconnect();
  analyser?.disconnect();
  waveAnalyser?.disconnect();
  stream = null;
  sourceNode = null;
  analyser = null;
  freqData = null;
  waveAnalyser = null;
  waveBuffer = null;
  bandGain.reset();
}

/**
 * Enables Mic for `cardId`. Idempotent — enabling a card that's already
 * enabled is a no-op success. The FIRST card to enable (when the shared
 * stream isn't already live) is the one that actually triggers the
 * getUserMedia() permission prompt; every subsequent card just joins the
 * existing stream immediately.
 */
export async function enableMic(cardId: string): Promise<MicResult> {
  if (enabledCards.has(cardId)) return { ok: true };
  const result = await acquireStream();
  if (!result.ok) return result;
  enabledCards.add(cardId);
  emit();
  return { ok: true };
}

/**
 * Disables Mic for `cardId`. The shared stream — and its actual hardware
 * capture, and the browser's mic-in-use indicator — is only torn down
 * once the LAST enabled card disables, not on every individual disable.
 * Safe to call on a card that was never enabled (no-op).
 */
export function disableMic(cardId: string): void {
  if (!enabledCards.delete(cardId)) return;
  if (enabledCards.size === 0) releaseStream();
  emit();
}

function refreshFreq(): Float32Array<ArrayBuffer> | null {
  if (!analyser || !freqData) return null;
  const bytes = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteFrequencyData(bytes);
  for (let i = 0; i < bytes.length; i++) freqData[i] = bytes[i] / 255;
  return freqData;
}

/**
 * 0..1 scalar for one band, read by lib/modulation/bus.ts. Returns null
 * when the shared stream isn't live (mic not enabled anywhere), NOT 0, so
 * a routing set up before Mic is ever enabled sits inert at the neutral
 * 0.5 rather than reading as silence — identical contract to
 * getTrackBand(), for the identical reason.
 *
 * Auto-gained via the shared BandAutoGain instance above before
 * returning — see lib/sound/autoGain.ts's doc for why. Ambient room mic
 * with no preamp has, if anything, LESS dynamic range than a mixed
 * track, so this matters at least as much here.
 */
export function getMicBand(band: MicBand): number | null {
  const data = refreshFreq();
  if (!data) return null;

  let raw: number;
  if (band === 'rms') {
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i];
    raw = sum / Math.max(data.length, 1);
  } else {
    const [from, to] = BAND_RANGES[band];
    let sum = 0;
    const end = Math.min(to, data.length);
    for (let i = from; i < end; i++) sum += data[i];
    raw = sum / Math.max(end - from, 1);
  }

  return bandGain.apply(band, raw);
}

/** The full 64-bin array, same shape as track.ts's getTrackFrequencyData
    — for a future board-wide reserved-uniform path if Mic is ever wired
    into pool.ts's ctx.audio resolution alongside Track (currently Mic
    only feeds the modulation bus and the p5 waveform bridge below, not
    ctx.audio — see lib/render/pool.ts's tick() for the current Track ??
    board-wide fallback and where Mic would slot in as a second
    priority). Returns null when the shared stream isn't live. */
export function getMicFrequencyData(): Float32Array<ArrayBuffer> | null {
  return refreshFreq();
}

/**
 * Current time-domain waveform for the shared mic stream — reads
 * waveAnalyser, the dedicated fftSize-256 node (see this file's top doc
 * for why this can't share a node with the frequency analyser
 * getMicBand()/getMicFrequencyData() use). Same buffer length and same
 * algorithm as track.ts's getTrackWaveform() and meter.ts's getWaveform()
 * exactly, which is what lets p5.renderer.ts treat "this card's audio,
 * whatever's driving it" as one concept — see that file's render() for
 * the full Track > Mic > synth-preset priority order.
 *
 * Returns the SAME Float32Array instance on every call, same caveat as
 * getTrackWaveform(): fine for P5Renderer, which hands it straight to
 * postMessage's structured clone (a copy by construction) each frame; a
 * caller holding onto it across frames must copy it first. Returns null
 * when the shared stream isn't live.
 */
export function getMicWaveform(): Float32Array<ArrayBuffer> | null {
  if (!waveAnalyser || !waveBuffer) return null;
  waveAnalyser.getFloatTimeDomainData(waveBuffer);
  return waveBuffer;
}
