'use client';

import { useEffect, useRef, useState } from 'react';
import { Button, RecordIcon, Toast, Tooltip } from '@/components/ui';
import { useBoardStore } from '@/stores';
import type { Asset } from '@/types/asset';
import { getPool } from '@/lib/render/pool';
import { startCapture } from '@/lib/capture/engine';
import { isCaptureSupported } from '@/lib/capture/support';
import { uploadCapturedClip, downloadBlob } from '@/lib/persist/client';
import type { CaptureFormat, CaptureLoopMode } from '@/lib/capture/types';
import s from '../features.module.css';

type Phase = 'idle' | 'recording' | 'finalizing' | 'processing' | 'uploading' | 'done' | 'error';

interface RecordButtonProps {
  asset: Asset;
  /** Gated the same way canVfx is — see FocusedAssetOverlay.tsx / this
      file's own capture engine doc for why p5 sketch tiles can't record
      yet (sandboxed cross-origin canvas, not a valid capture source). */
  canCapture: boolean;
  format: CaptureFormat;
  durationSec: number;
  loopMode: CaptureLoopMode;
  overlapMs: number;
  onBusyChange: (busy: boolean) => void;
  /** 'icon' for the header row (desktop + mobile actions bar) —
      icon-only, pulses while recording. */
  variant?: 'icon';
}

/**
 * The only control that starts or stops a recording. VCapture (see
 * CapturePanel.tsx) only ever sets format/duration — pressing it never
 * records anything. Pressing this a second time while recording stops
 * early; an untreated partial source is saved without a loop treatment.
 */
