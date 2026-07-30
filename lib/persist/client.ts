import type { AssetRenderer } from '@/renderers/types';
import type { ParamState } from '@/renderers/control-schema';
import type { Asset } from '@/types/asset';
import type { ModState } from '@/renderers/control-schema';

/**
 * Client-side persistence helpers.
 *
 * Location: lib/persist/client.ts
 */

/* ------------------------------------------------------------------ *
 * Poster capture
 * ------------------------------------------------------------------ */

/** Assets already attempted this session, so a card never uploads twice. */
const attempted = new Set<string>();

/**
 * A poster is still a generated placeholder if it is the .svg we produced at
 * ingest. Real captures are .png, so this flips to false permanently once a
 * capture succeeds.
 */
export function isPlaceholderPoster(posterUrl: string | undefined): boolean {
  return !posterUrl || posterUrl.endsWith('.svg');
}

/**
 * Snapshot a live renderer and upload the frame as the asset's poster.
 *
 * Called once per asset per session, only after the renderer has drawn
 * enough frames to be showing something representative. Failure is silent by
 * design — a poster that does not upload is a cosmetic loss, not worth
 * interrupting the board over.
 */
export async function captureAndStorePoster(
  assetId: string,
  renderer: AssetRenderer,
): Promise<string | null> {
  if (attempted.has(assetId)) return null;
  attempted.add(assetId);

  try {
    const blob = await renderer.capture({ type: 'image/png' });
    if (!blob || blob.size < 2048) return null;

    const res = await fetch(`/api/assets/${assetId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/png' },
      body: blob,
    });

    if (!res.ok) return null;
    const data = (await res.json()) as { posterUrl?: string };
    return data.posterUrl ?? null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * Parameter persistence
 * ------------------------------------------------------------------ */

const timers = new Map<string, ReturnType<typeof setTimeout>>();
const pending = new Map<string, ParamState>();

/**
 * Debounced parameter save.
 *
 * Dragging a slider fires dozens of changes per second; each one must reach
 * the live renderer immediately but must NOT become a database write. The
 * renderer update stays synchronous in the store, and only the persisted
 * copy is debounced.
 */
export function persistParams(assetId: string, params: ParamState, delay = 500): void {
  pending.set(assetId, params);

  const existing = timers.get(assetId);
  if (existing) clearTimeout(existing);

  timers.set(
    assetId,
    setTimeout(() => {
      const payload = pending.get(assetId);
      timers.delete(assetId);
      pending.delete(assetId);
      if (!payload) return;

      void fetch(`/api/assets/${assetId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ params: payload }),
        keepalive: true,
      }).catch(() => {
        /* Losing a parameter save is recoverable; the value is still live. */
      });
    }, delay),
  );
}

/**
 * Flush any queued save immediately. Called when the inspector closes so a
 * change made a moment before closing is not lost to the debounce window.
 */
export function flushParams(assetId: string): void {
  const timer = timers.get(assetId);
  const payload = pending.get(assetId);
  if (!timer || !payload) return;

  clearTimeout(timer);
  timers.delete(assetId);
  pending.delete(assetId);

  void fetch(`/api/assets/${assetId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ params: payload }),
    keepalive: true,
  }).catch(() => {});
}


/* ------------------------------------------------------------------ *
 * Snapshots — parameter variations that become their own board card
 * ------------------------------------------------------------------ */

/**
 * Creates a new board card sharing `assetId`'s shader/sketch but with its
 * own saved parameters. Returns the new card, or null on failure — callers
 * decide how to surface that; a failed save is not worth blocking the UI
 * over.
 */
export async function createSnapshot(assetId: string, params: ParamState): Promise<Asset | null> {
  try {
    const res = await fetch('/api/boards/default/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assetId, params }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { item?: Asset };
    return data.item ?? null;
  } catch {
    return null;
  }
}

/**
 * Uploads a captured frame as the snapshot's own poster, and hands back a
 * blob the caller can also offer as a download — the "bounce" side of
 * saving a snapshot.
 */
export async function storeSnapshotCapture(
  itemId: string,
  renderer: AssetRenderer,
): Promise<{ posterUrl: string | null; blob: Blob | null }> {
  try {
    const blob = await renderer.capture({ type: 'image/png' });
    if (!blob || blob.size < 2048) return { posterUrl: null, blob };

    const res = await fetch(`/api/boards/default/items/${itemId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/png' },
      body: blob,
    });

    if (!res.ok) return { posterUrl: null, blob };
    const data = (await res.json()) as { posterUrl?: string };
    return { posterUrl: data.posterUrl ?? null, blob };
  } catch {
    return { posterUrl: null, blob: null };
  }
}

/** Triggers a browser download for a captured frame. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function deleteSnapshot(itemId: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/boards/default/items/${itemId}`, { method: 'DELETE' });
    return res.ok;
  } catch {
    return false;
  }
}

/** Persists a snapshot's params. Distinct from persistParams: snapshots
    write to the board item's paramsOverride, not the asset row. */
export function persistSnapshotParams(itemId: string, params: ParamState, delay = 500): void {
  const key = `snapshot:${itemId}`;
  pending.set(key, params);

  const existing = timers.get(key);
  if (existing) clearTimeout(existing);

  timers.set(
    key,
    setTimeout(() => {
      const payload = pending.get(key);
      timers.delete(key);
      pending.delete(key);
      if (!payload) return;

      void fetch(`/api/boards/default/items/${itemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ params: payload }),
        keepalive: true,
      }).catch(() => {});
    }, delay),
  );
}

export function flushSnapshotParams(itemId: string): void {
  const key = `snapshot:${itemId}`;
  const timer = timers.get(key);
  const payload = pending.get(key);
  if (!timer || !payload) return;

  clearTimeout(timer);
  timers.delete(key);
  pending.delete(key);

  void fetch(`/api/boards/default/items/${itemId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ params: payload }),
    keepalive: true,
  }).catch(() => {});
}


/**
 * Persist modulation routing. Debounced like params — dragging a rate slider
 * shouldn't write a row per frame — and routed to the snapshot's own column
 * when the open card is a snapshot.
 */
export function persistMod(itemId: string, mod: ModState, isSnapshot: boolean, delay = 500): void {
  const key = `mod:${itemId}`;
  pending.set(key, mod as never);

  const existing = timers.get(key);
  if (existing) clearTimeout(existing);

  const url = isSnapshot
    ? `/api/boards/default/items/${itemId}`
    : `/api/assets/${itemId}`;

  timers.set(
    key,
    setTimeout(() => {
      const payload = pending.get(key);
      timers.delete(key);
      pending.delete(key);
      if (!payload) return;

      void fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mod: payload }),
        keepalive: true,
      }).catch(() => {});
    }, delay),
  );
}
