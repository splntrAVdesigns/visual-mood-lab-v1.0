'use client';
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { Asset } from '@/types/asset';
import { clampTrim, isVideoCapture, trimTime, type CaptureTrim } from '@/lib/capture/trim';
import { previewCaptureTrim, saveCaptureTrim } from '@/lib/capture/persist-trim';
import s from './CaptureTrimControl.module.css';

export function CaptureTrimControl({ asset }: { asset: Asset }) {
  if (!isVideoCapture(asset)) return null;
  return <TrimEditor key={asset.itemId} asset={asset} />;
}

function TrimEditor({ asset }: { asset: Asset }) {
  const [duration, setDuration] = useState(asset.capture?.durationSec ?? asset.captureTrim?.sourceDurationSec ?? (asset.durationMs ? asset.durationMs / 1000 : 0));
  const [localRange, setRange] = useState<CaptureTrim | null>(asset.captureTrim ?? null);
  const [editing, setEditing] = useState(false);
  const range = editing ? localRange : asset.captureTrim ?? null;
  const [status, setStatus] = useState('');
  const [active, setActive] = useState<'start' | 'end' | null>(null);
  const track = useRef<HTMLDivElement>(null);
  const draft = useRef(range);
  const dirty = useRef(false);
  const sequence = useRef(0);
  const mounted = useRef(true);
  const writable = asset.isOwned !== false;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      // Finish an interrupted drag when the inspector closes or switches tiles.
      if (dirty.current) void saveCaptureTrim(asset.id, draft.current).catch(() => {});
    };
  }, [asset.id]);

  useEffect(() => {
    if (duration || !asset.srcUrl) return;
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      if (Number.isFinite(video.duration) && video.duration > 0 && video.duration <= 3600) setDuration(video.duration);
      else setStatus('Clip duration unavailable.');
    };
    video.onerror = () => setStatus('Clip duration unavailable.');
    video.src = asset.srcUrl;
    return () => { video.onloadedmetadata = null; video.onerror = null; video.removeAttribute('src'); video.load(); };
  }, [duration, asset.srcUrl]);

  const current = range ?? { startSec: 0, endSec: duration, sourceDurationSec: duration };
  const gap = Math.min(0.1, duration);
  function change(edge: 'start' | 'end', value: number) {
    const before = (editing ? draft.current : asset.captureTrim) ?? { startSec: 0, endSec: duration, sourceDurationSec: duration };
    const next = clampTrim(edge === 'start' ? Math.min(value, before.endSec - gap) : before.startSec,
      edge === 'end' ? Math.max(value, before.startSec + gap) : before.endSec, duration);
    draft.current = next; dirty.current = true;
    setRange(next); setEditing(true); setStatus('Unsaved');
    previewCaptureTrim(asset.id, next);
  }
  function commit() {
    if (!dirty.current) return;
    dirty.current = false;
    const ticket = ++sequence.current;
    const next = draft.current;
    setStatus('Saving…');
    void saveCaptureTrim(asset.id, next).then(() => {
      if (mounted.current && ticket === sequence.current && !dirty.current) { setEditing(false); setStatus('Saved'); }
    }).catch(() => {
      if (mounted.current && ticket === sequence.current) { dirty.current = true; setStatus('Save failed — retry'); }
    });
  }
  function pointerValue(event: PointerEvent) {
    const rect = track.current!.getBoundingClientRect();
    return Math.round(Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * duration * 100) / 100;
  }
  function key(event: KeyboardEvent, edge: 'start' | 'end') {
    const value = edge === 'start' ? current.startSec : current.endSec;
    const step = event.shiftKey ? 0.1 : 0.01;
    let next: number;
    switch (event.key) {
      case 'ArrowLeft': case 'ArrowDown': next = value - step; break;
      case 'ArrowRight': case 'ArrowUp': next = value + step; break;
      case 'Home': next = edge === 'start' ? 0 : current.startSec + gap; break;
      case 'End': next = edge === 'end' ? duration : current.endSec - gap; break;
      default: return;
    }
    event.preventDefault(); change(edge, next); commit();
  }
  return <section className={s.root} aria-label="Capture trim">
    <div className={s.header}><span>Trim</span><button type="button" disabled={!range || !writable} onClick={() => {
      draft.current = null; dirty.current = true; setRange(null); setEditing(true); previewCaptureTrim(asset.id, null); commit();
    }}>Reset</button></div>
    <div className={s.track} ref={track}>
      <div className={s.selected} style={{ left: `${duration ? current.startSec / duration * 100 : 0}%`, width: `${duration ? (current.endSec - current.startSec) / duration * 100 : 100}%` }} />
      {(['start', 'end'] as const).map(edge => {
        const value = edge === 'start' ? current.startSec : current.endSec;
        return <button key={edge} type="button" role="slider" className={s.handle}
          disabled={!duration || !writable} aria-label={`Trim ${edge}`} aria-valuemin={edge === 'start' ? 0 : current.startSec + gap}
          aria-valuemax={edge === 'end' ? duration : current.endSec - gap} aria-valuenow={value} aria-valuetext={trimTime(value)}
          style={{ left: `${duration ? value / duration * 100 : edge === 'start' ? 0 : 100}%`, zIndex: active === edge ? 2 : 1 }}
          onKeyDown={event => key(event, edge)} onBlur={commit}
          onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); setActive(edge); }}
          onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) change(edge, pointerValue(event)); }}
          onPointerUp={event => { event.currentTarget.releasePointerCapture(event.pointerId); setActive(null); commit(); }}
          onPointerCancel={() => { setActive(null); commit(); }}><span /></button>;
      })}
    </div>
    <div className={s.times}><span>{trimTime(current.startSec)}</span><span className={s.end}>{trimTime(current.endSec)}</span><span>{trimTime(duration)} total</span></div>
    <div className={s.summary}><span>{trimTime(current.endSec - current.startSec)} selected</span><span role="status">{status}</span></div>
    {status.startsWith('Save failed') && <button className={s.retry} type="button" onClick={commit}>Retry save</button>}
    <p className={s.note}>Preview trim. Downloads use the full original clip until trimmed export is added.</p>
    {range && asset.capture?.loopMode === 'smooth' && <p className={s.note}>A shortened range changes the Smooth join and may show a cut when looping.</p>}
    {!writable && <p className={s.note}>Only the capture owner can edit this range.</p>}
  </section>;
}
