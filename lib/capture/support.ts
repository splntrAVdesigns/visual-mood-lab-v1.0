// lib/capture/support.ts
//
// Capability detection for the capture path. Checked once and cached —
// VideoEncoder support cannot change mid-session.
//
// Rewritten against Mediabunny (mp4-muxer/webm-muxer are both formally
// deprecated by their own author in favor of this — see engine.ts's top
// doc for the full reasoning). Mediabunny still uses VideoEncoder/
// VideoFrame under the hood, so the browser floor is unchanged: Chrome
// 94+, Edge 94+, Firefox 130+, Safari 16.4+ (video-only — AudioEncoder/
// AudioDecoder only from Safari 26, irrelevant here since this module
// never touches audio).
//
// Location: lib/capture/support.ts

import { canEncodeVideo, getFirstEncodableVideoCodec, WebMOutputFormat } from 'mediabunny';
import type { VideoCodec } from 'mediabunny';

let cached: boolean | null = null;

/**
 * The size a recording is actually encoded at: the tile canvas's own size
 * rounded DOWN to even on both axes (never below 2).
 *
 * H.264 (and HEVC) encode 4:2:0 chroma in 2×2 blocks, so an odd width or
 * height is not a legal frame size — Mediabunny's canEncodeVideo() returns
 * false for AVC at any odd dimension before it ever asks the browser (see
 * `hasOddDimension` in mediabunny/dist/modules/src/encode.js). A tile's canvas
 * size is not chosen, it falls out of layout: ShaderRenderer sizes it
 * round(cssSize × min(dpr, 2) × fit), and the CSS size of the focused view
 * moves with the viewport — on iOS Safari that includes the URL bar
 * collapsing or expanding. So the same tile on the same phone is odd one
 * minute and even the next, which is why MP4 "used to work" on mobile and
 * why WebM (VP8/VP9 have no such rule) never failed. Desktop layouts just
 * happened to land even.
 *
 * Applied to WebM too: odd frame sizes are legal there, but some decoders
 * and every downstream H.264 transcode (social uploads) choke on them.
 * Losing at most one pixel column / row is invisible.
 */
export function encodableSize(width: number, height: number): { width: number; height: number } {
  const even = (n: number) => Math.max(2, Math.floor(n / 2) * 2);
  return { width: even(width), height: even(height) };
}

/** True if this browser can encode video via WebCodecs at all — the fast,
    synchronous gate RecordButton.tsx / CapturePanel.tsx use to decide
    whether to render as usable vs. disabled-with-tooltip. Mediabunny
    wraps VideoEncoder/VideoFrame rather than replacing the need for
    them, so this check is unchanged from the pre-Mediabunny version. */
export function isCaptureSupported(): boolean {
  if (cached !== null) return cached;
  cached =
    typeof window !== 'undefined' &&
    typeof (window as unknown as { VideoEncoder?: unknown }).VideoEncoder !== 'undefined' &&
    typeof (window as unknown as { VideoFrame?: unknown }).VideoFrame !== 'undefined';
  return cached;
}

/**
 * Resolves the video codec to encode with for a given format/size, or
 * null if nothing usable exists on this device. Deeper and slower than
 * isCaptureSupported() — called once at record-start time, not on every
 * render.
 *
 * MP4 is deliberately AVC (H.264) only, never AV1/HEVC even if
 * getFirstEncodableVideoCodec would offer one — AVC-only is what makes
 * MP4 the universal mobile-safe export target in the first place (the
 * whole reason this app defaults to it). WebM prefers VP9, the modern
 * default, and falls back to whatever else the browser can actually
 * encode inside a WebM container rather than failing outright.
 */
export async function resolveVideoCodec(
  format: 'mp4' | 'webm',
  width: number,
  height: number,
): Promise<VideoCodec | null> {
  if (format === 'mp4') {
    const ok = await canEncodeVideo('avc', { width, height });
    return ok ? 'avc' : null;
  }

  const vp9Ok = await canEncodeVideo('vp9', { width, height });
  if (vp9Ok) return 'vp9';

  return getFirstEncodableVideoCodec(new WebMOutputFormat().getSupportedVideoCodecs(), { width, height });
}
