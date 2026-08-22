'use client';

import { useEffect, useRef, useState } from 'react';
import { getMeterLevel, isMeterActive } from '@/lib/sound/meter';
import { hasTrack, getTrackLevel } from '@/lib/sound/track';
import s from '../features.module.css';

/** CSS hides dots 5–7 under the mobile breakpoint, leaving 4 visible —
    same breakpoint the sidecar layout already uses, kept in one place
    (features.module.css) rather than duplicated as a JS viewport check. */
const DOT_COUNT = 7;

interface SoundMeterProps {
  itemId: string;
}

/**
 * Live level dots for whichever audio source is actually active on this
 * card. Phase 4.9.1: an uploaded track takes priority over the synth
 * engine when both could apply — same priority order p5.renderer.ts and
 * lib/render/pool.ts's ctx.audio resolution already use, kept consistent
 * here rather than inventing a fourth variant of the same rule. In
 * practice this shouldn't matter post-4.9.1 (Track and the synth preset
 * are mutually exclusive — see SoundPanel.tsx), but the meter checks both
 * independently rather than trusting that invariant holds everywhere.
 */
export function SoundMeter({ itemId }: SoundMeterProps) {
  const [level, setLevel] = useState(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      const next = hasTrack(itemId)
        ? getTrackLevel(itemId)
        : isMeterActive(itemId)
          ? getMeterLevel(itemId)
          : 0;
      setLevel(next);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [itemId]);

  const litCount = Math.round(level * DOT_COUNT);

  return (
    <span className={s.soundMeter} aria-hidden="true">
      {Array.from({ length: DOT_COUNT }).map((_, i) => (
        <span key={i} className={s.soundMeterDot} data-lit={i < litCount ? 'true' : undefined} />
      ))}
    </span>
  );
}
