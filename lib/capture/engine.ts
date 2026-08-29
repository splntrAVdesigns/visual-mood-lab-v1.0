// lib/capture/engine.ts
//
// Video Export Foundation — capture engine.
//
// Architecture:
//
//   Mediabunny (Output + CanvasSource, built on WebCodecs)
//
// REVISED from the original mp4-muxer/webm-muxer build: both of those
// packages were formally deprecated by their own author (Vanilagy) the
// same day they were installed here — "superseded by Mediabunny... no
// longer maintained, will not receive any new features or bug fixes."
// Mediabunny is the actively-maintained successor from the same author,
// unifies MP4 and WebM under one API instead of two separate packages,
// and is smaller when tree-shaken (as low as 5kB gzipped for this use
// case) than running mp4-muxer + webm-muxer side by side ever was.
//
// This rewrite is a genuine simplification, not just a rename.
// Mediabunny's CanvasSource captures "whatever is currently drawn on a
// canvas" directly — no manual VideoFrame construction, no manual
// VideoEncoder configure/encode/flush/close, no manual muxer wiring. The
// only piece still owned by this file is *what gets drawn onto that
// canvas each tick* (the tail-window crossfade blend) and *when* (the
// capture loop's timing/duration logic).
//
// SCOPE BOUNDARY — read before extending this file:
// This engine reads frames from `renderer.getCanvas()`, the real
// on-screen <canvas> a ShaderRenderer/MediaRenderer draws into. That
// works for shader/image/video tiles. It does NOT work for p5 sketch
// tiles: a p5 sketch renders inside a sandboxed, null-origin iframe
// (sandbox="allow-scripts", no allow-same-origin), and a cross-origin
// iframe's canvas is never a valid texImage2D/drawImage source — a
// browser-level restriction, not a missing accessor. This is the EXACT
// same wall lib/gl/effects-compositor.ts already hit and explicitly
// deferred for VFX effects (see that file's top doc) — capture eligibility
// is scoped to `asset.type === 'shader'` for the same reason `canVfx` is,
// in both FocusedAssetOverlay.tsx and MobileFocusedView.tsx. Extending
// capture to p5 tiles needs the sandbox to stream frames out over
// postMessage — real, separate design work, intentionally not built here.
//
// NO WORKER / OFFSCREENCANVAS. The tile's canvas is owned and drawn into
// every rAF tick by the single shared render loop in lib/render/pool.ts.
// Moving capture into a Worker would mean transferring that canvas to an
// OffscreenCanvas, which can only happen once and would break the
// existing renderer for everything else using it. This engine runs its
// own lightweight requestAnimationFrame loop on the main thread,
// independent of the pool's loop, sampling the tile's existing canvas
// once per tick — CanvasSource's own encode work still happens off the
// JS main thread via the browser's hardware encoder either way.
//
// TIER 1 LOOP ONLY. Most of the seed library is not periodic (fbm,
// domain warping, particle motion) — there is no frame that is
// mathematically identical to frame 0, so there is no true loop point to
// cut on. This engine fakes a seamless loop with a short crossfade: the
// first CAPTURE_LOOP_OVERLAP_MS of frames are held in memory, and the
// final CAPTURE_LOOP_OVERLAP_MS of the recording are blended toward them
// before being handed to CanvasSource. A real phase-locked loop
// (recording an exact multiple of an active LFO's period, no blending
// needed) is a named fast-follow, scoped to LFO-modulated tiles
// specifically — not built here.
//
// ONE CANVAS, ALWAYS. CanvasSource binds to a single canvas at
// construction and captures "whatever's currently drawn on it" each time
// add() is called — it cannot be swapped mid-recording. Rather than
// juggling two sources (raw tile canvas vs. a blended composite), this
// engine owns one dedicated output canvas for the whole recording, built
// in startCapture() before anything else: every tick draws either a 1:1
// copy of the live tile canvas (the normal case) or the crossfade blend
// (the tail window) onto it, and CanvasSource always reads from that
// same place.
//
// Location: lib/capture/engine.ts

import { Output, Mp4OutputFormat, WebMOutputFormat, BufferTarget, CanvasSource } from 'mediabunny';
import {
  CAPTURE_LOOP_OVERLAP_MS,
  type CaptureListener,
  type CaptureOptions,
  type CaptureProgress,
  type CaptureResult,
} from './types';
import { resolveVideoCodec } from './support';

const KEYFRAME_INTERVAL_FRAMES = 60;
const BITRATE = 8_000_000; // 8 Mbps — generous for a short mood-tile loop at up to ~1040px

