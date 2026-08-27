'use client';

import { useEffect, useState } from 'react';
import { Field, TextInput } from '@/components/ui';
import type { TextControl as TextControlType, ParamValue } from '@/renderers/control-schema';

interface Props {
  control: TextControlType;
  value: ParamValue;
  dirty: boolean;
  onChange: (v: ParamValue) => void;
  onReset: () => void;
}

/**
 * BUGFIX (post-Part-1 testing, Glyph Swarm): this used to be a fully
 * controlled input wired straight to `onChange` — every keystroke
 * committed immediately, all the way through `setParam` into whatever a
 * live renderer's `get(id)` returns. Harmless for most text params, but
 * wrong for anything that rebuilds off a full word (Glyph Swarm's mask):
 * a sketch can only poll `get('text')` once a frame, and polling alone
 * gives it no way to distinguish "still mid-keystroke" from "the person
 * just committed this word" — that distinction can only be created here,
 * at the one place that actually sees native input/blur/keydown events.
 * A sketch-level debounce (tried first) can only ever approximate a
 * commit by guessing how long a pause means "done typing"; this makes it
 * exact instead of guessed, per direct instruction: commit on blur or
 * Enter, nothing else.
 *
 * `draft` carries every keystroke for what's actually DISPLAYED in the
 * input — typing still feels normal, nothing about the typing experience
 * itself changed. `onChange` (-> setParam -> the persisted value -> what
 * a sketch's `get()` returns) only fires on blur or Enter. Scoped to text
 * controls specifically; sliders/steppers/etc. are untouched and
 * correctly keep committing live — that's the right behavior for a drag.
 */
export function TextControlRow({ control, value, dirty, onChange, onReset }: Props) {
  const committed = typeof value === 'string' ? value : control.default;
  const [draft, setDraft] = useState(committed);

  // Follows the committed value when it changes from OUTSIDE this input —
  // Restore, or a different card's saved word loading in — otherwise
  // `draft` would keep showing stale local text after an external reset.
  useEffect(() => {
    setDraft(committed);
  }, [committed]);

  const commit = () => {
    if (draft !== committed) onChange(draft);
  };

  return (
    <Field label={control.label} hint={control.hint} dirty={dirty} onReset={onReset}>
      <TextInput
        label={control.label}
        mono={control.monospace}
        value={draft}
        maxLength={control.maxLength}
        onChange={setDraft}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
    </Field>
  );
}
