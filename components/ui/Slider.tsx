'use client';

import { useCallback, useEffect, useId, useRef, type PointerEvent, type KeyboardEvent } from 'react';
import s from './ui.module.css';

interface SliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  scale?: 'linear' | 'log';
  disabled?: boolean;
  /** Draws the dashed fill indicating a live modulation/controller source. */
  modulated?: boolean;
  label: string;
  onChange: (value: number) => void;
  /** Fired once on pointer release / keyboard commit — use to persist. */
  onCommit?: (value: number) => void;
  /**
   * Optional high-frequency presentation sampler. When supplied, the visual
   * thumb/fill + ARIA value follow this runtime value via direct DOM writes,
   * without rerendering React for every MIDI/gamepad event.
   */
  liveValue?: () => number | null;
}

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
  liveValue,
}: SliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const id = useId();

  const norm = toNorm(value, min, max, scale);

  useEffect(() => {
    if (!liveValue) return;
    let raf = 0;
    const tick = () => {
      const next = liveValue();
      if (next !== null && Number.isFinite(next)) {
        const liveNorm = toNorm(next, min, max, scale);
        if (fillRef.current) fillRef.current.style.width = fillWidth(liveNorm);
        if (thumbRef.current) thumbRef.current.style.left = thumbLeft(liveNorm);
        if (trackRef.current) {
          trackRef.current.setAttribute('aria-valuenow', String(next));
          trackRef.current.setAttribute('aria-valuetext', formatValue(next, step));
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      // We mutate these two style properties outside React while live. Reset
      // them explicitly on cleanup so removing a binding cannot leave the
      // thumb visually parked at the last hardware value.
      const staticNorm = toNorm(value, min, max, scale);
      if (fillRef.current) fillRef.current.style.width = fillWidth(staticNorm);
      if (thumbRef.current) thumbRef.current.style.left = thumbLeft(staticNorm);
    };
  }, [liveValue, value, min, max, scale, step]);

  const valueFromPointer = useCallback(
    (clientX: number): number => {
      const el = trackRef.current;
      if (!el) return value;
      const rect = el.getBoundingClientRect();
      const usable = Math.max(rect.width - THUMB_PX, 1);
      const t = clamp01((clientX - rect.left - THUMB_PX / 2) / usable);
      return quantise(fromNorm(t, min, max, scale), min, max, step);
    },
    [min, max, scale, step, value],
  );

  const touchDrag = useRef<{ pointerId: number; startX: number; startY: number; dragging: boolean } | null>(null);
  const TOUCH_DRAG_THRESHOLD = 6;

  const handlePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled || e.button !== 0) return;
    if (e.pointerType === 'touch') {
      touchDrag.current = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, dragging: false };
      e.currentTarget.focus();
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.focus();
    onChange(valueFromPointer(e.clientX));
  };

  const handlePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    if (e.pointerType === 'touch') {
      const drag = touchDrag.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      if (!drag.dragging) {
        const dx = e.clientX - drag.startX;
        const dy = e.clientY - drag.startY;
        if (Math.abs(dx) < TOUCH_DRAG_THRESHOLD && Math.abs(dy) < TOUCH_DRAG_THRESHOLD) return;
        if (Math.abs(dy) >= Math.abs(dx)) {
          touchDrag.current = null;
          return;
        }
        drag.dragging = true;
        e.currentTarget.setPointerCapture(e.pointerId);
      }
      onChange(valueFromPointer(e.clientX));
      return;
    }
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    onChange(valueFromPointer(e.clientX));
  };

  const handlePointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    if (e.pointerType === 'touch') {
      const drag = touchDrag.current;
      if (drag && drag.pointerId === e.pointerId && drag.dragging) {
        e.currentTarget.releasePointerCapture(e.pointerId);
        onCommit?.(valueFromPointer(e.clientX));
      }
      touchDrag.current = null;
      return;
    }
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    onCommit?.(valueFromPointer(e.clientX));
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const coarse = (max - min) / 10;
    const nudge = e.shiftKey ? coarse : step;
    let next: number | null = null;
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowUp': next = value + nudge; break;
      case 'ArrowLeft':
      case 'ArrowDown': next = value - nudge; break;
      case 'PageUp': next = value + coarse; break;
      case 'PageDown': next = value - coarse; break;
      case 'Home': next = min; break;
      case 'End': next = max; break;
      default: return;
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
      <div ref={fillRef} className={s.sliderFill} style={{ width: fillWidth(norm) }} />
      <div ref={thumbRef} className={s.sliderThumb} style={{ left: thumbLeft(norm) }} />
    </div>
  );
}

const THUMB_PX = 12;

function thumbLeft(norm: number): string {
  return `calc(${THUMB_PX / 2}px + (100% - ${THUMB_PX}px) * ${norm})`;
}

function fillWidth(norm: number): string {
  return `calc((100% - ${THUMB_PX}px) * ${norm})`;
}

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
