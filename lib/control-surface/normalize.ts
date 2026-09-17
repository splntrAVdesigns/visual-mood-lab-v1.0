import { coerce, type Control, type ParamValue } from '@/renderers/control-schema';
import type { ControlSignal, ResponseCurve } from './types';

export function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

export function clampBipolar(n: number): number {
  return n < -1 ? -1 : n > 1 ? 1 : n;
}

function finiteOr(n: number | undefined, fallback: number): number {
  return typeof n === 'number' && Number.isFinite(n) ? n : fallback;
}

/** Defensive normalization at the controller trust boundary. */
export function sanitizeSignal(signal: ControlSignal): ControlSignal {
  switch (signal.kind) {
    case 'absolute':
      return { kind: 'absolute', value: clamp01(finiteOr(signal.value, 0)) };
    case 'bipolar':
      return { kind: 'bipolar', value: clampBipolar(finiteOr(signal.value, 0)) };
    case 'relative':
      return { kind: 'relative', delta: clampBipolar(finiteOr(signal.delta, 0)) };
    case 'gate':
      return {
        kind: 'gate',
        pressed: Boolean(signal.pressed),
        velocity: signal.velocity === undefined ? undefined : clamp01(finiteOr(signal.velocity, 0)),
      };
    case 'trigger':
      return {
        kind: 'trigger',
        velocity: signal.velocity === undefined ? undefined : clamp01(finiteOr(signal.velocity, 1)),
      };
  }
}

/**
 * Convert semantic input to the engine's common 0..1 working range. Relative
 * inputs integrate from the previous binding position rather than pretending
 * to be absolute hardware.
 */
export function signalToUnit(signal: ControlSignal, previous = 0.5): number {
  switch (signal.kind) {
    case 'absolute':
      return clamp01(signal.value);
    case 'bipolar':
      return clamp01((signal.value + 1) * 0.5);
    case 'relative':
      return clamp01(previous + signal.delta);
    case 'gate':
      return signal.pressed ? clamp01(signal.velocity ?? 1) : 0;
    case 'trigger':
      return clamp01(signal.velocity ?? 1);
  }
}

export function applyResponseCurve(value01: number, curve: ResponseCurve = 'linear'): number {
  const x = clamp01(value01);
  switch (curve) {
    case 'log':
      // Gentle low-end expansion. Target-native logarithmic sliders are
      // handled separately in mapUnitToControl().
      return Math.sqrt(x);
    case 'exp':
      return x * x;
    default:
      return x;
  }
}

/**
 * Map a normalized direct-control value into a real VML control. Unsupported
 * composite/textual controls return null rather than accepting a nonsense
 * scalar assignment.
 */
export function mapUnitToControl(control: Control, value01: number): ParamValue | null {
  const unit = clamp01(value01);

  switch (control.kind) {
    case 'slider':
    case 'stepper': {
      let raw: number;
      if (control.kind === 'slider' && control.scale === 'log' && control.min > 0 && control.max > control.min) {
        raw = control.min * Math.pow(control.max / control.min, unit);
      } else {
        raw = control.min + (control.max - control.min) * unit;
      }

      const step = control.step;
      if (typeof step === 'number' && step > 0) {
        raw = control.min + Math.round((raw - control.min) / step) * step;
      }
      return coerce(control, raw);
    }

    case 'toggle':
      return unit >= 0.5;

    case 'select': {
      if (control.options.length === 0) return control.default;
      const index = Math.min(control.options.length - 1, Math.floor(unit * control.options.length));
      return control.options[index]?.value ?? control.default;
    }

    default:
      return null;
  }
}
