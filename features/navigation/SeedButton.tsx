'use client';

import { useState } from 'react';
import { Button, Tooltip } from '@/components/ui';
import s from '../features.module.css';

/**
 * Appears in the header only when the board failed to load or has nothing
 * in it — the two situations that both mean "this install hasn't been
 * seeded yet." One click, no terminal, no URL to remember.
 */
export function SeedButton() {
  const [state, setState] = useState<'idle' | 'working' | 'error'>('idle');

  const seed = async () => {
    setState('working');
    try {
      const res = await fetch('/api/seed');
      if (!res.ok) throw new Error(await res.text());
      window.location.reload();
    } catch {
      setState('error');
    }
  };

  return (
    <Tooltip
      content={
        state === 'error'
          ? 'Failed — check the terminal running npm run dev'
          : 'Load the 30-asset starter library'
      }
    >
      <Button
        variant="accent"
        onClick={seed}
        disabled={state === 'working'}
        className={s.seedButton}
      >
        {state === 'working' ? 'Seeding…' : state === 'error' ? 'Retry seed' : 'Seed database'}
      </Button>
    </Tooltip>
  );
}
