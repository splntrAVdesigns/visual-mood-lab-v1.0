'use client';

import { useEffect } from 'react';
import s from './ui.module.css';

interface ToastProps {
  /** null/undefined renders nothing — caller owns clearing its own state
      after dismissal, same pattern RecordButton already used for its
      inline message before this replaced it. */
  message: string | null | undefined;
  error?: boolean;
  onDismiss: () => void;
  durationMs?: number;
}

/**
 * A single transient status message, fixed to the bottom-center of the
 * viewport. Exists specifically to replace inline "Clip saved"-style
 * messages that were rendered as a sibling next to the button that
 * triggered them (see RecordButton.tsx) — an inline message reflows
 * whatever row it lives in, which on the mobile focused view's already-
 * tight header row was the actual mechanism behind a reported spacing
 * bug. Fixed positioning means this can never affect any other element's
 * layout, regardless of where it's triggered from.
 *
 * No shadow, border only — matches tokens.css's stated palette
 * discipline ("No shadows... a hairline reads better than any glow").
 * No portal: every other overlay in this file set (Dialog, Tooltip)
 * renders directly with position:fixed/absolute rather than through a
 * portal, so this matches that existing convention rather than
 * introducing a new one.
 */
export function Toast({ message, error, onDismiss, durationMs = 3000 }: ToastProps) {
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(onDismiss, durationMs);
    return () => clearTimeout(t);
  }, [message, durationMs, onDismiss]);

  if (!message) return null;

  return (
    <div className={s.toastWrap}>
      <div className={s.toast} role="status" aria-live="polite" data-error={error ? 'true' : undefined}>
        {message}
      </div>
    </div>
  );
}