class RecordingHandle {
  private output: Output;
  private target: BufferTarget;
  private videoSource: CanvasSource;
  private mimeType: string;

  private tileCanvas: HTMLCanvasElement;
  private outputCtx: CanvasRenderingContext2D;
  private width: number;
  private height: number;

  private fps: number;
  private totalFrames: number;
  private overlapFrames: number;
  private headFrames: ImageBitmap[] = [];

  private frameIndex = 0;
  private rafId: number | null = null;
  private stoppedEarly = false;
  private settled = false;

  private listeners = new Set<CaptureListener>();
  private resolveFn!: (r: CaptureResult) => void;
  private rejectFn!: (e: Error) => void;

  constructor(opts: {
    tileCanvas: HTMLCanvasElement;
    outputCtx: CanvasRenderingContext2D;
    output: Output;
    target: BufferTarget;
    videoSource: CanvasSource;
    mimeType: string;
    fps: number;
    totalFrames: number;
    overlapFrames: number;
  }) {
    this.tileCanvas = opts.tileCanvas;
    this.outputCtx = opts.outputCtx;
    this.output = opts.output;
    this.target = opts.target;
    this.videoSource = opts.videoSource;
    this.mimeType = opts.mimeType;
    this.fps = opts.fps;
    this.totalFrames = opts.totalFrames;
    this.overlapFrames = opts.overlapFrames;
    this.width = opts.tileCanvas.width;
    this.height = opts.tileCanvas.height;
  }

  subscribe(fn: CaptureListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify(status: CaptureProgress['status'], error?: string): void {
    const progress: CaptureProgress = {
      status,
      elapsedSec: this.frameIndex / this.fps,
      durationSec: this.totalFrames / this.fps,
      error,
    };
    for (const fn of this.listeners) fn(progress);
  }

  run(): Promise<CaptureResult> {
    return new Promise((resolve, reject) => {
      this.resolveFn = resolve;
      this.rejectFn = reject;
      this.notify('recording');
      this.rafId = requestAnimationFrame(() => void this.tick());
    });
  }

  /** Stops on the next tick rather than immediately — lets an in-flight
      videoSource.add() finish rather than tearing the output down
      mid-write. A manually-stopped clip skips the crossfade pass
      entirely (see this file's top doc): it never reached the tail
      window on its own terms, so blending toward the head frames here
      would just be an arbitrary cut dressed up as a loop. */
  stop(): void {
    if (this.settled) return;
    this.stoppedEarly = true;
  }

  private async tick(): Promise<void> {
    if (this.settled) return;

    if (this.width === 0 || this.height === 0) {
      // Tile not actually sized yet — skip this tick rather than encode a
      // zero-size frame, try again next tick.
      this.rafId = requestAnimationFrame(() => void this.tick());
      return;
    }

    const doneByDuration = this.frameIndex >= this.totalFrames;
    if (doneByDuration || this.stoppedEarly) {
      await this.finish();
      return;
    }

    const inTailWindow =
      !this.stoppedEarly &&
      this.overlapFrames > 0 &&
      this.frameIndex >= this.totalFrames - this.overlapFrames;

    if (this.frameIndex < this.overlapFrames) {
      // Stash a still of this frame for the tail-window blend later. Kept
      // small deliberately (capped at CAPTURE_LOOP_OVERLAP_MS worth of
      // frames, ~8-15 at 30fps) — the only extra memory this engine holds
      // onto beyond the single frame currently being composited.
      void createImageBitmap(this.tileCanvas).then((bmp) => {
        this.headFrames[this.frameIndex] = bmp;
      });
    }

    this.outputCtx.globalAlpha = 1;
    this.outputCtx.drawImage(this.tileCanvas, 0, 0, this.width, this.height);

    if (inTailWindow) {
      const tailIndex = this.frameIndex - (this.totalFrames - this.overlapFrames);
      const head = this.headFrames[tailIndex];
      if (head) {
        const alpha = (tailIndex + 1) / this.overlapFrames;
        this.outputCtx.globalAlpha = alpha;
        this.outputCtx.drawImage(head, 0, 0, this.width, this.height);
        this.outputCtx.globalAlpha = 1;
      }
      // If the matching head frame hasn't finished capturing yet (should
      // not happen — head frames are captured many ticks before the tail
      // window is reached — but defensively), the tile's own raw frame
      // (already drawn above) is left as-is rather than blocking encode.
    }

    const timestampSec = this.frameIndex / this.fps;
    const durationSec = 1 / this.fps;
    const keyFrame = this.frameIndex % KEYFRAME_INTERVAL_FRAMES === 0;

    try {
      // Respects CanvasSource's own backpressure — add() resolves once
      // the output is ready for the next sample, so the next tick is
      // scheduled from here rather than firing every rAF regardless of
      // encoder backlog.
      await this.videoSource.add(timestampSec, durationSec, { keyFrame });
    } catch (err) {
      this.settled = true;
      if (this.rafId !== null) cancelAnimationFrame(this.rafId);
      const message = err instanceof Error ? err.message : String(err);
      this.notify('error', message);
      this.rejectFn(err instanceof Error ? err : new Error(message));
      for (const bmp of this.headFrames) bmp?.close();
      this.headFrames = [];
      return;
    }

    this.frameIndex++;
    this.notify('recording');
    if (!this.settled) this.rafId = requestAnimationFrame(() => void this.tick());
  }

  private async finish(): Promise<void> {
    if (this.settled) return;
    this.settled = true;
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);

    this.notify('finalizing');

    try {
      this.videoSource.close();
      await this.output.finalize();

      const buffer = this.target.buffer;
      if (!buffer) throw new Error('Export produced no data');
      const blob = new Blob([buffer], { type: this.mimeType });

      const looped = !this.stoppedEarly && this.overlapFrames > 0;
      const result: CaptureResult = {
        blob,
        format: this.mimeType.includes('mp4') ? 'mp4' : 'webm',
        mimeType: this.mimeType,
        durationSec: this.frameIndex / this.fps,
        looped,
      };
      this.resolveFn(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.notify('error', message);
      this.rejectFn(err instanceof Error ? err : new Error(message));
    } finally {
      for (const bmp of this.headFrames) bmp?.close();
      this.headFrames = [];
    }
  }
}

/**
 * Starts a capture from a live tile's canvas. Resolves once the recording
 * has finished encoding and muxing — the caller owns upload/ingest after
 * that (see lib/persist/client.ts's uploadCapturedClip).
 *
 * Throws synchronously (before any frame is captured) if WebCodecs isn't
 * available or no codec is encodable for this format/size on this device
 * — callers should check isCaptureSupported() before offering Record at
 * all, this is the deeper, format-specific check that can still fail even
 * when the shallow check passes.
 */
export async function startCapture(
  canvas: HTMLCanvasElement,
  options: CaptureOptions,
  onProgress?: CaptureListener,
): Promise<{ result: Promise<CaptureResult>; stop: () => void }> {
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') {
    throw new Error('Video export is not supported in this browser.');
  }

