import { NextResponse } from 'next/server';
import { listAssets } from '@/lib/data/assets';
import { ingestAsset } from '@/lib/ingest/ingest';
import { requireUser } from '@/lib/auth';
import { sanitizeAssetTags } from '@/lib/validation/asset';
import type { AssetType } from '@/types/asset';

export const dynamic = 'force-dynamic';

// Validates a registered srcUrl two ways: (1) it has to be on a host this
// app's own storage layer actually issues — matched against
// lib/storage/index.ts's real URL shapes, not a guessed pattern — and (2)
// its path has to start with the caller's own ownerId prefix, the same
// prefix app/api/upload/route.ts always signs new uploads under. That
// second check is what actually ties a registered asset back to "something
// this user was issued a signed URL for", rather than just "some URL on
// our domain" — without it, any authenticated user could register a board
// asset pointing at any OTHER already-public blob URL they happened to
// obtain, not just their own.
function isAllowedSrcUrl(raw: string, requestUrl: string, ownerId: string): boolean {
  // Local dev: LocalStorage writes to /uploads/<pathname> and returns that
  // as a same-origin relative path (see lib/storage/index.ts).
  if (raw.startsWith('/uploads/')) {
    return raw.startsWith(`/uploads/${ownerId}/`);
  }

  let parsed: URL;
  try {
    parsed = new URL(raw, requestUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;

  // VercelBlobStorage.createSignedUpload() builds publicUrl from
  // BLOB_PUBLIC_BASE when set, falling back to the bare
  // https://blob.vercel-storage.com host otherwise — match whichever is
  // actually configured rather than assuming a store-specific subdomain
  // that this app doesn't construct itself. If BLOB_PUBLIC_BASE ever
  // changes, this check tracks it automatically since it reads the same
  // env var.
  // Widened (Video Export Foundation sprint, diagnosed via a real capture
  // upload): a real Vercel Blob PUT response returns a STORE-SPECIFIC
  // subdomain, e.g. https://1kyosdncv2n7pwrf.public.blob.vercel-storage.com
  // — never the bare blob.vercel-storage.com host. The bare-host exact
  // match below only ever matched VercelBlobStorage.createSignedUpload()'s
  // own GUESSED fallback publicUrl (used only when the PUT response body
  // couldn't be read) — every real, successfully-read upload URL was
  // rejected here regardless of ownership being correct, which is exactly
  // what a captured clip's srcUrl hit. `.endsWith('.public.blob.vercel-
  // storage.com')` is still strict: an attacker cannot provision an
  // arbitrary subdomain of vercel-storage.com, so this doesn't loosen the
  // actual security intent, only the previously-too-narrow format match.
  const configuredBase = process.env.BLOB_PUBLIC_BASE;
  let isKnownBlobHost: boolean;
  try {
    isKnownBlobHost = configuredBase
      ? parsed.origin === new URL(configuredBase).origin
      : parsed.hostname === 'blob.vercel-storage.com' ||
        parsed.hostname.endsWith('.public.blob.vercel-storage.com');
  } catch {
    isKnownBlobHost = false;
  }
  if (!isKnownBlobHost) return false;

  const path = parsed.pathname.replace(/^\//, '');
  return path.startsWith(`${ownerId}/`);
}

export async function GET() {
  try {
    // listAssets() already calls requireUser() internally and throws
    // UnauthorizedError (status 401) if there's no session — this was
    // already gated, just not mapped to the right HTTP status. Catching
    // that specifically below is the actual fix; nothing here changes
    // what's visible to an unauthenticated caller, which was already
    // nothing.
    const assets = await listAssets();
    return NextResponse.json({ assets });
  } catch (err) {
    if (err instanceof Error && 'status' in err && (err as { status?: number }).status === 401) {
      return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
    }
    console.error('[api/assets]', err);
    return NextResponse.json({ error: 'Failed to list assets' }, { status: 500 });
  }
}

const TYPE_FOR: Record<string, AssetType> = {
  'image/png': 'image',
  'image/jpeg': 'image',
  'image/webp': 'image',
  'image/gif': 'image',
  'image/svg+xml': 'svg',
  'video/webm': 'video',
  'video/mp4': 'video',
};

/**
 * Registers an already-uploaded file as a board asset.
 *
 * The bytes are in storage before this runs — this only creates the row and
 * the board item, through the same ingestAsset path the seed script uses. No
 * second code path means uploaded media behaves identically to seeded media
 * by construction.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body = (await req.json()) as {
      assetId?: string;
      title?: string;
      contentType?: string;
      srcUrl?: string;
      /** Optional, additive. Existing callers (UploadDialog) never send
          this and are unaffected — 'upload' is still always applied.
          Added for captured video clips (Video Export Foundation sprint),
          which also carry a 'capture' tag so Media Library work can
          filter/find them distinctly from a manual file upload later. */
      tags?: unknown;
    };

    const type = TYPE_FOR[body.contentType ?? ''];
    if (!type || !body.srcUrl) {
      // TEMPORARY DIAGNOSTIC — Video Export Foundation, tracking down the
      // capture-ingest 400. Safe to leave in (never fires for a healthy
      // request) or remove once the root cause is confirmed; either way
      // it's server-side only, never reaches the client response body.
      console.error('[api/assets] rejected: incomplete upload', {
        contentType: body.contentType,
        srcUrl: body.srcUrl,
      });
      return NextResponse.json({ error: 'Unsupported or incomplete upload' }, { status: 400 });
    }

    if (!isAllowedSrcUrl(body.srcUrl, req.url, user.id)) {
      // TEMPORARY DIAGNOSTIC — see note above.
      console.error('[api/assets] rejected: srcUrl not allowed', {
        srcUrl: body.srcUrl,
        ownerId: user.id,
      });
      return NextResponse.json({ error: 'srcUrl is not from an allowed source' }, { status: 400 });
    }

    const extraTags = sanitizeAssetTags(body.tags ?? []);
    const tags = extraTags.length > 0 ? Array.from(new Set(['upload', ...extraTags])) : ['upload'];

    const res = await ingestAsset({
      ownerId: user.id,
      type,
      title: body.title?.trim() || 'Untitled',
      tags,
      srcUrl: body.srcUrl,
    });

    const assets = await listAssets();
    const asset = assets.find((a) => a.id === res.id);

    return NextResponse.json({ ok: true, asset });
  } catch (err) {
    console.error('[api/assets POST]', err);
    return NextResponse.json({ error: 'Failed to register asset' }, { status: 500 });
  }
}
