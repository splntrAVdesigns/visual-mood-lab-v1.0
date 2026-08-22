// lib/validation/asset.ts
//
// Validation for asset metadata (title, tags) — deliberately a different
// posture than lib/validation/auth.ts. Account fields (username, email,
// password) REJECT invalid input, because silently transforming a
// credential is confusing and can create collisions. Asset titles come
// from filenames the person didn't consciously type character-by-character
// (a camera or export tool named the file, not them), so SANITIZE — clean
// it up and proceed — is the right default here. Tags are non-critical
// decorative metadata; malformed ones are dropped rather than blocking
// the whole upload.
//
// Used from both the client (UploadDialog, for a consistent preview of
// what will actually be stored) and the server (ingest.ts, the
// authoritative boundary every ingest path — seed and upload alike —
// passes through).

export const ASSET_TITLE_MAX = 120;
export const ASSET_TAG_MAX_LENGTH = 30;
export const ASSET_TAGS_MAX_COUNT = 12;

// Strips control/formatting characters (null bytes, escape sequences,
// etc.) but leaves normal printable unicode alone — titles are free text
// and shouldn't be limited to ASCII, just to characters that can't do
// anything unexpected when stored or rendered.
function stripControlChars(value: string): string {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
}

/**
 * Cleans and length-caps a title. Never throws — always returns a usable
 * string, falling back to "Untitled" if nothing printable survives.
 */
export function sanitizeAssetTitle(raw: string | null | undefined): string {
  const cleaned = stripControlChars(raw ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, ASSET_TITLE_MAX);
  return cleaned.length > 0 ? cleaned : 'Untitled';
}

/**
 * Cleans a single tag; returns null (drop it) rather than throwing when
 * it's empty, too long, or contains characters outside the allowlist.
 */
export function sanitizeTag(raw: string): string | null {
  const cleaned = stripControlChars(raw).trim().toLowerCase().replace(/\s+/g, ' ');
  if (!cleaned || cleaned.length > ASSET_TAG_MAX_LENGTH) return null;
  if (!/^[a-z0-9][a-z0-9 _-]*$/.test(cleaned)) return null;
  return cleaned;
}

/**
 * Cleans a tag list: drops anything malformed, de-duplicates, caps count.
 * Accepts `unknown` because this is also the first line of defense against
 * a malformed request body on the server (e.g. `tags` not actually being
 * an array of strings) — never throws, worst case returns [].
 */
export function sanitizeAssetTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];

  const seen = new Set<string>();
  const out: string[] = [];

  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const tag = sanitizeTag(item);
    if (tag && !seen.has(tag)) {
      seen.add(tag);
      out.push(tag);
    }
    if (out.length >= ASSET_TAGS_MAX_COUNT) break;
  }

  return out;
}

/* ------------------------------------------------------------------ *
 * Upload constraints — mirrored client-side (UploadDialog, for instant
 * feedback before spending a signed-URL round trip) and server-side
 * (app/api/upload/route.ts, where the size limit is also enforced by
 * lib/storage/index.ts's Vercel Blob client token itself, not just this
 * app's own check).
 * ------------------------------------------------------------------ */
export const MAX_UPLOAD_BYTES = 200 * 1024 * 1024; // 200MB, matches UploadDialog's copy
export const MAX_FILES_PER_BATCH = 20;

// Poster/snapshot captures are a single rendered canvas frame, not a raw
// upload — 10MB is generous headroom over anything a real capture should
// ever produce. Both app/api/assets/[id]/route.ts and
// app/api/boards/default/items/[itemId]/route.ts read the full request
// body into memory before any size check can run (no streaming), so this
// is also what bounds the memory a single malicious or malfunctioning
// request can force the server to hold.
export const MAX_POSTER_CAPTURE_BYTES = 10 * 1024 * 1024;

export const ALLOWED_UPLOAD_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/svg+xml',
  'video/webm',
  'video/mp4',
] as const;

export function isAllowedUploadMimeType(contentType: string): boolean {
  return (ALLOWED_UPLOAD_MIME_TYPES as readonly string[]).includes(contentType);
}
