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
      // POST-only since the seed-route lockdown (see app/api/seed/route.ts).
      // Works as-is against a local dev server; against production the
      // route additionally requires ALLOW_SEED_ROUTE + a bearer secret this
      // button deliberately has no way to send, so it will report failure
      // there — seed a live database with curl instead (see README).
      const res = await fetch('/api/seed', { method: 'POST' });
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
