'use client';

import { useEffect, useRef, useState } from 'react';
import { Button, RecordIcon, Tooltip } from '@/components/ui';
import { useBoardStore } from '@/stores';
import type { Asset } from '@/types/asset';
import { getPool } from '@/lib/render/pool';
import { startCapture } from '@/lib/capture/engine';
import { isCaptureSupported } from '@/lib/capture/support';
import { uploadCapturedClip } from '@/lib/persist/client';
import type { CaptureFormat } from '@/lib/capture/types';
import s from '../features.module.css';

type Phase = 'idle' | 'recording' | 'uploading' | 'done' | 'error';

interface RecordButtonProps {
  asset: Asset;
  /** Gated the same way canVfx is — see FocusedAssetOverlay.tsx / this
      file's own capture engine doc for why p5 sketch tiles can't record
      yet (sandboxed cross-origin canvas, not a valid capture source). */
  canCapture: boolean;
  format: CaptureFormat;
  durationSec: number;
  /** 'icon' for the header row (desktop + mobile actions bar) —
      icon-only, pulses while recording. */
  variant?: 'icon';
}

/**
 * The only control that starts or stops a recording. VCapture (see
 * CapturePanel.tsx) only ever sets format/duration — pressing it never
 * records anything. Pressing this a second time while recording stops
 * early (see engine.ts's RecordingHandle.stop doc for what that costs:
 * the clip still uploads, it just skips the seamless-loop crossfade).
 */
export function RecordButton({ asset, canCapture, format, durationSec, variant }: RecordButtonProps) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
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
      stopRef.current?.();
    };
  }, [asset.itemId]);

  useEffect(() => {
    if (phase !== 'done' && phase !== 'error') return;
    const t = setTimeout(() => {
      if (mountedRef.current) setPhase('idle');
    }, 3000);
    return () => clearTimeout(t);
  }, [phase]);

  const supported = isCaptureSupported();
  const disabled = !canCapture || !supported || phase === 'uploading';

  const tooltipText = !supported
    ? 'Video export isn\u2019t supported in this browser yet'
    : !canCapture
    ? 'Video export works on GLSL tiles for now \u2014 sketch support is coming'
    : phase === 'recording'
    ? 'Stop recording'
    : 'Start recording';

  const handleClick = async () => {
    if (disabled) return;

    if (phase === 'recording') {
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

    setPhase('recording');
    setElapsed(0);
    setMessage(null);

    try {
      const { result, stop } = await startCapture(canvas, { format, durationSec }, (progress) => {
        if (!mountedRef.current) return;
        setElapsed(progress.elapsedSec);
        if (progress.status === 'finalizing') setPhase('uploading');
      });
      stopRef.current = stop;

      const captured = await result;
      stopRef.current = null;
      if (!mountedRef.current) return;

      setPhase('uploading');
      const uploaded = await uploadCapturedClip(captured.blob, {
        sourceTitle: asset.title,
        format: captured.format,
      });
      if (!mountedRef.current) return;

      if (!uploaded.ok || !uploaded.asset) {
        setPhase('error');
        setMessage(uploaded.error ?? 'Export failed');
        return;
      }

      useBoardStore.getState().addAsset(uploaded.asset);
      setPhase('done');
      setMessage(captured.looped ? 'Clip saved' : 'Clip saved (stopped early \u2014 no loop)');
    } catch (err) {
      stopRef.current = null;
      if (!mountedRef.current) return;
      setPhase('error');
      setMessage(err instanceof Error ? err.message : 'Export failed');
    }
  };

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
              ? `Stop recording, ${Math.min(Math.ceil(elapsed), durationSec)} of ${durationSec} seconds`
              : 'Start recording'
          }
        >
          <RecordIcon recording={phase === 'recording'} />
          {variant !== 'icon' &&
            (phase === 'recording'
              ? `${Math.min(Math.ceil(elapsed), durationSec)}s / ${durationSec}s`
              : phase === 'uploading'
              ? 'Saving\u2026'
              : 'Record')}
        </Button>
      </Tooltip>
      {message && (phase === 'done' || phase === 'error') && (
        <span className={s.savedNote} data-error={phase === 'error' ? 'true' : undefined}>
          {message}
        </span>
      )}
    </span>
  );
}
