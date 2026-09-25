/** Opt-in, bounded rendering trace. Enable with ?perf=1 and read
 * window.__vmlPerf.snapshot() in the browser console. No asset content or
 * account identifiers are collected; the ring stores at most 900 frames. */
import type { AssetType } from '@/types/asset';

export interface FrameSample {
  gapMs: number;
  cpuMs: number;
  tiles: Array<{ type: AssetType; renderMs: number; effectsMs: number; passes: number; pixels: number; p5Fps: number | null }>;
}

export interface FrameSummary {
  frames: number;
  medianFps: number | null;
  p95FrameGapMs: number | null;
  p95PoolCpuMs: number | null;
  p95EffectsCpuMs: number | null;
  p5SketchFps: number | null;
  effectsPasses: number;
}

function percentile(values: number[], fraction: number): number | null {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor((sorted.length - 1) * fraction)] : null;
}

/** Aggregate one recent capture. CPU timing does not include asynchronous GPU execution. */
export function summarizeFrameProfile(frames: FrameSample[]): FrameSummary {
  const stable = frames.slice(1); // first gap is zero after reset
  const gaps = stable.map(f => f.gapMs).filter(ms => ms > 0);
  const medianGap = percentile(gaps, 0.5);
  const tiles = stable.flatMap(f => f.tiles);
  const sketchFps = tiles.filter(t => t.type === 'p5' && t.p5Fps !== null && t.p5Fps > 0)
    .map(t => t.p5Fps!);
  return {
    frames: stable.length,
    medianFps: medianGap ? Math.round(1000 / medianGap) : null,
    p95FrameGapMs: percentile(gaps, 0.95),
    p95PoolCpuMs: percentile(stable.map(f => f.cpuMs), 0.95),
    p95EffectsCpuMs: percentile(stable.map(f => f.tiles.reduce((sum, t) => sum + t.effectsMs, 0)), 0.95),
    p5SketchFps: percentile(sketchFps, 0.5),
    effectsPasses: Math.max(0, ...tiles.map(t => t.passes)),
  };
}

const LIMIT = 900;
const samples: FrameSample[] = [];
let current: FrameSample | null = null;
let startedAt = 0;
let previousAt = 0;
let enabled = false;

export function beginFrameProfile(now: number): void {
  if (!enabled) return;
  current = { gapMs: previousAt ? Math.max(0, now - previousAt) : 0, cpuMs: 0, tiles: [] };
  previousAt = now;
  startedAt = performance.now();
}

export function recordTileProfile(tile: FrameSample['tiles'][number]): void {
  current?.tiles.push(tile);
}

export function endFrameProfile(): void {
  if (!current) return;
  current.cpuMs = performance.now() - startedAt;
  samples.push(current);
  if (samples.length > LIMIT) samples.shift();
  current = null;
}

export function installFrameProfile(win: Window): void {
  if (!new URLSearchParams(win.location.search).has('perf')) return;
  enabled = true;
  win.__vmlPerf = {
    snapshot: () => ({ version: 1 as const, frames: samples.map(s => ({ ...s, tiles: s.tiles.map(t => ({ ...t })) })) }),
    summary: () => summarizeFrameProfile(samples),
    reset: () => { samples.length = 0; current = null; previousAt = 0; },
  };
}

declare global {
  interface Window {
    __vmlPerf?: { snapshot(): { version: 1; frames: FrameSample[] }; summary(): FrameSummary; reset(): void };
  }
}
