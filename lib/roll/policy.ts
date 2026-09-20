// lib/roll/policy.ts
//
// THE safety rules for Roll and Mutate, in one reviewable file.
//
// Every rule below exists because of a measurement on the seed library (99
// tiles, 1,458 controls), not a guess:
//
//  FLASHING      `strobe-cut` ships with a Flash rate of 6 (range 0.5–20) and a
//                duty cycle of 0.05–0.95. A Roll must never be able to push a
//                tile further into flashing, so flash-class controls are
//                excluded outright (by name everywhere, plus an explicit table
//                for the ones a name can't catch).
//  SPEED         233 speed-like sliders have a median max of 5x their default
//                (worst 33x). A uniform roll would routinely make tiles far
//                faster, so they stay within 1/2x .. 2x of the default.
//  COUNT         12 count-style controls have max >= 500 (Harmonograph
//                `samples` defaults to 12,000 and goes to 40,000). They stay
//                within 1/4x .. 1.5x of the default so a Roll can't make a tile
//                several times heavier than the one you started with.
//
// These are HEURISTICS on control names, deliberately over-inclusive: a false
// positive only narrows the variety on one slider; a false negative is what
// the rules exist to prevent. When Playground lands, explicit `@roll(...)`
// annotations in the shader / sketch source should replace the name matching,
// leaving OVERRIDES below as the escape hatch.

import type { Control, SliderControl, StepperControl } from '@/renderers/control-schema';
import { isRoleColor } from './color';

/** Control kinds Roll / Mutate can ever touch. Toggles additionally need opt-in. */
export const ROLLABLE_KINDS = new Set(['slider', 'stepper', 'select', 'xy', 'color', 'toggle']);

/** Photosensitivity: anything that names itself a strobe / flash / flicker. */
export const FLASH_RE = /strobe|flash|flicker/i;

/** Rate / speed style controls (over-inclusive on purpose). */
export const SPEED_RE = /speed|rate|freq|tempo|spin|cycle|rpm|drift/i;
/** …minus names that merely contain those letters. */
const NOT_SPEED_RE = /angle|offset|phase|seed|amount|radius|size|scale|density/i;

/** Quantity style controls whose value scales rendering cost. */
export const COUNT_RE =
  /count|samples?|steps?\b|particles?|iterations?|octaves?|density|detail|segments?|points|nodes|cells|layers?|resolution|quality|bounces/i;

export const SPEED_WINDOW: readonly [number, number] = [0.5, 2];
export const COUNT_WINDOW: readonly [number, number] = [0.25, 1.5];
/** A slider counts as "count-like" only when it can actually get large. */
export const COUNT_MIN_SLIDER_MAX = 500;
export const COUNT_MIN_STEPPER_MAX = 64;

export interface Override {
  /** Never rolled or mutated. */
  skip?: true;
  /** Absolute window [lo, hi] instead of the heuristic one. */
  window?: readonly [number, number];
  /** Why — this table is read by humans reviewing the policy. */
  note: string;
}

/**
 * Per-asset exceptions, keyed by asset id (library assets use their slug as
 * the id) then control id. Verified against the real schemas by
 * scripts/verify-roll.ts, so an entry can't silently rot when a control is
 * renamed.
 */
export const OVERRIDES: Record<string, Record<string, Override>> = {
  'strobe-cut': {
    u_flashRate: {
      skip: true,
      note: 'Ships at 6/s (range 0.5–20). Roll must never be able to raise a tile\'s flash rate.',
    },
    u_threshold: {
      skip: true,
      note: 'Duty cycle (0.05–0.95) of the same flashing — part of the flash behaviour.',
    },
  },
};

export type SafetyKind = 'speed' | 'count' | 'override';

export interface Policy {
  skip: boolean;
  reason?: 'flash' | 'override';
  /** Window as a fraction of default, or an absolute override window. */
  safety?: { kind: SafetyKind; window: readonly [number, number]; absolute: boolean };
}

const text = (c: Control) => `${c.id} ${c.label}`;

export function policyFor(control: Control, assetId: string | null | undefined): Policy {
  const override = assetId ? OVERRIDES[assetId]?.[control.id] : undefined;
  if (override?.skip) return { skip: true, reason: 'override' };
  if (FLASH_RE.test(text(control))) return { skip: true, reason: 'flash' };

  if (control.kind !== 'slider' && control.kind !== 'stepper') return { skip: false };
  const num = control as SliderControl | StepperControl;

  if (override?.window) return { skip: false, safety: { kind: 'override', window: override.window, absolute: true } };

  if (num.default > 0 && SPEED_RE.test(text(control)) && !NOT_SPEED_RE.test(control.id)) {
    return { skip: false, safety: { kind: 'speed', window: SPEED_WINDOW, absolute: false } };
  }

  const big = control.kind === 'slider' ? num.max >= COUNT_MIN_SLIDER_MAX : num.max >= COUNT_MIN_STEPPER_MAX;
  if (num.default > 0 && big && COUNT_RE.test(text(control))) {
    return { skip: false, safety: { kind: 'count', window: COUNT_WINDOW, absolute: false } };
  }
  return { skip: false };
}

/**
 * Would Roll / Mutate ever consider this control? Used by the lock UI so a
 * padlock only appears on controls a lock can actually protect.
 */
export function isRollableControl(
  control: Control,
  assetId: string | null | undefined,
  opts: { includeToggles?: boolean } = {},
): boolean {
  if (!ROLLABLE_KINDS.has(control.kind)) return false;
  if (control.kind === 'toggle' && !opts.includeToggles) return false;
  if (control.advanced || control.disabled) return false;
  if (policyFor(control, assetId).skip) return false;
  if (control.kind === 'color' && isRoleColor(control.default)) return false;
  return true;
}
