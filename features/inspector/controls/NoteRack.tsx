'use client';

import { MAX_SELECTED_NOTES, ROOT_NOTES } from '@/lib/sound/types';
import s from '../../features.module.css';

interface NoteRackProps {
  /** Currently selected roots, 0-3 of them. Empty means this tile is
      muted — see onChange. */
  value: string[];
  onChange: (notes: string[]) => void;
  disabled?: boolean;
}

/**
 * The note selector: all 12 chromatic roots as one flush button strip,
 * two rows of six. Replaced the single-value Key dropdown, because the
 * selection became a set (up to MAX_SELECTED_NOTES) rather than a scalar
 * — and because a set of musical notes is exactly the case where seeing
 * every option at once beats opening a list to find one.
 *
 * Lives in features/ rather than components/ui/ on purpose: it knows what
 * a chromatic root note is, which is domain knowledge, and the rule is
 * that the moment a shared component knows that, it belongs to the
 * feature that owns it.
 *
 * Two invariants, both enforced here rather than left to the caller:
 *
 *  - Never more than MAX_SELECTED_NOTES selected. Past the cap, the
 *    UNSELECTED buttons go genuinely `disabled` — a real attribute, not
 *    just an inert click handler, so keyboard and screen-reader users get
 *    correct behaviour without a second implementation. Silently swapping
 *    out the oldest selection instead would be the surprising option: the
 *    user taps a note and a different one they didn't touch disappears.
 *
 *  - Zero selected is valid, and means "mute this tile" — deselecting the
 *    last note is allowed rather than refused. This is deliberately
 *    DIFFERENT from the Sound toggle at the top of the panel: that turns
 *    the whole audio subsystem for this card off and keeps no state about
 *    what would have played; an empty note selection keeps the preset,
 *    scale, octave, and volume exactly as they were and produces silence
 *    at the engine level (see normalizeSoundState and each engine's own
 *    handling of an empty notes array) purely because there's nothing to
 *    build a chord, an arp pool, or a transposition target FROM. Re-
 *    selecting a note resumes immediately with everything else untouched
 *    — a quick mute/unmute for "what does this sound like right now"
 *    without losing your place.
 */
export function NoteRack({ value, onChange, disabled = false }: NoteRackProps) {
  const atCap = value.length >= MAX_SELECTED_NOTES;

  const toggle = (note: string) => {
    if (value.includes(note)) {
      onChange(value.filter((n) => n !== note));
      return;
    }
    if (atCap) return;
    // Preserve chromatic order rather than selection order, so the same
    // set of notes always renders and reads back identically regardless
    // of the order the user happened to tap them in.
    onChange(ROOT_NOTES.filter((n) => n === note || value.includes(n)));
  };

  return (
    <div
      className={s.noteRack}
      role="group"
      aria-label={`Root notes, up to ${MAX_SELECTED_NOTES}`}
      data-disabled={disabled ? 'true' : undefined}
    >
      {ROOT_NOTES.map((note) => {
        const selected = value.includes(note);
        // Only unselected buttons lock at the cap: a selected one must stay
        // pressable so the user can free a slot without first hunting for
        // some other way out.
        const locked = disabled || (!selected && atCap);
        return (
          <button
            key={note}
            type="button"
            className={s.noteRackKey}
            aria-pressed={selected}
            aria-label={note}
            disabled={locked}
            data-selected={selected ? 'true' : undefined}
            onClick={() => toggle(note)}
          >
            {note}
          </button>
        );
      })}
    </div>
  );
}
