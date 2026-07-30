'use client';

import { useCallback, useId, useRef, type PointerEvent, type KeyboardEvent } from 'react';
import s from './ui.module.css';

interface SliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  scale?: 'linear' | 'log';
  disabled?: boolean;
  /** Draws the dashed fill indicating a live modulation source. */
  modulated?: boolean;
  label: string;
  onChange: (value: number) => void;
  /** Fired once on pointer release / keyboard commit — use to persist. */
  onCommit?: (value: number) => void;
}

/**
 * Custom slider rather than <input type="range">.
 *
 * Native range inputs cannot be styled to a 2px track with a 12px thumb
 * consistently across engines, and we need log scaling plus a modulation
 * state the native element has no concept of. The tradeoff is that keyboard
 * and ARIA behaviour has to be implemented by hand — done below, matching the
 * WAI-ARIA slider pattern.
 */
export function Slider({
  value,
  min,
  max,
  step = 0.01,
  scale = 'linear',
  disabled,
  modulated,
  label,
  onChange,
  onCommit,
}: SliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const id = useId();

  const norm = toNorm(value, min, max, scale);

  const valueFromPointer = useCallback(
    (clientX: number): number => {
      const el = trackRef.current;
      if (!el) return value;
      const rect = el.getBoundingClientRect();
      const t = clamp01((clientX - rect.left) / Math.max(rect.width, 1));
      return quantise(fromNorm(t, min, max, scale), min, max, step);
    },
    [min, max, scale, step, value],
  );

  const handlePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    // Only the primary (left) button drags the slider. Without this check,
    // a right-click meant to open the modulation context menu also jumped
    // the value to the click position and captured the pointer — which in
    // turn could suppress the browser's own contextmenu dispatch. Right and
    // middle clicks now pass through untouched.
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.focus();
    onChange(valueFromPointer(e.clientX));
  };

  const handlePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
    onChange(valueFromPointer(e.clientX));
  };

  const handlePointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    onCommit?.(valueFromPointer(e.clientX));
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;

    const coarse = (max - min) / 10;
    const fine = step;
    const nudge = e.shiftKey ? coarse : fine;

    let next: number | null = null;
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowUp':
        next = value + nudge;
        break;
      case 'ArrowLeft':
      case 'ArrowDown':
        next = value - nudge;
        break;
      case 'PageUp':
        next = value + coarse;
        break;
      case 'PageDown':
        next = value - coarse;
        break;
      case 'Home':
        next = min;
        break;
      case 'End':
        next = max;
        break;
      default:
        return;
    }

    e.preventDefault();
    const committed = quantise(next, min, max, step);
    onChange(committed);
    onCommit?.(committed);
  };

  return (
    <div
      ref={trackRef}
      id={id}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={formatValue(value, step)}
      aria-disabled={disabled || undefined}
      data-modulated={modulated ? 'true' : undefined}
      className={s.slider}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onKeyDown={handleKeyDown}
    >
      <div className={s.sliderTrack} />
      <div className={s.sliderFill} style={{ width: `${norm * 100}%` }} />
      <div className={s.sliderThumb} style={{ left: `${norm * 100}%` }} />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Scale mapping
 * ------------------------------------------------------------------ */

/**
 * Log scaling needs a strictly positive domain. When a range crosses or
 * touches zero we fall back to linear rather than producing NaN — a shader
 * author writing @log on a -1..1 uniform gets a working slider, not a
 * broken one.
 */
function logSafe(min: number, max: number): boolean {
  return min > 0 && max > 0;
}

function toNorm(v: number, min: number, max: number, scale: 'linear' | 'log'): number {
  if (max === min) return 0;
  if (scale === 'log' && logSafe(min, max)) {
    return clamp01((Math.log(clamp(v, min, max)) - Math.log(min)) / (Math.log(max) - Math.log(min)));
  }
  return clamp01((v - min) / (max - min));
}

function fromNorm(t: number, min: number, max: number, scale: 'linear' | 'log'): number {
  if (scale === 'log' && logSafe(min, max)) {
    return Math.exp(Math.log(min) + t * (Math.log(max) - Math.log(min)));
  }
  return min + t * (max - min);
}

function quantise(v: number, min: number, max: number, step: number): number {
  const clamped = clamp(v, min, max);
  if (!step) return clamped;
  const snapped = Math.round((clamped - min) / step) * step + min;
  // Floating-point cleanup: 0.30000000000000004 -> 0.3
  const decimals = decimalsOf(step);
  return clamp(Number(snapped.toFixed(decimals)), min, max);
}

export function decimalsOf(step: number): number {
  const str = String(step);
  if (str.includes('e-')) return Number(str.split('e-')[1]) || 0;
  const dot = str.indexOf('.');
  return dot === -1 ? 0 : str.length - dot - 1;
}

export function formatValue(v: number, step: number): string {
  return v.toFixed(Math.min(decimalsOf(step), 4));
}

function clamp(n: number, min: number, max: number): number {
  return n < min ? min : n > max ? max : n;
}

function clamp01(n: number): number {
  return clamp(n, 0, 1);
}
