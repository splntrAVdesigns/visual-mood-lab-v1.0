// lib/roll/color.ts
//
// Palette logic for Roll / Mutate.
//
// WHY NOT RANDOM RGB: colors are 18% of every control in the seed library and
// appear on all 99 tiles, and about a third of them are "role" colors — a
// near-black background, near-white ink, a neutral gray. Independent random
// RGB per control turns those into mud and destroys contrast. So:
//   - role colors (near-black / near-white / near-gray, judged on the
//     control's DEFAULT) are never touched;
//   - the chromatic colors get hues from a harmony scheme, each keeping its
//     own default saturation and brightness (± a small jitter), so the tile's
//     light/dark structure survives and only the hue relationships change.

import type { RGBA } from '@/renderers/control-schema';
import { clamp, gaussian, pick, type Rng } from './rng';

export function luminance(c: Pick<RGBA, 'r' | 'g' | 'b'>): number {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

/** h, s, v all in 0..1 */
export function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
    if (h < 0) h += 1;
  }
  return [h, max === 0 ? 0 : d / max, max];
}

export function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const hh = ((h % 1) + 1) % 1;
  const i = Math.floor(hh * 6);
  const f = hh * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  switch (i % 6) {
    case 0: return [v, t, p];
    case 1: return [q, v, p];
    case 2: return [p, v, t];
    case 3: return [p, q, v];
    case 4: return [t, p, v];
    default: return [v, p, q];
  }
}

/** Near-black, near-white or near-gray: a background / ink / neutral. */
export function isRoleColor(c: RGBA): boolean {
  const lum = luminance(c);
  const sat = rgbToHsv(c.r, c.g, c.b)[1];
  return lum < 0.08 || lum > 0.88 || sat < 0.12;
}

export type HarmonyScheme = 'analogous' | 'complementary' | 'triad' | 'split' | 'mono';

/** Hue offsets in degrees from the base hue, assigned to colors in schema order. */
export const HARMONY_OFFSETS: Record<HarmonyScheme, readonly number[]> = {
  analogous: [0, 30, -30, 60, -60, 15, -15],
  complementary: [0, 180, 20, 200, -20, 160, 340],
  triad: [0, 120, 240, 15, 135, 255, 30],
  split: [0, 150, 210, 20, 170, 190, -20],
  mono: [0, 8, -8, 16, -16, 4, -4],
};
const SCHEMES = Object.keys(HARMONY_OFFSETS) as HarmonyScheme[];

/** Max change to brightness (V) and saturation (S) a Roll may apply to one color. */
export const ROLL_V_JITTER = 0.1;
export const ROLL_S_JITTER = 0.12;

/**
 * A new palette for a tile's chromatic colors. `defaults` are the controls'
 * default colors in schema order; the result is the same length. Each keeps its
 * default's saturation/brightness (± jitter) and alpha; only hue is reassigned.
 */
export function rollPalette(defaults: readonly RGBA[], rng: Rng): RGBA[] {
  const scheme = pick(rng, SCHEMES);
  const offsets = HARMONY_OFFSETS[scheme];
  const base = rng();

  return defaults.map((c, i) => {
    const [, s0, v0] = rgbToHsv(c.r, c.g, c.b);
    const hue = base + offsets[i % offsets.length] / 360;
    const s = clamp(s0 + (rng() - 0.5) * 2 * ROLL_S_JITTER, Math.min(s0, 0.3), 1);
    const v = clamp(v0 + (rng() - 0.5) * 2 * ROLL_V_JITTER, Math.max(0.1, v0 - ROLL_V_JITTER), Math.min(1, v0 + ROLL_V_JITTER));
    const [r, g, b] = hsvToRgb(hue, s, v);
    return { r, g, b, a: c.a };
  });
}

/**
 * Nudge one color: rotate its hue by `hueShift` (the SAME shift for every color
 * in a tile, so their relationships are preserved) plus a small S/V jitter that
 * grows with `strength`. strength <= 0 returns the color untouched.
 */
export function mutateColor(c: RGBA, hueShift: number, strength: number, rng: Rng): RGBA {
  if (strength <= 0) return c;
  const [h, s, v] = rgbToHsv(c.r, c.g, c.b);
  const s2 = clamp(s + gaussian(rng) * strength * 0.12, Math.min(s, 0.12), 1);
  const v2 = clamp(v + gaussian(rng) * strength * 0.12, Math.min(v, 0.05), 1);
  const [r, g, b] = hsvToRgb(h + hueShift, s2, v2);
  return { r, g, b, a: c.a };
}
