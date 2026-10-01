'use client';
import type { CaptureTrim } from './trim';
import { useBoardStore } from '@/stores/boardStore';
import { getPool } from '@/lib/render/pool';

// Serialize per source so quick drags, reset, and inspector changes cannot save out of order.
const writes = new Map<string, Promise<void>>();
export function saveCaptureTrim(assetId: string, trim: CaptureTrim | null): Promise<void> {
  const previous = writes.get(assetId) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(async () => {
    const response = await fetch(`/api/assets/${encodeURIComponent(assetId)}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ captureTrim: trim }), keepalive: true,
    });
    if (!response.ok) throw new Error('Trim could not be saved. Try again.');
    useBoardStore.getState().updateCaptureTrim(assetId, trim);
  });
  writes.set(assetId, next);
  void next.finally(() => { if (writes.get(assetId) === next) writes.delete(assetId); }).catch(() => {});
  return next;
}
export function previewCaptureTrim(assetId: string, trim: CaptureTrim | null): void {
  for (const asset of useBoardStore.getState().assets) {
    if (asset.id === assetId) getPool().get(asset.itemId)?.setPlaybackRange?.(trim);
  }
}
