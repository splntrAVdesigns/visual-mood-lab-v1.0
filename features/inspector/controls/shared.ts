import type { RGBA } from '@/renderers/control-schema';

/** Shared value-coercion helpers used across control components. Guards the
    render path against a schema/state mismatch during hot reload — the
    store already validates, these are a second, cheap line of defence. */

export function num(v: unknown, fallback: number): number {
  return typeof v === 'number' ? v : fallback;
}

export function isRGBA(v: unknown): v is RGBA {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && 'r' in v;
}

export function isVec(v: unknown, n: number): boolean {
  return Array.isArray(v) && v.length === n;
}

export function fmt(n: number): string {
  return n.toFixed(2);
}

export function to255(n: number): number {
  return Math.round(n * 255);
}

export function toHex(c: RGBA): string {
  const hex = (n: number) => to255(n).toString(16).padStart(2, '0');
  return `#${hex(c.r)}${hex(c.g)}${hex(c.b)}`;
}
