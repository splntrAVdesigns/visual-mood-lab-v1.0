'use client';

import { useEffect, useRef, useState } from 'react';
import { getMeterLevel, isMeterActive } from '@/lib/sound/meter';
import { hasTrack, getTrackLevel } from '@/lib/sound/track';
import { isMicEnabled, getMicLevel } from '@/lib/sound/mic';
import s from '../features.module.css';

/** CSS hides dots 6–7 under the mobile breakpoint, leaving 5 visible —
    same breakpoint the sidecar layout already uses, kept in one place
    (features.module.css) rather than duplicated as a JS viewport check. */
const DOT_COUNT = 7;

interface SoundMeterProps {
  itemId: string;
}

/**
 * Live level dots for whichever audio source is actually active on this
 * card. Track > Mic > synth preset priority, same order used everywhere
 * else audio sources are resolved (lib/render/pool.ts's ctx.audio,
 * renderers/p5.renderer.ts's audioWaveform bridge) — an explicitly
 * loaded track is the most deliberate choice, Mic is "react to whatever's
 * happening right now," and the synth preset is the ambient default. In
 * practice Track and the synth preset shouldn't both be active (see
 * SoundPanel.tsx's mutual-exclusivity doc) and Mic never competes with
 * either (see lib/sound/mic.ts's top doc), but the meter checks all three
 * independently rather than trusting those invariants hold everywhere.
 *
 * isMicEnabled(itemId) gates getMicLevel() specifically because the
 * underlying stream is shared app-wide (see lib/sound/mic.ts) — without
 * that check, every card's meter would start pulsing to Mic the instant
 * ANY card enabled it, not just the one that actually turned it on.
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
        : isMicEnabled(itemId)
          ? getMicLevel()
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
