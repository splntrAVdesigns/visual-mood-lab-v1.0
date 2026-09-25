'use client';

import { useRef, useState, useSyncExternalStore } from 'react';
import { Button, Field } from '@/components/ui';
import type { FileControl as FileControlType, ParamValue } from '@/renderers/control-schema';
import { uploadShapeFile } from '@/lib/shape-source/upload';
import { getResolvedShapeKey, getShapeError, getShapeStatus, subscribeShapeStatus, type ShapeKey, type ShapeSpec } from '@/lib/shape-source';
import { useInspectorStore } from '@/stores';
import s from '../../features.module.css';

interface Props {
  control: FileControlType;
  value: ParamValue;
  dirty: boolean;
  onChange: (value: ParamValue) => void;
  onReset: () => void;
}

/** "abc123.svg" from a storage URL — enough to recognise what is loaded. */
function fileLabel(url: string): string {
  try {
    const last = new URL(url, 'https://x').pathname.split('/').pop() ?? url;
    return decodeURIComponent(last);
  } catch {
    return url;
  }
}

/**
 * Upload a file into THIS tile (Shapeshift's shape upload). Picks, uploads,
 * then stores the resulting URL as the control's value — the renderer loads
 * it from there. Visual language matches TextureControlRow on purpose.
 */
export function FileControlRow({ control, value, dirty, onChange, onReset }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const url = typeof value === 'string' && value ? value : null;
  const key = useInspectorStore((st) => st.params.shapeKey);
  const threshold = useInspectorStore((st) => st.params.shapeThreshold);
  const invert = useInspectorStore((st) => st.params.shapeKeyInvert);
  const spec: ShapeSpec | null = url ? {
    kind: 'file',
    url,
    key: key === 'alpha' || key === 'luma' ? key as ShapeKey : 'auto',
    threshold: typeof threshold === 'number' ? threshold : 0.5,
    invert: invert === true,
  } : null;
  const status = useSyncExternalStore(
    subscribeShapeStatus,
    () => spec ? getShapeStatus(spec) : 'idle',
    () => 'idle',
  );

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    const res = await uploadShapeFile(file);
    setBusy(false);
    if (res.ok) onChange(res.url);
    else setError(res.error);
    if (input.current) input.current.value = '';
  };

  return (
    <Field label={control.label} hint={control.hint} dirty={dirty} onReset={onReset} value={url ? 'loaded' : 'none'}>
      <div className={s.texturePicker}>
        <button
          type="button"
          className={s.textureTrigger}
          onClick={() => input.current?.click()}
          disabled={busy || control.disabled}
        >
          <span className={s.textureLabel}>{busy ? 'Uploading…' : url ? fileLabel(url) : 'Choose file…'}</span>
        </button>
        {url && !busy && (
          <Button variant="ghost" onClick={() => onChange(null)}>
            Clear
          </Button>
        )}
        <input
          ref={input}
          type="file"
          accept={(control.accept ?? []).join(',')}
          hidden
          onChange={(e) => void pick(e.target.files?.[0])}
        />
      </div>
      {error && <p className={s.textureEmpty} role="alert">{error}</p>}
      {status === 'ready' && key === 'auto' && spec && (
        <p className={s.textureEmpty} role="status">Auto chose {getResolvedShapeKey(spec) === 'alpha' ? 'Alpha (transparency)' : 'Luminance (brightness)'}.</p>
      )}
      {status === 'empty' && <p className={s.textureEmpty} role="status">No pixels match this key and threshold. Adjust Threshold or switch Key.</p>}
      {status === 'failed' && spec && <p className={s.textureEmpty} role="alert">{getShapeError(spec) ?? 'Could not read this shape.'}</p>}
    </Field>
  );
}
