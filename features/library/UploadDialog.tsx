'use client';

import { useCallback, useRef, useState } from 'react';
import { Button, Dialog, UploadIcon } from '@/components/ui';
import { useBoardStore } from '@/stores';
import type { Asset } from '@/types/asset';
import {
  MAX_UPLOAD_BYTES,
  MAX_FILES_PER_BATCH,
  isAllowedUploadMimeType,
  sanitizeAssetTitle,
} from '@/lib/validation/asset';
import s from '../features.module.css';

interface UploadDialogProps {
  open: boolean;
  onClose: () => void;
}

interface Job {
  name: string;
  status: 'pending' | 'uploading' | 'ingesting' | 'done' | 'error';
  message?: string;
}

const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml,video/webm,video/mp4';

/**
 * Upload media into the library.
 *
 * The upload API has existed since Phase 1 but had no way to reach it by
 * clicking, which meant the app could accept images and video in principle
 * and not in practice. Bytes go straight from the browser to storage using a
 * short-lived signed URL — they never pass through a server route, because a
 * 40MB video through a serverless function is a payload-limit failure
 * waiting to happen.
 *
 * The checks in this file (size, MIME allowlist, batch count) are a UX
 * nicety only — fast, local rejection instead of a round trip that fails
 * later. The `accept` attribute on the file input does NOT enforce
 * anything: it's ignored entirely for drag-and-drop, and even for the
 * picker it's just a filter suggestion the OS lets a user override. The
 * real enforcement has to live in /api/upload (which issues the signed
 * URL) and in ingest.ts — both should apply the same
 * MAX_UPLOAD_BYTES / isAllowedUploadMimeType checks from
 * lib/validation/asset.ts server-side, since nothing client-side here can
 * be trusted on its own.
 */
