import type { CaptureOptions } from './types';

export function capturePlan(options: CaptureOptions) {
  const fps = options.fps ?? 30;
  if (!Number.isFinite(fps) || fps < 1 || fps > 60 || !Number.isInteger(fps)) throw new Error('Invalid capture frame rate');
  if (!Number.isFinite(options.durationSec) || options.durationSec < 5 || options.durationSec > 30) throw new Error('Capture duration must be 5–30 seconds');
  const mode = options.loopMode ?? 'off';
  if (mode !== 'off' && mode !== 'smooth') throw new Error('Invalid loop mode');
  const ms = options.overlapMs ?? 400;
  if (!Number.isFinite(ms) || ms < 100 || ms > 800) throw new Error('Transition must be 100–800 ms');
  const frames = Math.round(options.durationSec * fps);
  const overlap = mode === 'smooth' ? Math.min(Math.max(2, Math.round(ms * fps / 1000)), Math.floor(frames / 2)) : 0;
  if (overlap / fps > 0.8) throw new Error('Frame rate is too low for a supported loop transition');
  return { fps, frames, overlap, rawFrames: frames + overlap, mode };
}

/** Half-open intervals: output begins at raw L; its tail ends on head L-1. */
export function loopFrame(index: number, frames: number, overlap: number) {
  const tail = index - (frames - overlap);
  const x = tail < 0 ? 0 : tail / Math.max(1, overlap - 1);
  return { source: index + overlap, head: tail < 0 ? null : tail, alpha: x * x * (3 - 2 * x) };
}
