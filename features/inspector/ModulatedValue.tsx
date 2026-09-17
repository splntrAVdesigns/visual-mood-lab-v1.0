'use client';

import { useEffect, useRef } from 'react';
import { decimalsOf } from '@/components/ui';
import { sampleLiveEffectValue, sampleLiveParameterValue } from '@/lib/control-surface';
import s from '../features.module.css';

interface ModulatedValueProps {
  cardId: string | null;
  controlId: string;
  step: number;
  unit?: string;
  fallback?: number;
  effectInstanceId?: string;
}

/**
 * Live numeric readout for both classic modulation and controller runtime
 * values. Uses direct text-node writes so MIDI/gamepad CC traffic does not
 * rerender the Inspector at hardware rate.
 */
export function ModulatedValue({
  cardId,
  controlId,
  step,
  unit,
  fallback,
  effectInstanceId,
}: ModulatedValueProps) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let raf = 0;
    const decimals = Math.min(decimalsOf(step), 4);

    const tick = () => {
      raf = requestAnimationFrame(tick);
      const node = ref.current;
      if (!node) return;

      const value = effectInstanceId
        ? sampleLiveEffectValue(cardId, effectInstanceId, controlId)
        : sampleLiveParameterValue(cardId, controlId);
      const visible = value ?? fallback;
      if (visible === undefined || !Number.isFinite(visible)) return;
      node.textContent = `${visible.toFixed(decimals)}${unit ? ` ${unit}` : ''}`;
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [cardId, controlId, step, unit, fallback, effectInstanceId]);

  return <span ref={ref} className={s.modulatedValue} />;
}
