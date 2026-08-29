import type { AssetRenderer } from '@/renderers/types';
import type { ParamState } from '@/renderers/control-schema';
import type { Asset } from '@/types/asset';
import type { ModState, SoundState } from '@/renderers/control-schema';
import type { EffectInstance } from '@/lib/effects/types';
import type { CaptureFormat } from '@/lib/capture/types';

/**
 * Client-side persistence helpers.
 *
 * Location: lib/persist/client.ts
 */

/**
 * Every persistence path in this file used to fail silently — an empty
 * catch swallowed network errors, and none of them checked `res.ok`, so a
 * server error response (fetch only rejects on network failure, never on a
 * 4xx/5xx) vanished too. A save could fail completely and the only symptom
 * was reopening the asset later to find the change gone, with nothing in
 * between to explain why. This makes every failure visible in the console
 * at minimum, which is the fastest path to finding what is actually wrong
 * versus continuing to guess.
 */
function logPersistFailure(what: string, res: Response | null, err?: unknown): void {
  if (err) {
    console.error(`[persist] ${what} failed (network):`, err);
  } else if (res) {
    console.error(`[persist] ${what} failed: HTTP ${res.status} ${res.statusText}`);
  }
}


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
/**
 * Debounced parameter save.
 *
 * Dragging a slider fires dozens of changes per second; each one must reach
 * the live renderer immediately but must NOT become a database write. The
 * renderer update stays synchronous in the store, and only the persisted
 * copy is debounced.
 *
 * `onSaved` exists specifically to keep the board store's own copy of
 * `params` in sync WITHOUT firing on every tick either — inspectorStore.ts
 * used to call `useBoardStore.getState().updateAssetParams()` synchronously
 * on every setParam(), which produces a brand-new `asset` object reference
 * on every single drag tick. RendererStage's effect depends on that whole
 * object, so every tick was tearing the live renderer down and re-promoting
 * it — visible as the canvas going black for the entire duration of a drag,
 * recovering only once the churn settled after release. Routing that same
 * board-store write through this same debounce fixes it at the source: the
 * board store (and thus the renderer's mount effect) now only sees a new
 * object once dragging actually pauses, exactly like the network write
 * already did.
 */
export function persistParams(
  assetId: string,
  params: ParamState,
  delay = 500,
  onSaved?: (params: ParamState) => void,
): void {
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

      onSaved?.(payload);

      fetch(`/api/assets/${assetId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ params: payload }),
        keepalive: true,
      })
        .then((res) => {
          if (!res.ok) logPersistFailure(`params (${assetId})`, res);
        })
        .catch((err) => logPersistFailure(`params (${assetId})`, null, err));
    }, delay),
  );
}

/**
 * Flush any queued save immediately. Called when the inspector closes so a
 * change made a moment before closing is not lost to the debounce window.
 */
export function flushParams(assetId: string, onSaved?: (params: ParamState) => void): void {
  const timer = timers.get(assetId);
  const payload = pending.get(assetId);
  if (!timer || !payload) return;

  clearTimeout(timer);
  timers.delete(assetId);
  pending.delete(assetId);

  onSaved?.(payload);

  fetch(`/api/assets/${assetId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ params: payload }),
    keepalive: true,
  })
    .then((res) => {
      if (!res.ok) logPersistFailure(`params flush (${assetId})`, res);
    })
    .catch((err) => logPersistFailure(`params flush (${assetId})`, null, err));
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
    if (!res.ok) {
      logPersistFailure(`snapshot create (${assetId})`, res);
      return null;
    }
    const data = (await res.json()) as { item?: Asset };
    return data.item ?? null;
  } catch (err) {
    logPersistFailure(`snapshot create (${assetId})`, null, err);
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

    if (!res.ok) {
      logPersistFailure(`snapshot capture (${itemId})`, res);
      return { posterUrl: null, blob };
    }
    const data = (await res.json()) as { posterUrl?: string };
    return { posterUrl: data.posterUrl ?? null, blob };
  } catch (err) {
    logPersistFailure(`snapshot capture (${itemId})`, null, err);
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

/**
 * Re-downloads an already-saved snapshot's stored image, for the "Download"
 * button on a snapshot that's just being reopened — not created just now.
 * saveSnapshot() only ever downloads at creation time (it has a live Blob
 * from storeSnapshotCapture straight off the renderer), so reopening a
 * snapshot later had no download affordance at all: the inspector's only
 * button for an isSnapshot asset was Delete. The image itself was never
 * missing — storeSnapshotCapture always persists a real posterUrl — this
 * just fetches that same stored file back into a Blob so downloadBlob()
 * can trigger the browser download exactly as it does at save time.
 * Returns false (and lets the caller show its own failure message) rather
 * than throwing, on either a network failure or a placeholder/missing URL.
 */
export async function downloadSnapshotImage(
  posterUrl: string | undefined,
  filename: string,
): Promise<boolean> {
  if (!posterUrl || isPlaceholderPoster(posterUrl)) return false;
  try {
    const res = await fetch(posterUrl);
    if (!res.ok) return false;
    const blob = await res.blob();
    downloadBlob(blob, filename);
    return true;
  } catch {
    return false;
  }
}

export async function deleteSnapshot(itemId: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/boards/default/items/${itemId}`, { method: 'DELETE' });
    if (!res.ok) logPersistFailure(`snapshot delete (${itemId})`, res);
    return res.ok;
  } catch (err) {
    logPersistFailure(`snapshot delete (${itemId})`, null, err);
    return false;
  }
}

/** Persists a snapshot's params. Distinct from persistParams: snapshots
    write to the board item's paramsOverride, not the asset row. Same
    onSaved purpose as persistParams — see that function's doc comment. */
export function persistSnapshotParams(
  itemId: string,
  params: ParamState,
  delay = 500,
  onSaved?: (params: ParamState) => void,
): void {
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

      onSaved?.(payload);

      fetch(`/api/boards/default/items/${itemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ params: payload }),
        keepalive: true,
      })
        .then((res) => {
          if (!res.ok) logPersistFailure(`snapshot params (${itemId})`, res);
        })
        .catch((err) => logPersistFailure(`snapshot params (${itemId})`, null, err));
    }, delay),
  );
}

