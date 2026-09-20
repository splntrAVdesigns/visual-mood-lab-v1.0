// lib/roll/rng.ts
//
// Randomness for Roll / Mutate. Every function takes the generator as an
// argument (never Math.random directly) so the whole engine is deterministic
// under a seed — which is what lets scripts/verify-roll.ts roll all 99 tiles
// thousands of times and reproduce any failure exactly.

export type Rng = () => number;

/** Small, fast, well-distributed seeded generator (mulberry32). */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal via Box–Muller. */
export function gaussian(rng: Rng): number {
  let u = 0;
  while (u === 0) u = rng();
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function uniform(rng: Rng, a: number, b: number): number {
  return a + (b - a) * rng();
}

/** Uniform in log space — equal probability per doubling. Requires 0 < a <= b. */
export function logUniform(rng: Rng, a: number, b: number): number {
  return Math.exp(uniform(rng, Math.log(a), Math.log(b)));
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.min(items.length - 1, Math.floor(rng() * items.length))];
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Fold a value back into [lo, hi] by reflecting off the bounds (rather than
 * clamping, which would pile probability mass onto the endpoints).
 */
export function reflect(v: number, lo: number, hi: number): number {
  if (hi <= lo) return lo;
  let x = v;
  for (let i = 0; i < 6 && (x < lo || x > hi); i++) x = x < lo ? 2 * lo - x : 2 * hi - x;
  return clamp(x, lo, hi);
}
