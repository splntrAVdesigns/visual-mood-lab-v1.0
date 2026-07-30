import type { AssetRenderer } from '@/renderers/types';
import type { ParamState } from '@/renderers/control-schema';

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
