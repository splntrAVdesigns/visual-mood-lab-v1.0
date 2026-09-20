'use client';

import { useSyncExternalStore } from 'react';
import { Button } from '@/components/ui';
import {
  getPersistStatus,
  getServerPersistStatus,
  retryFailedPersist,
  subscribePersistStatus,
} from '@/lib/persist/client';
import s from './saveStatus.module.css';

/**
 * Shown ONLY while a save has failed — nothing renders in the normal case.
 *
 * Before this, a failed save left one trace: a console.error. The person kept
 * editing, believing it was saved, and found out on their next visit.
 *
 * Why this isn't the shared <Toast>: Toast auto-dismisses after a few seconds
 * and is pointer-events:none, which is right for "Clip saved" and wrong for
 * "your changes are NOT saved" — that has to stay until it's resolved, and it
 * needs a Retry the person can actually click. Same tokens, same hairline
 * look, different lifetime. (Placed top-center, under the header, so it can
 * never collide with a Toast at bottom-center.)
 */
export function SaveStatus() {
  const { failed, sessionExpired } = useSyncExternalStore(
    subscribePersistStatus,
    getPersistStatus,
    getServerPersistStatus,
  );

  if (failed === 0) return null;

  const message = sessionExpired
    ? 'Session expired — sign in to keep saving'
    : failed === 1
      ? 'Change not saved'
      : `${failed} changes not saved`;

  return (
    <div className={s.wrap}>
      <div className={s.pill} role="status" aria-live="polite">
        <span>{message}</span>
        {sessionExpired && (
          // A new tab, so signing in doesn't discard the page holding the
          // unsaved changes — Retry then resends them under the new session.
          <a className={s.link} href="/login" target="_blank" rel="noopener noreferrer">
            Sign in
          </a>
        )}
        <Button variant="outline" className={s.retry} onClick={() => retryFailedPersist()}>
          Retry
        </Button>
      </div>
    </div>
  );
}
