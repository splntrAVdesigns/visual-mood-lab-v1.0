'use client';

import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Button, Field } from '@/components/ui';
import { useBoardStore, useInspectorStore } from '@/stores';
import type { TextureControl as TextureControlType, ParamValue } from '@/renderers/control-schema';
import type { Asset } from '@/types/asset';
import s from '../../features.module.css';

interface Props {
  control: TextureControlType;
  value: ParamValue;
  dirty: boolean;
  onChange: (value: ParamValue) => void;
  onReset: () => void;
}

/**
 * Links another board asset as a texture source.
 *
 * What gets sampled is the chosen asset's POSTER — a real, already-captured
 * frame of it — not its live output. Sampling a live asset would need a
 * second render pass per frame plus dependency ordering between renderers
 * (what happens when two shaders sample each other?), which is a genuine
 * architecture change rather than a control. A poster is enough to make
 * source-driven shaders like ASCII Mosaic and Chromatic Glitch do what they
 * were written to do, which is the actual point of this control.
 *
 * Self-reference is filtered out for the same reason: a shader sampling its
 * own poster while generating that poster is a loop with no defined answer.
 * Feedback Trails already covers the "sample my own previous frame" case
 * properly, through the backbuffer.
 */
function selectSourceCandidates(state: { assets: Asset[] }): Asset[] {
  return state.assets.filter((a) => Boolean(a.posterUrl));
}

export function TextureControlRow({ control, value, dirty, onChange, onReset }: Props) {
  const [open, setOpen] = useState(false);
  const candidates = useBoardStore(useShallow(selectSourceCandidates));
  const currentItemId = useInspectorStore((st) => st.itemId);

  const linkedId = typeof value === 'string' ? value : null;
  const linked = linkedId ? candidates.find((a) => a.id === linkedId) : undefined;

  // Exclude the asset being edited: sampling your own poster while
  // generating it has no defined result.
  const options = candidates.filter((a) => a.itemId !== currentItemId);

  return (
    <Field
      label={control.label}
      hint={control.hint}
      dirty={dirty}
      onReset={onReset}
      value={linked ? linked.title : 'none'}
    >
      <div className={s.texturePicker}>
        <button
          type="button"
          className={s.textureTrigger}
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          {linked?.posterUrl ? (
            <img className={s.textureThumb} src={linked.posterUrl} alt="" />
          ) : (
            <span className={s.textureThumbEmpty}>—</span>
          )}
          <span className={s.textureLabel}>{linked ? linked.title : 'Choose source…'}</span>
        </button>

        {linkedId && (
          <Button variant="ghost" onClick={() => onChange(null)}>
            Clear
          </Button>
        )}
      </div>

      {open && (
        <div className={s.textureGrid}>
          {options.length === 0 && (
            <p className={s.textureEmpty}>No other assets with a captured poster yet.</p>
          )}
          {options.map((a) => (
            <button
              key={a.itemId}
              type="button"
              className={s.textureOption}
              data-active={a.id === linkedId ? 'true' : undefined}
              title={a.title}
              onClick={() => {
                onChange(a.id);
                setOpen(false);
              }}
            >
              <img className={s.textureOptionImg} src={a.posterUrl} alt="" loading="lazy" />
              <span className={s.textureOptionName}>{a.title}</span>
            </button>
          ))}
        </div>
      )}
    </Field>
  );
}
