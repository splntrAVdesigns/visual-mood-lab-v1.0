/**
 * Shape Source — turns a ShapeSpec into a distance-field canvas a shader can
 * sample, once per distinct source, off the render loop.
 *
 * Same contract as lib/gl/texture-source.ts, deliberately: called from the
 * per-frame uniform binding path, so it is synchronous-with-a-null — the
 * first call starts the work and returns null, later calls return the
 * finished canvas. The canvas object is new per distinct spec, which is what
 * lets GLStage.uploadTexture()'s reference check skip re-uploads while the
 * source is unchanged and re-upload exactly once when it changes.
 *
 * Reused by Phase 5.5 (Blend & Mask) as its mask source — nothing in here
 * knows about Shapeshift.
 *
 * Location: lib/shape-source/index.ts
 */

import { buildSdfRGBA, type SdfResult } from './sdf';
import { rasterizeCoverage, SHAPE_RES, specKey, type ShapeSpec } from './raster';

export { specKey, SHAPE_RES } from './raster';
export type { ShapeSpec, ShapeKey } from './raster';
export { FINE_SPREAD, COARSE_SPREAD } from './sdf';

type Entry =
  | { state: 'loading' }
  | { state: 'ready'; canvas: HTMLCanvasElement; hasShape: boolean; keyMode?: 'alpha' | 'luma'; usedAt: number }
  | { state: 'failed'; error: string; at: number };

const cache = new Map<string, Entry>();
const listeners = new Set<() => void>();
function notify(): void { for (const listener of listeners) listener(); }
/** Deepest inside distance per finished canvas, in shape space (s ∈ [-1, 1]). */
const depthOf = new WeakMap<HTMLCanvasElement, number>();
const MAX_READY = 8;
const RETRY_MS = 5000;

/* ------------------------------------------------------------------ *
 * Worker (with main-thread fallback)
 * ------------------------------------------------------------------ */

let worker: Worker | null | undefined;
let nextJob = 1;
const pending = new Map<number, { coverage: Uint8ClampedArray; resolve: (r: SdfResult) => void }>();

function failWorker(): void {
  worker?.terminate();
  worker = null;
  // Anything still queued finishes on the main thread instead of hanging.
  for (const [id, job] of pending) {
    pending.delete(id);
    job.resolve(buildSdfRGBA(job.coverage, SHAPE_RES, SHAPE_RES));
  }
}

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    worker = new Worker(new URL('./sdf.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<SdfResult & { id: number }>) => {
      const job = pending.get(e.data.id);
      if (!job) return;
      pending.delete(e.data.id);
      job.resolve(e.data);
    };
    worker.onerror = () => failWorker();
  } catch {
    worker = null;
  }
  return worker;
}

function computeSdf(coverage: Uint8ClampedArray): Promise<SdfResult> {
  const w = getWorker();
  if (!w) return Promise.resolve(buildSdfRGBA(coverage, SHAPE_RES, SHAPE_RES));
  return new Promise((resolve) => {
    const id = nextJob++;
    // Keep a copy for the fallback path: the transferred buffer is gone.
    pending.set(id, { coverage: coverage.slice(), resolve });
    w.postMessage({ id, coverage, width: SHAPE_RES, height: SHAPE_RES }, [coverage.buffer]);
  });
}

/* ------------------------------------------------------------------ *
 * Cache
 * ------------------------------------------------------------------ */

function evict(): void {
  const ready = [...cache.entries()].filter(
    (e): e is [string, Extract<Entry, { state: 'ready' }>] => e[1].state === 'ready',
  );
  if (ready.length <= MAX_READY) return;
  ready.sort((a, b) => a[1].usedAt - b[1].usedAt);
  for (const [key] of ready.slice(0, ready.length - MAX_READY)) cache.delete(key);
}

async function build(key: string, spec: ShapeSpec): Promise<void> {
  try {
    let keyMode: 'alpha' | 'luma' | undefined;
    const coverage = await rasterizeCoverage(spec, (resolved) => { keyMode = resolved; });
    const sdf = await computeSdf(coverage);
    const canvas = document.createElement('canvas');
    canvas.width = sdf.width;
    canvas.height = sdf.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas unavailable');
    ctx.putImageData(new ImageData(new Uint8ClampedArray(sdf.rgba), sdf.width, sdf.height), 0, 0);
    depthOf.set(canvas, (sdf.maxDepth * 2) / sdf.width);
    cache.set(key, { state: 'ready', canvas, hasShape: sdf.hasShape, keyMode, usedAt: performance.now() });
    evict();
    notify();
  } catch (err) {
    cache.set(key, {
      state: 'failed',
      error: err instanceof Error ? err.message : 'Could not build the shape',
      at: performance.now(),
    });
    notify();
  }
}

/**
 * The finished distance-field canvas for `spec`, or null while it is still
 * being built (or if it failed — see getShapeError).
 */
export function getShapeCanvas(spec: ShapeSpec): HTMLCanvasElement | null {
  const key = specKey(spec);
  const hit = cache.get(key);
  if (hit?.state === 'ready') {
    hit.usedAt = performance.now();
    return hit.canvas;
  }
  if (hit?.state === 'loading') return null;
  if (hit?.state === 'failed' && performance.now() - hit.at < RETRY_MS) return null;

  cache.set(key, { state: 'loading' });
  notify();
  void build(key, spec);
  return null;
}

/**
 * The shape's deepest inside distance in shape-space units (the raster spans
 * s ∈ [-1, 1]), for normalising depth effects. 0 for an empty shape.
 */
export function getShapeDepth(canvas: HTMLCanvasElement): number {
  return depthOf.get(canvas) ?? 0;
}

export function getShapeError(spec: ShapeSpec): string | null {
  const hit = cache.get(specKey(spec));
  return hit?.state === 'failed' ? hit.error : null;
}

/** A lightweight, reactive status for the upload inspector. Empty coverage
 * is a valid key result and should be explained rather than looking crashed. */
export function getShapeStatus(spec: ShapeSpec): 'idle' | 'loading' | 'ready' | 'empty' | 'failed' {
  const entry = cache.get(specKey(spec));
  if (!entry) return 'idle';
  return entry.state === 'ready' ? (entry.hasShape ? 'ready' : 'empty') : entry.state;
}

export function getResolvedShapeKey(spec: ShapeSpec): 'alpha' | 'luma' | null {
  const entry = cache.get(specKey(spec));
  return entry?.state === 'ready' ? entry.keyMode ?? null : null;
}

export function subscribeShapeStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function clearShapeCache(): void {
  cache.clear();
  notify();
}
