'use client';

import { useSyncExternalStore } from 'react';
import { getTrackMeta, hasTrack, subscribeTrack, type TrackMeta } from '@/lib/sound/track';
import { isMicEnabled, subscribeMic } from '@/lib/sound/mic';

/**
 * Whether `cardId` has an uploaded track loaded right now.
 *
 * useSyncExternalStore rather than the rAF-polling pattern SoundMeter.tsx
 * uses for level readouts: loading/unloading a track is a discrete event
 * (see lib/sound/track.ts's subscribeTrack), not a continuously-changing
 * value, so polling every frame would be pure waste. This is what lets
 * ModulationPanel's audio.* source options flip from disabled to enabled
 * the instant a track finishes decoding, without a manual refresh.
 */
export function useTrackLoaded(cardId: string | null): boolean {
  return useSyncExternalStore(
    (onChange) => (cardId ? subscribeTrack(cardId, onChange) : () => {}),
    () => (cardId ? hasTrack(cardId) : false),
    () => false, // SSR snapshot — no AudioContext on the server
  );
}

/**
 * Full track metadata (title, duration, transport state, volume, loop,
 * mute) for `cardId`, or null when nothing is loaded. Same
 * useSyncExternalStore mechanism as useTrackLoaded — this covers
 * TrackSection's own transport UI (play/pause state, loop toggle, volume
 * slider), all of which change on discrete user actions.
 *
 * Deliberately NOT the source for the scrub position while playing —
 * that changes every frame, not on discrete events, and TrackSection reads
 * getTrackCurrentTime() from its own requestAnimationFrame loop instead,
 * the same convention SoundMeter.tsx already established for the synth
 * engine's level dots.
 */
export function useTrackMeta(cardId: string | null): TrackMeta | null {
  return useSyncExternalStore(
    (onChange) => (cardId ? subscribeTrack(cardId, onChange) : () => {}),
    () => (cardId ? getTrackMeta(cardId) : null),
    () => null,
  );
}

/**
 * Whether `cardId` has Mic toggled on right now. Same useSyncExternalStore
 * shape as useTrackLoaded above, subscribed to lib/sound/mic.ts's
 * subscribeMic instead — see that module's top doc for why the underlying
 * stream is shared across every enabled card while each card's own on/off
 * state is still independent. This is what lets ModulationPanel's mic.*
 * source options flip from disabled to enabled the instant Mic is turned
 * on for the open card, without a manual refresh — same as useTrackLoaded
 * does for audio.* the moment a track finishes decoding.
 */
export function useMicEnabled(cardId: string | null): boolean {
  return useSyncExternalStore(
    (onChange) => subscribeMic(onChange),
    () => (cardId ? isMicEnabled(cardId) : false),
    () => false, // SSR snapshot — no getUserMedia on the server
  );
}