export function RecordButton({ asset, canCapture, format, durationSec, loopMode, overlapMs, onBusyChange, variant }: RecordButtonProps) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const stopRequested = useRef(false);
  const [recovery, setRecovery] = useState<{ blob: Blob; format: CaptureFormat } | null>(null);
  const busyRef = useRef(false);
  const cancelRef = useRef<(() => void) | null>(null);
  const [target, setTarget] = useState(durationSec);
  const [processing, setProcessing] = useState(0);
  const stopRef = useRef<(() => void) | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // A recording in flight when this unmounts (asset closed mid-record)
      // still needs to be stopped — otherwise the engine's own rAF loop
      // keeps sampling a canvas whose card may be about to be demoted/
      // disposed by the pool. Uploading the resulting partial clip is
      // skipped (no mounted component left to hand the result to); this
      // is a clean abort, not a leak — startCapture's promise chain below
      // already checks mountedRef before acting on its result.
      cancelRef.current?.();
      onBusyChange(false);
    };
  }, [asset.itemId, onBusyChange]);

  useEffect(() => {
    if (phase !== 'done' && phase !== 'error') return;
    const t = setTimeout(() => {
      if (mountedRef.current) setPhase('idle');
    }, 3000);
    return () => clearTimeout(t);
  }, [phase]);

  const supported = isCaptureSupported();
  const disabled = !canCapture || !supported || ['finalizing', 'processing', 'uploading'].includes(phase);

  const tooltipText = !supported
    ? 'Video export isn\u2019t supported in this browser yet'
    : !canCapture
    ? 'Video export works on GLSL tiles for now \u2014 sketch support is coming'
    : phase === 'recording'
    ? 'Stop recording'
    : phase === 'processing' ? 'Processing Smooth loop'
    : phase === 'finalizing' ? 'Finalizing recording'
    : phase === 'uploading' ? 'Saving clip' : 'Start recording';

  const handleClick = async () => {
    if (disabled) return;

    if (phase === 'recording') {
      stopRequested.current = true;
      stopRef.current?.();
      return;
    }

    const renderer = getPool().get(asset.itemId);
    const canvas = renderer?.getCanvas?.();
    if (!canvas || !(canvas instanceof HTMLCanvasElement)) {
      setPhase('error');
      setMessage('Tile isn\u2019t ready to record yet');
      return;
    }

    if (busyRef.current) return;
    busyRef.current = true; stopRequested.current = false; setRecovery(null); onBusyChange(true);
    setPhase('recording');
    setElapsed(0);
    setMessage(null);

    try {
      const { result, stop, cancel } = await startCapture(canvas, { format, durationSec, loopMode, overlapMs }, (progress) => {
        if (!mountedRef.current) return;
        setElapsed(progress.elapsedSec);
        setTarget(progress.durationSec);
        if (progress.status === 'finalizing' || progress.status === 'processing') setPhase(progress.status);
        if (progress.fraction !== undefined) setProcessing(Math.round(progress.fraction * 100));
      });
      stopRef.current = stop; cancelRef.current = cancel;
      if (!mountedRef.current) cancel();
      else if (stopRequested.current) stop();

      const captured = await result;
      stopRef.current = null;
      if (!mountedRef.current) return;

      setRecovery({ blob: captured.rawBlob, format: captured.format });
      setPhase('uploading');
      const uploaded = await uploadCapturedClip(captured.blob, {
        sourceTitle: asset.title,
        format: captured.format,
        metadata: captured.metadata,
        rawBlob: captured.rawBlob !== captured.blob ? captured.rawBlob : undefined,
      });
      if (!mountedRef.current) return;

      if (!uploaded.ok || !uploaded.asset) {
        setPhase('error');
        setMessage(uploaded.error ?? 'Export failed');
        return;
      }

      useBoardStore.getState().addAsset(uploaded.asset);
      setRecovery(null);
      setPhase('done');
      setMessage(captured.warning ?? (captured.looped ? 'Smooth clip saved; untreated source retained' : 'Untreated clip saved'));
    } catch (err) {
      stopRef.current = null;
      if (!mountedRef.current) return;
      if (mountedRef.current) setPhase('error');
      if (mountedRef.current) setMessage(err instanceof Error ? err.message : 'Export failed');
    } finally {
      busyRef.current = false; cancelRef.current = null; stopRef.current = null;
      if (mountedRef.current) onBusyChange(false);
    }
  };

  // Gated exactly as the old inline span was (message only shown while
  // phase is 'done'/'error'). The 3000ms effect above that resets phase
  // back to 'idle' is doing double duty — it's the whole button's
  // cooldown, not just the message's timer — so it stays as the thing
  // that actually clears this, rather than trying to fold its job into
  // Toast's own internal timer. onDismiss just re-fires the same reset
  // in case Toast's own timer ever completes first; setPhase('idle') is
  // idempotent, so there's no ordering hazard either way.
  const shownMessage = message && (phase === 'done' || phase === 'error') ? message : null;

  return (
    <span className={s.recordGroup} data-recording={phase === 'recording' ? 'true' : undefined}>
      <Tooltip content={tooltipText}>
        <Button
          variant="ghost"
          active={phase === 'recording'}
          disabled={disabled && phase !== 'recording'}
          onClick={() => void handleClick()}
          aria-label={
            phase === 'recording'
              ? `Stop recording, ${Math.min(elapsed, target).toFixed(1)} of ${target.toFixed(1)} seconds`
              : 'Start recording'
          }
        >
          <RecordIcon recording={phase === 'recording'} />
          {variant !== 'icon' &&
            (phase === 'recording'
              ? `${Math.min(elapsed, target).toFixed(1)}s / ${target.toFixed(1)}s`
              : phase === 'uploading'
              ? 'Saving\u2026'
              : 'Record')}
        </Button>
      </Tooltip>
      {(phase === 'finalizing' || phase === 'processing' || phase === 'uploading') &&
        <span role="status" style={{ fontSize: 11 }}>{phase === 'processing' ? `Processing ${processing}%` : phase === 'finalizing' ? 'Finalizing…' : 'Saving…'}</span>}
      {phase === 'processing' && <Button variant="ghost" onClick={() => stopRef.current?.()}>Keep untreated</Button>}
      {recovery && (phase === 'error' || phase === 'idle') && <Button variant="ghost" onClick={() => downloadBlob(recovery.blob, `VML-untreated-recovery.${recovery.format}`)}>Download untreated source</Button>}
      <Toast
        message={shownMessage}
        error={phase === 'error'}
        onDismiss={() => {
          if (mountedRef.current) setPhase('idle');
        }}
      />
    </span>
  );
}
