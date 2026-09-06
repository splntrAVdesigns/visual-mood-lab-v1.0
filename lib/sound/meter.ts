/**
 * Visual Mood Lab — per-tile signal metering.
 *
 * A parallel tap, not an inline processing stage: each engine's own output
 * gain connects to the shared master gain exactly as it always did — the
 * analyser here just listens to the same node alongside that, in parallel.
 * Removing metering entirely would never change what anyone hears.
 *
 * Peak-hold with decay — the same technique real analog VU meters use.
 * Without it, Field Lines' bursty arp notes (a transient every note, silence
 * between) would make the dot row flicker on and off with every note
 * instead of reading as a legible, alive signal.
 *
 * Location: lib/sound/meter.ts
 */

import { getAudioContext, isAudioUnlocked } from './context';

interface MeterHandle {
  analyser: AnalyserNode;
  buffer: Float32Array<ArrayBuffer>;
  level: number; // 0..1, the smoothed value getMeterLevel() returns
}

const meters = new Map<string, MeterHandle>();

/** How fast a held peak falls back toward 0, in units per second. Tuned
    for "visibly alive, not twitchy" against the arp's ~0.3s note length —
    revisit by ear if a future engine has very different note timing. */
const DECAY_PER_SECOND = 3.5;

let lastTick = performance.now();

/** Call once when a tile's engine starts. Safe to call again for a card
    that's already metered — a no-op, not a double-attach. */
export function attachMeter(cardId: string, source: AudioNode): void {
  if (meters.has(cardId)) return;
  const ctx = getAudioContext();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  source.connect(analyser);
  meters.set(cardId, { analyser, buffer: new Float32Array(analyser.fftSize), level: 0 });
}

export function detachMeter(cardId: string): void {
  const handle = meters.get(cardId);
  if (!handle) return;
  try {
    handle.analyser.disconnect();
  } catch {
    // already disconnected, e.g. if the source node was itself torn down first
  }
  meters.delete(cardId);
}

/**
 * Call from a UI-driven requestAnimationFrame loop — updates the held
 * peak against elapsed time and returns the current 0..1 level. Returns 0
 * for a card with no active meter, rather than throwing, so a caller
 * doesn't need to check isMeterActive() first just to render "silent."
 */
export function getMeterLevel(cardId: string): number {
  const handle = meters.get(cardId);
  const now = performance.now();
  const dt = Math.max(0, (now - lastTick) / 1000);
  lastTick = now;

  if (!handle) return 0;

  // Mobile bugfix (2026-09): while the shared AudioContext is suspended
  // (backgrounded tab, OS-level interruption — see context.ts's lifecycle
  // doc), Web Audio processing halts entirely and this analyser's buffer
  // just freezes at whatever it last held, rather than reporting silence.
  // Reading it as if it were live silently reported "still playing" with
  // no actual sound reaching the speakers. Treating "not running" as
  // "no new peak this frame" and falling through to the existing decay
  // path makes the meter fade to 0 exactly like real silence would,
  // instead of holding a stale non-zero reading indefinitely.
  const peak = isAudioUnlocked() ? readPeak(handle) : 0;

  const decayed = handle.level * Math.max(0, 1 - DECAY_PER_SECOND * dt);
  handle.level = Math.min(1, Math.max(peak, decayed));
  return handle.level;
}

function readPeak(handle: MeterHandle): number {
  handle.analyser.getFloatTimeDomainData(handle.buffer);
  let peak = 0;
  for (let i = 0; i < handle.buffer.length; i++) {
    const abs = Math.abs(handle.buffer[i]);
    if (abs > peak) peak = abs;
  }
  return peak;
}

export function isMeterActive(cardId: string): boolean {
  return meters.has(cardId);
}

/**
 * Current time-domain waveform for a card's own sound engine output — the
 * same analyser tap attachMeter() already set up, just reading the raw
 * buffer instead of collapsing it to a single peak level. Used by
 * P5Renderer to forward a real audio trace into a sketch that wants one
 * (Static Choir), rather than adding a second analyser alongside the
 * meter's — one tap, two readers, no extra AudioNode.
 *
 * Returns the SAME Float32Array instance on every call for a given card
 * (handle.buffer, refilled in place by getFloatTimeDomainData) — a
 * caller that needs to hold onto a snapshot across frames must copy it;
 * P5Renderer doesn't, since it hands the buffer straight to postMessage's
 * structured clone each frame, which copies by construction. Returns null
 * for a card with no active meter, same convention as getMeterLevel.
 */
export function getWaveform(cardId: string): Float32Array<ArrayBuffer> | null {
  const handle = meters.get(cardId);
  if (!handle) return null;
  handle.analyser.getFloatTimeDomainData(handle.buffer);
  return handle.buffer;
}
