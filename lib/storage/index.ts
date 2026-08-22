import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MAX_UPLOAD_BYTES } from '@/lib/validation/asset';

/**
 * Binary assets never stream through an API route — the client uploads
 * directly to storage using a short-lived signed URL issued by the server.
 * A 40MB WebM through a serverless function is a payload-limit failure
 * waiting to happen.
 *
 * Two implementations behind one interface:
 *   VercelBlobStorage — production
 *   LocalStorage      — writes to public/uploads, so dev needs no credentials
 *
 * Swapping in Cloudflare R2 later means one more implementation, no callers
 * changed.
 */

export interface PutResult {
  url: string;
  pathname: string;
  size: number;
}

export interface SignedUpload {
  /** Where the client PUTs the bytes. */
  uploadUrl: string;
  /** Where the bytes will be readable once uploaded. */
  publicUrl: string;
  pathname: string;
  /** Epoch ms. Clients should not cache these. */
  expiresAt: number;
  /**
   * Extra headers the client must send on the PUT. Vercel Blob's client
   * token is a bearer credential — it belongs in Authorization, not baked
   * into the URL as a query string, which its storage backend silently
   * rejects with "Cannot get token from authorization header or cookie".
   * Undefined for providers (local dev) that need no auth at all.
   */
  headers?: Record<string, string>;
}

export interface StorageAdapter {
  readonly name: string;
  /** Server-side write. Used by the ingest pipeline for posters. */
  put(pathname: string, data: Buffer | Uint8Array, contentType: string): Promise<PutResult>;
  /** Issue a short-lived direct-upload URL for the client. */
  createSignedUpload(pathname: string, contentType: string): Promise<SignedUpload>;
  delete(pathname: string): Promise<void>;
}

/* ------------------------------------------------------------------ *
 * Vercel Blob
 * ------------------------------------------------------------------ */

class VercelBlobStorage implements StorageAdapter {
  readonly name = 'vercel-blob';

  async put(pathname: string, data: Buffer | Uint8Array, contentType: string): Promise<PutResult> {
    const { put } = await import('@vercel/blob');
    const res = await put(pathname, Buffer.from(data), {
      access: 'public',
      contentType,
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    return { url: res.url, pathname: res.pathname, size: data.byteLength };
  }

  /**
   * Vercel Blob issues client tokens rather than presigned PUT URLs, so the
   * browser talks to the blob client SDK with this token. The shape is
   * normalised to SignedUpload so callers do not branch on provider.
   */
  async createSignedUpload(pathname: string, contentType: string): Promise<SignedUpload> {
    const { generateClientTokenFromReadWriteToken } = await import('@vercel/blob/client');
    const expiresAt = Date.now() + 60_000;

    const token = await generateClientTokenFromReadWriteToken({
      pathname,
      validUntil: expiresAt,
      allowedContentTypes: [contentType],
      // Previously missing — app/api/upload/route.ts checks a
      // client-REPORTED size before issuing this token, but nothing
      // stopped the actual PUT that follows from sending more bytes than
      // it claimed; that check was a self-reported number, not an
      // enforced limit. This constrains the signed token itself, so an
      // oversized PUT is rejected by Vercel's infrastructure regardless
      // of what the sign request said. Confirm this option name against
      // your installed @vercel/blob version's type defs — the client
      // token API has changed shape before across major versions.
      maximumSizeInBytes: MAX_UPLOAD_BYTES,
    });

    return {
      uploadUrl: `https://blob.vercel-storage.com/${pathname}`,
      publicUrl: `${process.env.BLOB_PUBLIC_BASE ?? 'https://blob.vercel-storage.com'}/${pathname}`,
      pathname,
      expiresAt,
      headers: { authorization: `Bearer ${token}` },
    };
  }

  async delete(pathname: string): Promise<void> {
    const { del } = await import('@vercel/blob');
    await del(pathname);
  }
}

/* ------------------------------------------------------------------ *
 * Local filesystem
 * ------------------------------------------------------------------ */

class LocalStorage implements StorageAdapter {
  readonly name = 'local';
  private readonly root = join(process.cwd(), 'public', 'uploads');

  async put(pathname: string, data: Buffer | Uint8Array, _contentType: string): Promise<PutResult> {
    const target = join(this.root, pathname);
    await mkdir(dirOf(target), { recursive: true });
    await writeFile(target, Buffer.from(data));
    return { url: `/uploads/${pathname}`, pathname, size: data.byteLength };
  }

  /**
   * No signing locally — the dev upload route accepts the bytes directly
   * (and, since app/api/upload/local/route.ts now hard-blocks itself
   * outside development, this path is unreachable in production
   * regardless). `expiresAt` here is informational only — nothing checks
   * it against the clock, unlike Vercel Blob's token above, which enforces
   * `validUntil` cryptographically. Not worth fixing given the production
   * block already closes the gap this would otherwise leave.
   */
  async createSignedUpload(pathname: string, _contentType: string): Promise<SignedUpload> {
    return {
      uploadUrl: `/api/upload/local?pathname=${encodeURIComponent(pathname)}`,
      publicUrl: `/uploads/${pathname}`,
      pathname,
      expiresAt: Date.now() + 600_000,
    };
  }

  async delete(pathname: string): Promise<void> {
    const { rm } = await import('node:fs/promises');
    await rm(join(this.root, pathname), { force: true });
  }
}

function dirOf(p: string): string {
  return p.slice(0, p.lastIndexOf('/'));
}

/* ------------------------------------------------------------------ */

let cached: StorageAdapter | null = null;

export function getStorage(): StorageAdapter {
  if (cached) return cached;
  cached = process.env.BLOB_READ_WRITE_TOKEN ? new VercelBlobStorage() : new LocalStorage();
  return cached;
}