export function UploadDialog({ open, onClose }: UploadDialogProps) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const addAsset = useBoardStore((st) => st.addAsset);

  const setJob = (name: string, patch: Partial<Job>) => {
    setJobs((prev) => prev.map((j) => (j.name === name ? { ...j, ...patch } : j)));
  };

  const uploadOne = useCallback(
    async (file: File) => {
      // Local, instant rejection for the two cheap-to-check cases —
      // skips the network round trip entirely for the common mistakes
      // (wrong file type, file too large) instead of waiting on a server
      // response to say the same thing.
      if (!isAllowedUploadMimeType(file.type)) {
        setJob(file.name, {
          status: 'error',
          message: `"${file.type || 'unknown type'}" isn't a supported file type.`,
        });
        return;
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        const mb = Math.round(file.size / (1024 * 1024));
        const maxMb = Math.round(MAX_UPLOAD_BYTES / (1024 * 1024));
        setJob(file.name, {
          status: 'error',
          message: `File is ${mb}MB — the limit is ${maxMb}MB.`,
        });
        return;
      }

      setJob(file.name, { status: 'uploading' });

      try {
        const signRes = await fetch('/api/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filename: file.name,
            contentType: file.type,
            size: file.size,
          }),
        });

        if (!signRes.ok) {
          const err = (await signRes.json()) as { error?: string };
          setJob(file.name, { status: 'error', message: err.error ?? 'Rejected' });
          return;
        }

        const signed = (await signRes.json()) as {
          assetId: string;
          uploadUrl: string;
          publicUrl: string;
          headers?: Record<string, string>;
        };

        const put = await fetch(signed.uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': file.type, ...(signed.headers ?? {}) },
          body: file,
        });

        if (!put.ok) {
          // Surfacing the real response body here, not just "Upload failed"
          // — Vercel Blob returns a small JSON error body naming the exact
          // reason (expired token, store mismatch, etc.), and Chrome's
          // Network panel has proven unreliable at holding onto that body
          // long enough to inspect it after the fact ("Request content was
          // evicted from inspector cache", reliably, on repeat attempts).
          // Reading it directly in code sidesteps that entirely — and a
          // specific reason is more useful to any future user hitting this
          // than "Upload failed" ever was.
          const detail = await put
            .text()
            .then((text) => {
              try {
                const parsed = JSON.parse(text) as { error?: unknown; message?: string };
                const raw = parsed.error ?? parsed.message ?? text;
                // Vercel Blob's error body nests an object here
                // ({ error: { code, message } }), not a flat string — the
                // first version of this assumed a string and got literal
                // "[object Object]" from the template interpolation below.
                if (typeof raw === 'string') return raw;
                if (raw && typeof raw === 'object') {
                  const nested = raw as { message?: string; code?: string };
                  return nested.message ?? nested.code ?? JSON.stringify(raw);
                }
                return text;
              } catch {
                return text;
              }
            })
            .catch(() => '');
          setJob(file.name, {
            status: 'error',
            message: detail ? `Upload failed (${put.status}): ${detail}` : `Upload failed (${put.status})`,
          });
          return;
        }

        // Vercel Blob's real URL is store-specific
        // (https://<storeId>.public.blob.vercel-storage.com/<pathname>) —
        // not something a generically constructed URL can predict. The PUT
        // response itself returns the authoritative blob metadata, so read
        // the URL from there rather than trusting the guess made at sign
        // time. Falls back to the guess only if the body is unreadable, so
        // local dev (which has no such response shape) still works.
        const realUrl = await put
          .json()
          .then((body: { url?: string }) => body.url)
          .catch(() => undefined);

        setJob(file.name, { status: 'ingesting' });

        const ingest = await fetch('/api/assets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            assetId: signed.assetId,
            // Sanitized client-side too, purely so the title the person
            // sees land on the board matches what the server will
            // actually store — ingest.ts (the real boundary) runs the
            // same sanitizeAssetTitle() again regardless of this value.
            title: sanitizeAssetTitle(file.name.replace(/\.[^.]+$/, '')),
            contentType: file.type,
            srcUrl: realUrl ?? signed.publicUrl,
          }),
        });

        if (!ingest.ok) {
          setJob(file.name, { status: 'error', message: 'Could not add to board' });
          return;
        }

        const data = (await ingest.json()) as { asset?: Asset };
        if (data.asset) addAsset(data.asset);
        setJob(file.name, { status: 'done' });
      } catch {
        setJob(file.name, { status: 'error', message: 'Unexpected failure' });
      }
    },
    [addAsset],
  );

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      let list = Array.from(files);

      const overflow = list.length - MAX_FILES_PER_BATCH;
      if (overflow > 0) {
        list = list.slice(0, MAX_FILES_PER_BATCH);
      }

      setJobs(list.map((f) => ({ name: f.name, status: 'pending' as const })));

      if (overflow > 0) {
        setJobs((prev) => [
          ...prev,
          {
            name: `+${overflow} more`,
            status: 'error' as const,
            message: `Only the first ${MAX_FILES_PER_BATCH} files were queued — upload the rest in another batch.`,
          },
        ]);
      }

      // Sequential rather than parallel: signed URLs are short-lived, and a
      // dozen simultaneous uploads on a slow connection risk some expiring
      // before their turn.
      for (const file of list) await uploadOne(file);
    },
    [uploadOne],
  );

  const done = jobs.length > 0 && jobs.every((j) => j.status === 'done' || j.status === 'error');

  return (
    <Dialog
      open={open}
      title="Upload media"
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={() => setJobs([])} disabled={jobs.length === 0}>
            Clear
          </Button>
          <Button variant="accent" onClick={onClose}>
            {done ? 'Done' : 'Close'}
          </Button>
        </>
      }
    >
      <div
        className={s.dropZone}
        data-dragging={dragging ? 'true' : undefined}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void handleFiles(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
      >
        <UploadIcon size={20} />
        <span className={s.dropTitle}>Drop files here, or click to choose</span>
        <span className={s.dropHint}>PNG · JPG · WebP · GIF · SVG · WebM · MP4 — up to 200MB</span>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT}
          className={s.dropInput}
          onChange={(e) => void handleFiles(e.target.files)}
        />
      </div>

      {jobs.length > 0 && (
        <ul className={s.jobList}>
          {jobs.map((job) => (
            <li key={job.name} className={s.jobRow} data-status={job.status}>
              <span className={s.jobName}>{job.name}</span>
              <span className={s.jobStatus}>
                {job.status === 'error' ? (job.message ?? 'Failed') : job.status}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
