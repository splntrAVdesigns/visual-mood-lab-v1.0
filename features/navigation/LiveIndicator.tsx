'use client';

import { useEffect, useState } from 'react';
import { getPool } from '@/lib/render/pool';
import { MAX_LIVE_RENDERERS } from '@/stores/playbackStore';
import s from '../features.module.css';

/**
 * Shows how many cards are currently animating against the budget cap.
 *
 * Polled rather than wired through a store: the pool already exposes
 * `liveCount` as a plain getter, and a 500ms interval is cheap enough that
 * adding a reactive subscription just to avoid one setInterval isn't worth
 * the extra moving part.
 */
export function LiveIndicator() {
  const [live, setLive] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setLive(getPool().liveCount), 500);
    return () => clearInterval(id);
  }, []);

  if (live === 0) return null;

  return (
    <span className={s.liveIndicator} title={`${live} of ${MAX_LIVE_RENDERERS} live renderers active`}>
      <span className={s.liveDot} />
      {live}/{MAX_LIVE_RENDERERS}
    </span>
  );
}
