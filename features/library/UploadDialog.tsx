'use client';

import { useCallback, useRef, useState } from 'react';
import { Button, Dialog, UploadIcon } from '@/components/ui';
import { useBoardStore } from '@/stores';
import type { Asset } from '@/types/asset';
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
        };

        const put = await fetch(signed.uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': file.type },
          body: file,
        });

        if (!put.ok) {
          setJob(file.name, { status: 'error', message: 'Upload failed' });
          return;
        }

        setJob(file.name, { status: 'ingesting' });

        const ingest = await fetch('/api/assets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            assetId: signed.assetId,
            title: file.name.replace(/\.[^.]+$/, ''),
            contentType: file.type,
            srcUrl: signed.publicUrl,
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
      const list = Array.from(files);

      setJobs(list.map((f) => ({ name: f.name, status: 'pending' as const })));

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
