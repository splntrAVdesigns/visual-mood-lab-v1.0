// lib/validation/poster.ts
//
// Server-side rules for poster / snapshot writes. Pure functions, no I/O.
//
// Before this, POST /api/assets/:id and POST /api/boards/default/items/:itemId
// accepted ANY body of 2 KB – 10 MB and stored it as "image/png". Combined
// with loadPosterWritable() (which lets any signed-in user write to a
// library-owned asset) that meant any account could replace a shared tile's
// poster for every user, with any bytes, at any time.
//
// Three independent guards now apply:
//   1. the bytes must really be a PNG (signature + a sane IHDR),
//   2. a SHARED (library-owned) poster may only be written while it is still
//      the generated placeholder — the same rule the client already follows
//      via isPlaceholderPoster() — after which it is locked,
//   3. shared writes never overwrite a blob (see the route: unique pathname +
//      conditional UPDATE), so two racing first-captures can't clobber each
//      other or a locked poster.

import { MAX_POSTER_CAPTURE_BYTES } from './asset';

export const MIN_POSTER_BYTES = 2048;

/**
 * Matches the 16384px per-side ceiling most browsers put on a canvas — so
 * nothing a legitimate toBlob() capture could produce is refused (a snapshot
 * of a large uploaded image is captured at its natural size). It exists to
 * reject a hand-forged IHDR claiming an absurd pixel count, nothing else.
 */
export const MAX_POSTER_DIMENSION = 16384;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export type PosterBytesCheck =
  | { ok: true; width: number; height: number }
  | { ok: false; status: 413 | 415 | 422; error: string };

export function hasPngSignature(bytes: Uint8Array): boolean {
  if (bytes.byteLength < PNG_SIGNATURE.length) return false;
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) return false;
  }
  return true;
}

/**
 * Reads width/height from the IHDR chunk, which the PNG spec requires to be
 * the first chunk: 4-byte length (13), 'IHDR', then big-endian width/height.
 * Returns null for anything that doesn't have that exact shape.
 */
export function readPngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (!hasPngSignature(bytes) || bytes.byteLength < 24) return null;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunkLength = view.getUint32(8);
  const isIhdr =
    bytes[12] === 0x49 && bytes[13] === 0x48 && bytes[14] === 0x44 && bytes[15] === 0x52;
  if (chunkLength !== 13 || !isIhdr) return null;

  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/**
 * Size floor/ceiling (unchanged limits and messages, so existing clients see
 * identical responses for the cases that already worked), then real-PNG checks.
 */
export function validatePosterBytes(
  bytes: Uint8Array,
  maxBytes: number = MAX_POSTER_CAPTURE_BYTES,
): PosterBytesCheck {
  // A poster this small is almost certainly a blank frame captured before
  // anything drew — see the matching comment in the routes.
  if (bytes.byteLength < MIN_POSTER_BYTES) {
    return { ok: false, status: 422, error: 'Capture too small, ignored' };
  }
  if (bytes.byteLength > maxBytes) {
    return { ok: false, status: 413, error: 'Capture too large' };
  }
  if (!hasPngSignature(bytes)) {
    return { ok: false, status: 415, error: 'Poster must be a PNG image' };
  }

  const dims = readPngDimensions(bytes);
  if (
    !dims ||
    dims.width < 1 ||
    dims.height < 1 ||
    dims.width > MAX_POSTER_DIMENSION ||
    dims.height > MAX_POSTER_DIMENSION
  ) {
    return { ok: false, status: 422, error: 'Invalid PNG dimensions' };
  }

  return { ok: true, width: dims.width, height: dims.height };
}

/**
 * True for a generated placeholder poster (the .svg written at ingest) or no
 * poster at all. Mirrors isPlaceholderPoster() in lib/persist/client.ts,
 * except that it ignores a query string / fragment.
 */
export function isPlaceholderPosterUrl(url: string | null | undefined): boolean {
  if (!url) return true;
  const path = url.split(/[?#]/)[0];
  return path.toLowerCase().endsWith('.svg');
}

export type PosterWriteMode =
  /** The caller's own asset: may replace its poster freely (still PNG-validated). */
  | 'own'
  /** Library asset still on its placeholder: first valid capture wins. */
  | 'shared-first-capture'
  /** Library asset that already has a real poster: locked. */
  | 'shared-locked'
  /** Someone else's asset: not visible to this caller at all. */
  | 'forbidden';

export function posterWriteMode(args: {
  ownerId: string;
  userId: string;
  libraryOwnerId: string;
  currentPosterUrl: string | null | undefined;
}): PosterWriteMode {
  if (args.ownerId === args.userId) return 'own';
  if (args.ownerId === args.libraryOwnerId) {
    return isPlaceholderPosterUrl(args.currentPosterUrl) ? 'shared-first-capture' : 'shared-locked';
  }
  return 'forbidden';
}
