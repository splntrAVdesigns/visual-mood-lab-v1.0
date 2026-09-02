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
      // Mirrors thumbLeft()/fillWidth() below — hit-testing has to use the
      // same inset travel range as the visual thumb, or a drag to either
      // physical end of the track would stop just short of / overshoot
      // min/max relative to where the thumb is actually drawn.
      const usable = Math.max(rect.width - THUMB_PX, 1);
      const t = clamp01((clientX - rect.left - THUMB_PX / 2) / usable);
      return quantise(fromNorm(t, min, max, scale), min, max, step);
    },
    [min, max, scale, step, value],
  );

  // Touch-only drag-intent gate. Mouse/pen never touch this — desktop's
  // existing feel (setPointerCapture + jump to click position immediately
  // on pointerdown) is untouched below, exactly as it was.
  //
  // On a touchscreen, a slider living inside a vertically scrollable
  // panel (SoundPanel/ModulationPanel's rows) has no way to tell "this
  // touch means to drag the slider" from "this touch happens to land on
  // the slider but means to scroll the panel" until the finger actually
  // moves — they're the same input channel. The old code decided on
  // pointerdown, before any movement at all: it jumped the value and
  // called setPointerCapture immediately, which both fired the moment a
  // finger merely touched down (a value jump on pure contact, before any
  // drag) and, once captured, gave the browser's own touch-scroll
  // recognizer nothing left to claim for that pointer — so a scroll
  // gesture that happened to start on a slider always lost.
  //
  // Fixed by holding off on both of those until movement crosses
  // TOUCH_DRAG_THRESHOLD, and then checking which axis moved further:
  // predominantly horizontal commits to a drag (capture + start tracking
  // value, from here on out behaving exactly like the mouse path always
  // has); predominantly vertical releases this pointer entirely and lets
  // the ancestor's native scroll handle it, aided by touch-action: pan-y
  // below (ui.module.css) so the browser's own compositor can take that
  // scroll over smoothly rather than everything routing through React.
  const touchDrag = useRef<{ pointerId: number; startX: number; startY: number; dragging: boolean } | null>(
    null,
  );
  const TOUCH_DRAG_THRESHOLD = 6; // px — small enough to feel immediate once committed, large enough that a stationary tap-then-scroll doesn't false-trigger a drag first.

  const handlePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    // Only the primary (left) button drags the slider. Without this check,
    // a right-click meant to open the modulation context menu also jumped
    // the value to the click position and captured the pointer — which in
    // turn could suppress the browser's own contextmenu dispatch. Right and
    // middle clicks now pass through untouched.
    if (e.button !== 0) return;

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
          // Predominantly vertical — a scroll, not a slider drag. Let go
          // entirely; touch-action: pan-y lets the browser take it from here.
          touchDrag.current = null;
          return;
        }
        // Predominantly horizontal past the threshold — this is a drag.
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
      <div className={s.sliderFill} style={{ width: fillWidth(norm) }} />
      <div className={s.sliderThumb} style={{ left: thumbLeft(norm) }} />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Thumb/fill geometry
 *
 * .sliderTrack/.sliderFill span the full width of .slider (inset-inline:
 * 0), and .sliderThumb self-centers on its `left` point via a negative
 * margin-left equal to half its own width (ui.module.css). Placing the
 * thumb's `left` at raw norm*100% therefore put the thumb's *center* at
 * the physical container edge at norm=0/1 — with the self-centering
 * margin, half the thumb rendered outside the track at both extremes,
 * and was the easiest thing in the world to overshoot with a drag.
 *
 * THUMB_PX must be kept in sync with --slider-thumb's default in
 * ui.module.css (.sliderThumb). That custom property's own doc comment
 * notes an ancestor CAN override it via the cascade — if one ever does,
 * this JS constant will silently drift from the actual rendered thumb
 * size and the inset below will be slightly off. No ancestor overrides
 * it today, so not solving for that case now, just flagging it.
 * ------------------------------------------------------------------ */
const THUMB_PX = 12;

/** Center point for the thumb's `left`, inset by half its own width on
 *  each side so its circle stays fully inside the track at norm=0/1. */
function thumbLeft(norm: number): string {
  return `calc(${THUMB_PX / 2}px + (100% - ${THUMB_PX}px) * ${norm})`;
}

/** Fill terminates exactly at the thumb's *left edge* (not its center) —
 *  this is deliberately NOT thumbLeft(norm): using thumbLeft would leave
 *  a permanent ~6px sliver of fill visible even at norm=0 (thumbLeft(0)
 *  is THUMB_PX/2, not 0). This formula is exactly thumbLeft(norm) minus
 *  THUMB_PX/2, so it's genuinely 0 at the minimum and lines up flush
 *  with the thumb's edge everywhere in between. */
function fillWidth(norm: number): string {
  return `calc((100% - ${THUMB_PX}px) * ${norm})`;
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
