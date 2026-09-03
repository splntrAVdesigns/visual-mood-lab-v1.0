'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui';

/**
 * This is `app/error.tsx` — the ROOT error boundary. In the Next.js App
 * Router, an error.tsx at this level catches an uncaught error from ANY
 * route in the app, not just its sibling page.tsx. It was previously named
 * `BoardError` with hardcoded "The board failed to load" copy, written
 * with only the board page in mind — which became actively misleading the
 * first time a completely unrelated failure (a Server Action throwing on
 * /reset-password) got caught by this same boundary and showed the exact
 * same "board failed to load" message despite having nothing to do with
 * the board. Kept scope-neutral now on purpose: this card can legitimately
 * be the last line of defense for a failure anywhere in the app.
 */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[app]', error);
  }, [error]);

  return (
    <main
      style={{
        display: 'grid',
        placeItems: 'center',
        minHeight: '100dvh',
        padding: 'var(--space-5)',
        textAlign: 'center',
        gap: 'var(--space-4)',
      }}
    >
      <div style={{ display: 'grid', gap: 'var(--space-3)', justifyItems: 'center' }}>
        <h1 style={{ fontSize: 'var(--step-2)', fontWeight: 500 }}>Something went wrong</h1>
        <p style={{ color: 'var(--text-mute)', fontSize: 'var(--step--1)', maxWidth: '40ch' }}>
          {process.env.NODE_ENV === 'development'
            ? error.message || 'An unexpected error occurred.'
            : "That's on us — the error's been logged. Try again, or come back in a moment."}
        </p>
        <Button variant="accent" onClick={reset}>
          Try again
        </Button>
      </div>
    </main>
  );
}