export function flushSnapshotParams(itemId: string, onSaved?: (params: ParamState) => void): void {
  const key = `snapshot:${itemId}`;
  const timer = timers.get(key);
  const payload = pending.get(key);
  if (!timer || !payload) return;

  clearTimeout(timer);
  timers.delete(key);
  pending.delete(key);

  onSaved?.(payload);

  fetch(`/api/boards/default/items/${itemId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ params: payload }),
    keepalive: true,
  })
    .then((res) => {
      if (!res.ok) logPersistFailure(`snapshot params flush (${itemId})`, res);
    })
    .catch((err) => logPersistFailure(`snapshot params flush (${itemId})`, null, err));
}


/**
 * Persist modulation routing. Debounced like params — dragging a rate slider
 * shouldn't write a row per frame — and routed to the snapshot's own column
 * when the open card is a snapshot.
 */
/**
 * Persist modulation routing. Debounced like params — dragging a rate slider
 * shouldn't write a row per frame. `usesBoardItemPath` — same meaning and
 * same reason as persistParams/persistSnapshotParams: true for a snapshot
 * OR a canonical card the viewer doesn't own (a library asset cloned onto
 * their board), since neither can write to the shared asset row.
 *
 * FIX: previously took only `itemId` and used it for BOTH branches —
 * `/api/boards/default/items/${itemId}` when true, but also
 * `/api/assets/${itemId}` when false, silently reusing the board CARD's
 * id as if it were the underlying asset's real id. Those only happen to
 * be the same value for a snapshot-free, owned canonical card in the
 * common case; the moment they diverge (any card whose itemId isn't
 * literally the asset's own UUID) this 404s. Dormant until now because
 * Modulate only ever appears on shader-type assets, and no asset was
 * ever both genuinely owned by the signed-in viewer AND non-snapshot
 * until uploads/captures existed — see the identical, now-fixed bug in
 * inspectorStore.ts's persist()/flush() for params, which is what
 * surfaced this whole family of latent bugs.
 */
export function persistMod(
  itemId: string,
  assetId: string,
  mod: ModState,
  usesBoardItemPath: boolean,
  delay = 500,
): void {
  const key = `mod:${itemId}`;
  pending.set(key, mod as never);

  const existing = timers.get(key);
  if (existing) clearTimeout(existing);

  const url = usesBoardItemPath
    ? `/api/boards/default/items/${itemId}`
    : `/api/assets/${assetId}`;

  timers.set(
    key,
    setTimeout(() => {
      const payload = pending.get(key);
      timers.delete(key);
      pending.delete(key);
      if (!payload) return;

      fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mod: payload }),
        keepalive: true,
      })
        .then((res) => {
          if (!res.ok) logPersistFailure(`modulation (${itemId})`, res);
        })
        .catch((err) => logPersistFailure(`modulation (${itemId})`, null, err));
    }, delay),
  );
}

/**
 * Persist tile sound configuration. Same debounce/routing shape as
 * persistMod — a Volume slider drag shouldn't write a row per frame any
 * more than a modulation rate slider should. Same itemId/assetId fix as
 * persistMod above, for the identical reason.
 */
export function persistSound(
  itemId: string,
  assetId: string,
  sound: SoundState,
  usesBoardItemPath: boolean,
  delay = 500,
): void {
  const key = `sound:${itemId}`;
  pending.set(key, sound as never);

  const existing = timers.get(key);
  if (existing) clearTimeout(existing);

  const url = usesBoardItemPath
    ? `/api/boards/default/items/${itemId}`
    : `/api/assets/${assetId}`;

  timers.set(
    key,
    setTimeout(() => {
      const payload = pending.get(key);
      timers.delete(key);
      pending.delete(key);
      if (!payload) return;

      fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sound: payload }),
        keepalive: true,
      })
        .then((res) => {
          if (!res.ok) logPersistFailure(`sound (${itemId})`, res);
        })
        .catch((err) => logPersistFailure(`sound (${itemId})`, null, err));
    }, delay),
  );
}

/**
 * Persist the VFX effects chain. Same debounce/routing shape as
 * persistMod/persistSound — dragging a Rate slider inside an effect's
 * inline controls shouldn't write a row per frame any more than a
 * modulation rate slider should. `usesBoardItemPath` — same meaning as
 * every other persist* function here: true for a snapshot or a canonical
 * card the viewer doesn't own, writing to board_items.effects_override
 * instead of the shared assets.effects row. Same itemId/assetId fix as
 * persistMod above, for the identical reason.
 */
export function persistEffects(
  itemId: string,
  assetId: string,
  effects: EffectInstance[],
  usesBoardItemPath: boolean,
  delay = 500,
): void {
  const key = `effects:${itemId}`;
  pending.set(key, effects as never);

  const existing = timers.get(key);
  if (existing) clearTimeout(existing);

  const url = usesBoardItemPath
    ? `/api/boards/default/items/${itemId}`
    : `/api/assets/${assetId}`;

  timers.set(
    key,
    setTimeout(() => {
      const payload = pending.get(key);
      timers.delete(key);
      pending.delete(key);
      if (!payload) return;

      fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ effects: payload }),
        keepalive: true,
      })
        .then((res) => {
          if (!res.ok) logPersistFailure(`effects (${itemId})`, res);
        })
        .catch((err) => logPersistFailure(`effects (${itemId})`, null, err));
    }, delay),
  );
}

/* ------------------------------------------------------------------ *
 * Captured video clips — Video Export Foundation sprint
 * ------------------------------------------------------------------ */

export interface UploadCapturedClipResult {
  ok: boolean;
  asset: Asset | null;
  error?: string;
}

/**
 * Uploads a captured clip and registers it as a real, browsable `video`
 * asset — the exact same sign -> PUT -> ingest flow UploadDialog.tsx's
 * uploadOne() uses for a user-picked file, just driven from a Blob the
 * capture engine produced instead of a file the OS picker returned. Two
 * paths intentionally share this shape rather than diverging: a captured
 * clip should behave identically to any other upload once it lands
 * (same poster generation, same Library uploads filter, same delete
 * affordance in the focused view) — "if seeding works, upload works"
 * (see IMPLEMENTATION_PLAN.md §8), applied here to captures too.
 *
 * Title/tag stamping: filename and the `capture` tag (merged server-side
 * with the existing `upload` tag every registered asset already gets —
 * see app/api/assets/route.ts) rather than a burned-in watermark on the
 * video itself. Mirrors how a snapshot is "tagged" today — through its
 * title and badge, not pixels drawn into the image.
 */
export async function uploadCapturedClip(
  blob: Blob,
  opts: { sourceTitle: string; format: CaptureFormat },
): Promise<UploadCapturedClipResult> {
  const contentType = opts.format === 'mp4' ? 'video/mp4' : 'video/webm';
  const ext = opts.format;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const title = `${opts.sourceTitle} — VML capture — ${stamp}`;
  const filename = `${title}.${ext}`;

  try {
    const signRes = await fetch('/api/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename, contentType, size: blob.size }),
    });

    if (!signRes.ok) {
      const err = (await signRes.json().catch(() => ({}))) as { error?: string };
      return { ok: false, asset: null, error: err.error ?? 'Could not start upload' };
    }

    const signed = (await signRes.json()) as {
      assetId: string;
      uploadUrl: string;
      publicUrl: string;
      headers?: Record<string, string>;
    };

    const put = await fetch(signed.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': contentType, ...(signed.headers ?? {}) },
      body: blob,
    });

    if (!put.ok) {
      logPersistFailure(`capture upload (${signed.assetId})`, put);
      return { ok: false, asset: null, error: `Upload failed (${put.status})` };
    }

    // Same Vercel Blob quirk UploadDialog already works around: the real
    // URL is store-specific and only known from the PUT response body,
    // not predictable from the signed URL alone. Falls back to the
    // guessed publicUrl for local dev, where no such body exists.
    const realUrl = await put
      .json()
      .then((body: { url?: string }) => body.url)
      .catch(() => undefined);

    const ingest = await fetch('/api/assets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        assetId: signed.assetId,
        title,
        contentType,
        srcUrl: realUrl ?? signed.publicUrl,
        tags: ['capture'],
      }),
    });

    if (!ingest.ok) {
      logPersistFailure(`capture ingest (${signed.assetId})`, ingest);
      return { ok: false, asset: null, error: 'Could not add clip to library' };
    }

    const data = (await ingest.json()) as { asset?: Asset };
    return { ok: true, asset: data.asset ?? null };
  } catch (err) {
    logPersistFailure('capture upload', null, err);
    return { ok: false, asset: null, error: 'Unexpected failure uploading clip' };
  }
}
