/** Opt-in, bounded rendering trace. Enable with ?perf=1 and read
 * window.__vmlPerf.snapshot() in the browser console. No asset content or
 * account identifiers are collected; the ring stores at most 900 frames. */
import type { AssetType } from '@/types/asset';

export interface FrameSample {
  gapMs: number;
  cpuMs: number;
  tiles: Array<{ type: AssetType; renderMs: number; effectsMs: number; passes: number; pixels: number; p5Fps: number | null }>;
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
    reset: () => { samples.length = 0; current = null; previousAt = 0; },
  };
}

declare global {
  interface Window {
    __vmlPerf?: { snapshot(): { version: 1; frames: FrameSample[] }; reset(): void };
  }
}
