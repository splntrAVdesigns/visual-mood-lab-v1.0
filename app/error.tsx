'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui';

export default function BoardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[board]', error);
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
        <h1 style={{ fontSize: 'var(--step-2)', fontWeight: 500 }}>The board failed to load</h1>
        <p style={{ color: 'var(--text-mute)', fontSize: 'var(--step--1)', maxWidth: '40ch' }}>
          {error.message || 'An unexpected error occurred while rendering the board.'}
        </p>
        <Button variant="accent" onClick={reset}>
          Try again
        </Button>
      </div>
    </main>
  );
}
