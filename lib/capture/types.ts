// lib/capture/types.ts
//
// Shared types for the video export foundation (Sprint: Video Export
// Foundation). Kept separate from engine.ts so the UI layer (CapturePanel,
// RecordButton) can import types without pulling in VideoEncoder/muxer
// wiring.
//
// Location: lib/capture/types.ts

export type CaptureFormat = 'mp4' | 'webm';

export const CAPTURE_MIN_DURATION_SEC = 5;
export const CAPTURE_MAX_DURATION_SEC = 30;
export const CAPTURE_DEFAULT_DURATION_SEC = 10;

/** Crossfade window used to fake a seamless loop on non-periodic sources
    (fbm, particle motion, anything not driven by a known-period LFO). See
    engine.ts's top doc for why this is a blend, not a true phase-locked
    loop — that tier (LFO-period-aware capture) is intentionally out of
    scope for this sprint. */
export const CAPTURE_LOOP_OVERLAP_MS = 400;

export interface CaptureOptions {
  format: CaptureFormat;
  durationSec: number;
  /** Target capture framerate. Defaults to 30 — matches typical board
      playback and keeps encode load predictable across tile complexity. */
  fps?: number;
}

export type CaptureStatus = 'idle' | 'recording' | 'finalizing' | 'error';

export interface CaptureProgress {
  status: CaptureStatus;
  elapsedSec: number;
  durationSec: number;
  error?: string;
}

export interface CaptureResult {
  blob: Blob;
  format: CaptureFormat;
  mimeType: string;
  durationSec: number;
  /** True only when the clip ran to its full requested duration and the
      crossfade loop pass was applied — an early-stopped clip (Record
      pressed a second time before the timer finished) is still a valid,
      uploadable clip, just not a seamless loop. Surfaced so the UI can be
      honest about which clips loop cleanly and which don't. */
  looped: boolean;
}

export type CaptureListener = (progress: CaptureProgress) => void;
