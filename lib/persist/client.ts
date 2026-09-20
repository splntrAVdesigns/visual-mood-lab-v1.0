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

/* ------------------------------------------------------------------ *
 * The save queue
 *
 * Every tile write (params, snapshot params, modulation, sound, effects) is
 * debounced 500ms, then sent as a PATCH. That debounce used to be the only
 * thing between an edit and a lost edit: the timer lives in the page, so
 * closing the tab, refreshing, or a mobile OS killing the backgrounded app
 * inside that window dropped the change silently. Only `params` had a flush
 * (called when the inspector closed); modulation, sound and effects had none.
 *
 * All five writers now go through queueWrite(), which remembers HOW to send
 * each pending key. That is what makes flushAllPersist() possible: on
 * pagehide / tab-hidden it sends everything still pending, immediately, with
 * keepalive so the request outlives the page.
 * ------------------------------------------------------------------ */

type Sender = (payload: never, onSavedOverride?: (params: ParamState) => void) => void;
const senders = new Map<string, Sender>();

function queueWrite<T>(
  key: string,
  payload: T,
  delay: number,
  send: (payload: T, onSavedOverride?: (params: ParamState) => void) => void,
): void {
  // A newer write for this key supersedes any earlier one that FAILED — drop
  // that failure so a stale retry can never resend old data over new.
  failures.delete(key);

  pending.set(key, payload as never);
  senders.set(key, send as Sender);

  const existing = timers.get(key);
  if (existing) clearTimeout(existing);
  timers.set(key, setTimeout(() => runQueued(key), delay));
  publishStatus();
}

/** Sends `key`'s pending write now. Returns false if nothing was pending. */
function runQueued(key: string, onSavedOverride?: (params: ParamState) => void): boolean {
  const timer = timers.get(key);
  const payload = pending.get(key);
  const send = senders.get(key);

  if (timer) clearTimeout(timer);
  timers.delete(key);
  pending.delete(key);
  senders.delete(key);

  if (payload === undefined || !send) return false;
  send(payload as never, onSavedOverride);
  return true;
}

/** Send every write still waiting out its debounce. Idempotent. */
export function flushAllPersist(): void {
  for (const key of [...timers.keys()]) runQueued(key);
}

/* ------------------------------------------------------------------ *
 * Save-failure tracking
 *
 * A failed save used to leave exactly one trace: a console.error. The person
 * kept editing, believing it was saved, and found out on the next visit. Now
 * a failed write is remembered (with a way to resend it) and published, so
 * the UI can say so — see features/navigation/SaveStatus.tsx.
 * ------------------------------------------------------------------ */

interface FailedWrite {
  label: string;
  /** null = the request never got a response (offline, DNS, blocked). */
  status: number | null;
  retry: () => void;
}

const failures = new Map<string, FailedWrite>();
const statusListeners = new Set<() => void>();

export interface PersistStatus {
  /** How many writes are currently failed and unsaved. */
  failed: number;
  /** At least one failure was a 401 — signing in again is the fix, not retrying. */
  sessionExpired: boolean;
}

const NO_FAILURES: PersistStatus = { failed: 0, sessionExpired: false };
let statusSnapshot: PersistStatus = NO_FAILURES;

function publishStatus(): void {
  const failed = failures.size;
  const sessionExpired = [...failures.values()].some((f) => f.status === 401);

  // useSyncExternalStore needs a referentially stable snapshot between real
  // changes (the same rule track.ts's metaSnapshot documents) — and there's
  // no reason to wake subscribers when nothing changed.
  if (failed === statusSnapshot.failed && sessionExpired === statusSnapshot.sessionExpired) return;
  statusSnapshot = failed === 0 ? NO_FAILURES : { failed, sessionExpired };
  statusListeners.forEach((fn) => fn());
}

export function subscribePersistStatus(fn: () => void): () => void {
  statusListeners.add(fn);
  return () => {
    statusListeners.delete(fn);
  };
}

export function getPersistStatus(): PersistStatus {
  return statusSnapshot;
}

/** Server-render snapshot: nothing has failed before anything has run. */
export function getServerPersistStatus(): PersistStatus {
  return NO_FAILURES;
}

/**
 * Worth retrying automatically: no response at all, a server fault, or the
 * two "try again later" statuses. A 400/404/413 will fail identically forever,
 * and a 401 needs a new session, not a retry.
 */
