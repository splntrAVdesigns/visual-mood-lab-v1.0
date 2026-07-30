import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

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
    });

    return {
      uploadUrl: `https://blob.vercel-storage.com/${pathname}?token=${token}`,
      publicUrl: `${process.env.BLOB_PUBLIC_BASE ?? 'https://blob.vercel-storage.com'}/${pathname}`,
      pathname,
      expiresAt,
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
   * No signing locally — the dev upload route accepts the bytes directly.
   * The client code path is identical; only the URL differs.
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
