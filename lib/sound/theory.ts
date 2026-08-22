/**
 * Visual Mood Lab — minimal music theory.
 *
 * Just enough to turn (key, scale, octave, scale-degree index) into a real
 * frequency. Standard equal temperament, A4 = 440Hz = MIDI note 69.
 *
 * Location: lib/sound/theory.ts
 */

import type { MusicalScale } from '@/renderers/control-schema';
import { ROOT_NOTES } from './types';

const SCALE_INTERVALS: Record<MusicalScale, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  pentatonic: [0, 2, 4, 7, 9],
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};

function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function rootSemitone(key: string): number {
  const idx = (ROOT_NOTES as readonly string[]).indexOf(key);
  return idx >= 0 ? idx : 0; // falls back to C
}

/**
 * degreeIndex can be any integer, including negative — it wraps across
 * octaves as it grows or shrinks, so a caller can just keep incrementing
 * (or offsetting by a live-bound value) to walk the scale indefinitely in
 * either direction.
 */
export function scaleFrequency(
  key: string,
  scale: MusicalScale,
  octave: number,
  degreeIndex: number,
): number {
  const intervals = SCALE_INTERVALS[scale];
  const len = intervals.length;
  const octaveStep = Math.floor(degreeIndex / len);
  const degree = ((degreeIndex % len) + len) % len;
  // +4 centers octave 0 on the octave containing middle C (MIDI 60).
  const semitone = rootSemitone(key) + intervals[degree] + (octave + octaveStep + 4) * 12;
  return midiToFreq(semitone);
}

/**
 * Merges the scales of several selected root notes into one ascending
 * frequency pool.
 *
 * This is what "up to 3 notes" means for a pluck/arp instrument: rather
 * than one note winning and the rest being decorative, every selected root
 * contributes its OWN scale's degrees, and the results are merged and
 * sorted into a single ladder. Two roots therefore genuinely widen the
 * available pitch set — often into something harmonically richer than
 * either scale alone, since the two interleave.
 *
 * Sorted ascending so a caller can map a spatial position straight onto an
 * index and get "left is low, right is high" for free, regardless of how
 * many roots are selected or what order the user picked them in.
 *
 * `degreesPerNote` is per root, so the pool length scales with selection
 * count — deliberately. A caller mapping a normalized position onto it
 * should index by fraction of pool.length rather than assuming a fixed
 * size.
 */
export function buildNotePool(
  notes: string[],
  scale: MusicalScale,
  octave: number,
  degreesPerNote: number,
): number[] {
  // An empty pool is a real, intended outcome now — the note rack allows
  // deselecting every note as a deliberate mute (see NoteRack.tsx), and
  // ArpEngine.pluck()/playNote() already treat notePool.length === 0 as
  // "produce nothing," which is exactly right here. This used to fall
  // back to ['C'] defensively; that would silently override the mute.
  const pool: number[] = [];

  for (const key of notes) {
    for (let d = 0; d < degreesPerNote; d++) {
      pool.push(scaleFrequency(key, scale, octave, d));
    }
  }

  pool.sort((a, b) => a - b);
  return pool;
}