function isRetryable(status: number | null): boolean {
  return status === null || status >= 500 || status === 408 || status === 429;
}

function recordFailure(key: string, label: string, status: number | null, retry: () => void): void {
  failures.set(key, { label, status, retry });
  publishStatus();
}

/**
 * Resend failed writes. `onlyRetryable` is what the automatic triggers use
 * (back online, tab visible again); the Retry button resends everything.
 */
export function retryFailedPersist(opts: { onlyRetryable?: boolean } = {}): void {
  const entries = [...failures.entries()].filter(([, f]) => !opts.onlyRetryable || isRetryable(f.status));
  for (const [key, f] of entries) {
    failures.delete(key);
    f.retry();
  }
  publishStatus();
}

/**
 * Sends one PATCH and tracks the outcome under `key`. The retry closure
 * re-sends the SAME body without keepalive — it only ever runs while the page
 * is alive, and keepalive bodies are capped at 64KB combined, which a retry
 * shouldn't be subject to.
 */
function sendPatch(
  url: string,
  body: Record<string, unknown>,
  label: string,
  key: string,
  keepalive = true,
): void {
  const retry = () => sendPatch(url, body, label, key, false);

  fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    keepalive,
  })
    .then((res) => {
      if (res.ok) {
        if (failures.delete(key)) publishStatus();
        return;
      }
      logPersistFailure(label, res);
      recordFailure(key, label, res.status, retry);
    })
    .catch((err) => {
      logPersistFailure(label, null, err);
      recordFailure(key, label, null, retry);
    });
}

/**
 * Flush on the way out, and recover on the way back. Mounted once from
 * AppShell (the one component that lives for the whole session — same
 * reasoning as the audio lifecycle listeners next to it).
 *
 *  - pagehide: the reliable "page is going away" event (bfcache-safe).
 *  - visibilitychange -> hidden: the only one mobile browsers reliably fire
 *    when the app is backgrounded, which is when they later kill it.
 *  - visibilitychange -> visible / online: retry what failed while away.
 */
export function attachPersistLifecycle(): () => void {
  const onPageHide = () => flushAllPersist();
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') flushAllPersist();
    else retryFailedPersist({ onlyRetryable: true });
  };
  const onOnline = () => retryFailedPersist({ onlyRetryable: true });

  window.addEventListener('pagehide', onPageHide);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('online', onOnline);
  return () => {
    window.removeEventListener('pagehide', onPageHide);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('online', onOnline);
  };
}

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
  queueWrite(assetId, params, delay, (payload, onSavedOverride) => {
    (onSavedOverride ?? onSaved)?.(payload);
    sendPatch(`/api/assets/${assetId}`, { params: payload }, `params (${assetId})`, assetId);
  });
}

/**
 * Flush any queued save immediately. Called when the inspector closes so a
 * change made a moment before closing is not lost to the debounce window.
 */
export function flushParams(assetId: string, onSaved?: (params: ParamState) => void): void {
  runQueued(assetId, onSaved);
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
  queueWrite(key, params, delay, (payload, onSavedOverride) => {
    (onSavedOverride ?? onSaved)?.(payload);
    sendPatch(`/api/boards/default/items/${itemId}`, { params: payload }, `snapshot params (${itemId})`, key);
  });
}

export function flushSnapshotParams(itemId: string, onSaved?: (params: ParamState) => void): void {
  runQueued(`snapshot:${itemId}`, onSaved);
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
  const url = usesBoardItemPath ? `/api/boards/default/items/${itemId}` : `/api/assets/${assetId}`;
  queueWrite(key, mod, delay, (payload) => {
    sendPatch(url, { mod: payload }, `modulation (${itemId})`, key);
  });
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
  const url = usesBoardItemPath ? `/api/boards/default/items/${itemId}` : `/api/assets/${assetId}`;
  queueWrite(key, sound, delay, (payload) => {
    sendPatch(url, { sound: payload }, `sound (${itemId})`, key);
  });
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
  const url = usesBoardItemPath ? `/api/boards/default/items/${itemId}` : `/api/assets/${assetId}`;
  queueWrite(key, effects, delay, (payload) => {
    sendPatch(url, { effects: payload }, `effects (${itemId})`, key);
  });
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
