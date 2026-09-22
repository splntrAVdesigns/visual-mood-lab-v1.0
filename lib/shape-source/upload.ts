/**
 * Shape Source — per-tile shape file upload.
 *
 * Same sign -> PUT flow as UploadDialog and uploadCapturedClip, minus the
 * ingest step: a Shapeshift shape belongs to one tile, not the board's asset
 * library (decision #4, per-tile only), so it is stored and referenced by
 * URL from that tile's params and nothing else.
 *
 * SVGs are sanitised and size-normalised BEFORE upload (lib/shape-source/
 * svg.ts), so the stored file is the clean one.
 *
 * Location: lib/shape-source/upload.ts
 */

import { sanitizeSvg, SvgError } from './svg';

export const SHAPE_FILE_TYPES = ['image/svg+xml', 'image/png', 'image/webp', 'image/jpeg'] as const;
const MAX_SVG_BYTES = 2 * 1024 * 1024;
const MAX_RASTER_BYTES = 10 * 1024 * 1024;

export type ShapeUploadResult = { ok: true; url: string } | { ok: false; error: string };

function isSvg(file: File): boolean {
  return file.type === 'image/svg+xml' || /\.svg$/i.test(file.name);
}

export async function uploadShapeFile(file: File): Promise<ShapeUploadResult> {
  const svg = isSvg(file);
  const contentType = svg ? 'image/svg+xml' : file.type;

  if (!(SHAPE_FILE_TYPES as readonly string[]).includes(contentType)) {
    return { ok: false, error: 'Use an SVG, PNG, WebP or JPG file.' };
  }
  if (file.size > (svg ? MAX_SVG_BYTES : MAX_RASTER_BYTES)) {
    return { ok: false, error: svg ? 'SVG is over 2 MB — simplify it and try again.' : 'Image is over 10 MB — use a smaller one.' };
  }

  let body: Blob = file;
  if (svg) {
    try {
      body = new Blob([sanitizeSvg(await file.text())], { type: 'image/svg+xml' });
    } catch (err) {
      return { ok: false, error: err instanceof SvgError ? `${err.message}.` : 'Could not read this SVG.' };
    }
  }

  try {
    const signRes = await fetch('/api/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: file.name, contentType, size: body.size }),
    });
    if (signRes.status === 401) return { ok: false, error: 'Sign in to upload a shape file.' };
    if (!signRes.ok) {
      const err = (await signRes.json().catch(() => ({}))) as { error?: string };
      return { ok: false, error: err.error ?? 'Could not start the upload.' };
    }
    const signed = (await signRes.json()) as { uploadUrl: string; publicUrl: string; headers?: Record<string, string> };

    const put = await fetch(signed.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': contentType, ...(signed.headers ?? {}) },
      body,
    });
    if (!put.ok) return { ok: false, error: `Upload failed (${put.status}). Try again.` };

    // The real Vercel Blob URL is only known from the PUT response body (see
    // UploadDialog); local dev storage has no body, so use the signed one.
    const real = await put.json().then((b: { url?: string }) => b.url).catch(() => undefined);
    return { ok: true, url: real ?? signed.publicUrl };
  } catch {
    return { ok: false, error: 'Upload failed — check your connection and try again.' };
  }
}
