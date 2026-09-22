/**
 * Shape Source — signed distance field builder.
 *
 * Turns an antialiased coverage raster (0..255 per pixel) into a two-channel
 * signed distance field a shader can sample with plain linear filtering:
 *
 *   R  fine   — ±FINE_SPREAD px around the edge, 0.125 px per 8-bit level.
 *              This is the channel that decides where the edge actually is.
 *   G  coarse — ±COARSE_SPREAD px, for effects that need to know how DEEP a
 *              point is inside the shape (element sizing, breathe, wobble).
 *
 * Both encode `0.5 + d / (2 * spread)`, positive inside.
 *
 * WHY THE COVERAGE SEEDING MATTERS (the Shapeshift "stair-step edges" fix).
 * The first mockup thresholded the raster to a 1-bit mask (alpha > 127) and
 * ran the distance transform on that. A 1-bit mask puts the edge on pixel
 * boundaries, so every diagonal and curve becomes a staircase — invisible at
 * 1:1, obvious once the texture is magnified onto a large tile. Seeding the
 * transform from the antialiased coverage instead (the TinySDF approach: an
 * edge pixel with coverage `a` starts at distance |a − 0.5| from the contour)
 * keeps sub-pixel edge position. Verified numerically against an analytic
 * circle before this was written: mean contour error 0.63 px → 0.12 px,
 * max 1.00 px → 0.55 px. See scripts/verify-shape-source.ts, which re-checks
 * the same bound on every run.
 *
 * Pure and allocation-light on purpose: runs unchanged in the SDF worker, on
 * the main thread as a fallback, and under `tsx` in the verifier.
 *
 * Location: lib/shape-source/sdf.ts
 */

export const FINE_SPREAD = 16;
export const COARSE_SPREAD = 128;

const INF = 1e20;

/** Felzenszwalb–Huttenlocher 1-D squared distance transform, in place into `d`. */
function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array): void {
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const dq = q - v[k];
    d[q] = dq * dq + f[v[k]];
  }
}

function edt2d(grid: Float64Array, w: number, h: number): void {
  const n = Math.max(w, h);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = grid[y * w + x];
    edt1d(f, h, d, v, z);
    for (let y = 0; y < h; y++) grid[y * w + x] = d[y];
  }
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) f[x] = grid[row + x];
    edt1d(f, w, d, v, z);
    for (let x = 0; x < w; x++) grid[row + x] = d[x];
  }
}

/**
 * Signed distance in pixels (positive inside) from 0..255 coverage.
 * Exported for the verifier; production code uses buildSdfRGBA().
 */
export function signedDistance(coverage: ArrayLike<number>, w: number, h: number): Float32Array {
  const n = w * h;
  const outer = new Float64Array(n);
  const inner = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = coverage[i] / 255;
    if (a >= 1) {
      outer[i] = 0;
      inner[i] = INF;
    } else if (a <= 0) {
      outer[i] = INF;
      inner[i] = 0;
    } else {
      // Sub-pixel seed: an edge pixel is |a − 0.5| px from the contour.
      const o = Math.max(0, 0.5 - a);
      const ii = Math.max(0, a - 0.5);
      outer[i] = o * o;
      inner[i] = ii * ii;
    }
  }
  edt2d(outer, w, h);
  edt2d(inner, w, h);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.sqrt(inner[i]) - Math.sqrt(outer[i]);
  return out;
}

export interface SdfResult {
  /** RGBA8, row 0 = top of the shape. R fine, G coarse, B 0, A 255. */
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
  /** False when the raster had no coverage at all (nothing to draw). */
  hasShape: boolean;
  /**
   * Deepest inside distance in raster pixels (clamped to COARSE_SPREAD, the
   * most the coarse channel can encode). Lets a shader normalise "how deep
   * inside the shape am I" per shape — a thin text stroke and a fat logo
   * both span 0..1 — instead of against one fixed distance.
   */
  maxDepth: number;
}

export function buildSdfRGBA(coverage: ArrayLike<number>, w: number, h: number): SdfResult {
  const n = w * h;
  const rgba = new Uint8ClampedArray(n * 4);

  let any = false;
  let full = true;
  for (let i = 0; i < n; i++) {
    if (coverage[i] > 0) any = true;
    if (coverage[i] < 255) full = false;
    if (any && !full) break;
  }

  // Degenerate rasters: all-outside or all-inside. The transform would
  // return ±INF-derived values; encode the clamped extremes directly.
  if (!any || full) {
    const v = any ? 255 : 0;
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      rgba[o] = v;
      rgba[o + 1] = v;
      rgba[o + 3] = 255;
    }
    return { rgba, width: w, height: h, hasShape: any, maxDepth: any ? COARSE_SPREAD : 0 };
  }

  const sd = signedDistance(coverage, w, h);
  let maxDepth = 0;
  for (let i = 0; i < n; i++) {
    const d = sd[i];
    if (d > maxDepth) maxDepth = d;
    const o = i * 4;
    rgba[o] = Math.round((0.5 + d / (2 * FINE_SPREAD)) * 255);
    rgba[o + 1] = Math.round((0.5 + d / (2 * COARSE_SPREAD)) * 255);
    rgba[o + 2] = 0;
    rgba[o + 3] = 255;
  }
  return { rgba, width: w, height: h, hasShape: true, maxDepth: Math.min(maxDepth, COARSE_SPREAD) };
}