  const fps = options.fps ?? 30;
  const width = canvas.width;
  const height = canvas.height;
  if (width === 0 || height === 0) {
    throw new Error('Tile has no size yet — try again once it has rendered a frame.');
  }

  const codec = await resolveVideoCodec(options.format, width, height);
  if (!codec) {
    throw new Error(`No supported ${options.format.toUpperCase()} encoder found on this device.`);
  }

  const format = options.format === 'mp4' ? new Mp4OutputFormat() : new WebMOutputFormat();
  const mimeType = options.format === 'mp4' ? 'video/mp4' : 'video/webm';

  const target = new BufferTarget();
  const output = new Output({ format, target });

  // The single dedicated output canvas this whole recording draws onto —
  // see this file's top doc for why one canvas, built once, up front,
  // rather than swapping sources mid-recording.
  const outputCanvas = document.createElement('canvas');
  outputCanvas.width = width;
  outputCanvas.height = height;
  const outputCtx = outputCanvas.getContext('2d');
  if (!outputCtx) throw new Error('Could not create output compositing context');

  const videoSource = new CanvasSource(outputCanvas, { codec, bitrate: BITRATE });
  output.addVideoTrack(videoSource, { frameRate: fps });

  await output.start();

  const totalFrames = Math.round(options.durationSec * fps);
  const overlapFrames = Math.min(
    Math.round((CAPTURE_LOOP_OVERLAP_MS / 1000) * fps),
    Math.floor(totalFrames / 2),
    24,
  );

  const handle = new RecordingHandle({
    tileCanvas: canvas,
    outputCtx,
    output,
    target,
    videoSource,
    mimeType,
    fps,
    totalFrames,
    overlapFrames,
  });

  if (onProgress) handle.subscribe(onProgress);

  const result = handle.run();
  return { result, stop: () => handle.stop() };
}
