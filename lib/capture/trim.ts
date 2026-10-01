/** Times refer to the saved, displayed clip, never to the retained raw master. */
export interface CaptureTrim {
  startSec: number;
  endSec: number;
  sourceDurationSec: number;
}

export function isVideoCapture(asset: { type: string; tags: string[] }): boolean {
  return asset.type === 'video' && asset.tags.includes('capture');
}

export function clampTrim(start: number, end: number, duration: number): CaptureTrim {
  const gap = Math.min(0.1, duration);
  const startSec = Math.max(0, Math.min(duration - gap, start));
  const endSec = Math.max(startSec + gap, Math.min(duration, end));
  return { startSec, endSec, sourceDurationSec: duration };
}

export function trimTime(seconds: number): string {
  const ticks = Math.round(seconds * 100);
  return `${Math.floor(ticks / 6000)}:${String(Math.floor(ticks / 100) % 60).padStart(2, '0')}.${String(ticks % 100).padStart(2, '0')}`;
}
