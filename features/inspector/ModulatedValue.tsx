'use client';

import { useEffect, useRef } from 'react';
import { getPool } from '@/lib/render/pool';
import { decimalsOf } from '@/components/ui';
import s from '../features.module.css';

interface ModulatedValueProps {
  cardId: string | null;
  controlId: string;
  step: number;
  unit?: string;
}

/**
 * A parameter's value, breathing in real time while it is modulated.
 *
 * Writes `textContent` on a ref inside its own animation frame rather than
 * calling setState. At 60fps a React state update per readout would rerender
 * the whole inspector sixty times a second for what is, visually, a few
 * characters changing — and with several modulated controls open at once
 * that cost multiplies. Touching the text node directly keeps it free.
 *
 * The design brief called this out specifically: a value visibly moving is
 * the one moment of motion in an otherwise completely still interface, so it
 * is worth doing properly rather than approximating with a static label.
 */
export function ModulatedValue({ cardId, controlId, step, unit }: ModulatedValueProps) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!cardId) return;
    let raf = 0;
    const decimals = Math.min(decimalsOf(step), 4);

    const tick = () => {
      raf = requestAnimationFrame(tick);
      const node = ref.current;
      if (!node) return;

      const value = getPool().sampleModulated(cardId, controlId);
      if (value === null) return;

      node.textContent = `${value.toFixed(decimals)}${unit ? ` ${unit}` : ''}`;
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [cardId, controlId, step, unit]);

  return <span ref={ref} className={s.modulatedValue} />;
}
