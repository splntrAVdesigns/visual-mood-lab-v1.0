export type CaptureFormat = 'mp4' | 'webm';
export type CaptureLoopMode = 'off' | 'smooth';
export const CAPTURE_MIN_DURATION_SEC = 5;
export const CAPTURE_MAX_DURATION_SEC = 30;
export const CAPTURE_DEFAULT_DURATION_SEC = 10;
export const CAPTURE_LOOP_OVERLAP_MS = 400;
export interface CaptureOptions {
  format: CaptureFormat;
  durationSec: number;
  fps?: number;
  loopMode?: CaptureLoopMode;
  overlapMs?: number;
}
export type CaptureStatus = 'idle' | 'recording' | 'finalizing' | 'processing' | 'error';
export interface CaptureProgress {
  status: CaptureStatus;
  elapsedSec: number;
  durationSec: number;
  fraction?: number;
  error?: string;
}
/** Additive provenance. Legacy clips have no metadata; never infer their treatment. */
export interface CaptureMetadata {
  version: 1;
  loopMode: CaptureLoopMode;
  overlapMs: number;
  requestedDurationSec: number;
  durationSec: number;
  rawDurationSec: number;
  fps: number;
  width: number;
  height: number;
  completed: boolean;
  repeatedFrames: number;
  rawSrcUrl?: string;
}
export interface CaptureResult {
  blob: Blob;
  rawBlob: Blob;
  format: CaptureFormat;
  mimeType: string;
  durationSec: number;
  looped: boolean;
  metadata: CaptureMetadata;
  warning?: string;
}
export type CaptureListener = (progress: CaptureProgress) => void;
