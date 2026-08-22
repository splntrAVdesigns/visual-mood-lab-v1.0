/**
 * Visual Mood Lab — audio sample loading.
 *
 * Mirrors lib/gl/texture-source.ts's shape deliberately: decode a sample
 * exactly once per URL, not once per playback attempt, and cache the
 * result. Unlike texture-source.ts, there's no "return null and let the
 * caller retry next frame" path that makes sense here — starting a pad's
 * sample source needs a real decoded buffer or nothing, so this is a
 * proper async load a caller awaits once, not a per-frame poll.
 *
 * Location: lib/sound/sample-cache.ts
 */

import { getAudioContext } from './context';

/**
 * Cache-busting version for every static sample under public/sounds/ — same
 * technique, same reasoning, as SANDBOX_RUNTIME_VERSION in
 * lib/sandbox/protocol.ts. A bare `/sounds/whatever.wav` URL gives the
 * browser no signal that the file's content changed, so it can keep
 * serving a stale cached copy indefinitely — and several of these files
 * (digital-safari.wav specifically) have been re-processed more than once
 * across different rounds of this project. Bump this any time ANY file
 * under public/sounds/ changes; it's a single shared version rather than
 * one per file because the cost of over-busting (occasionally re-fetching
 * an unchanged sample) is trivial next to the cost of silently serving a
 * stale one.
 */
const SAMPLE_CACHE_VERSION = '2026-08-15-1';

type Entry =
  | { state: 'loading'; promise: Promise<AudioBuffer | null> }
  | { state: 'ready'; buffer: AudioBuffer }
  | { state: 'failed' };

const cache = new Map<string, Entry>();

function versioned(url: string): string {
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}v=${SAMPLE_CACHE_VERSION}`;
}

/** Resolves to the decoded buffer, or null if the fetch/decode failed.
    Safe to call repeatedly for the same URL — concurrent callers share
    the same in-flight promise rather than each starting their own fetch.
    Cached by the ORIGINAL (unversioned) url, so a preset's sampleUrl
    string never needs to know about SAMPLE_CACHE_VERSION — only the
    actual network request does. */
export async function loadSample(url: string): Promise<AudioBuffer | null> {
  const hit = cache.get(url);
  if (hit) {
    if (hit.state === 'ready') return hit.buffer;
    if (hit.state === 'loading') return hit.promise;
    return null; // failed
  }

  const promise = (async () => {
    try {
      const res = await fetch(versioned(url));
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const arrayBuffer = await res.arrayBuffer();
      const buffer = await getAudioContext().decodeAudioData(arrayBuffer);
      cache.set(url, { state: 'ready', buffer });
      return buffer;
    } catch (err) {
      console.error(`[sample-cache] failed to load ${url}`, err);
      cache.set(url, { state: 'failed' });
      return null;
    }
  })();

  cache.set(url, { state: 'loading', promise });
  return promise;
}

/** Synchronous check for a decoded buffer already in hand — used by an
    engine that wants to know "is this ready yet" without re-awaiting. */
export function getSampleIfReady(url: string): AudioBuffer | null {
  const hit = cache.get(url);
  return hit?.state === 'ready' ? hit.buffer : null;
}

export function invalidateSample(url: string): void {
  cache.delete(url);
}
