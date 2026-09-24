// lib/sandbox/validate-message.ts
//
// Runtime validation for messages coming OUT of the sketch sandbox.
//
// The sandbox is a null-origin iframe (sandbox="allow-scripts"), and that
// isolation is real — but the sketch runs in the same JS realm as the runtime
// that talks to the host, so sketch code can call `parent.postMessage(...)`
// directly and say anything. p5.renderer.ts used to accept `e.data` with a
// bare `as SandboxToHost` cast. Three concrete consequences:
//
//   * `key`: re-dispatched as a real host-level KeyboardEvent with ANY string.
//     The sandbox only forwards f / F / Escape, but that allowlist lived on
//     the untrusted side of the boundary. Harmless today (no destructive
//     shortcut exists), a confused-deputy hole the moment one does.
//   * `captured`: `dataUrl` went straight into `fetch(dataUrl)` on the HOST
//     origin. A sketch could return "/api/assets" (or any URL) instead of an
//     image, and the host would fetch it with the person's cookies and treat
//     the response as their captured frame.
//   * `pluck` / `energy` / `fps`: unbounded numbers (NaN, Infinity, 1e308)
//     fed into the audio engines and stats.
//
// This module is the host-side gate: anything that isn't exactly one of the
// documented messages, with in-range fields, is dropped. It returns a NEW
// object built from validated fields only — unknown extra fields never reach
// the handler. Pure function, no DOM.

import type { SandboxToHost } from './protocol';

/**
 * The only keys a sketch may ask the host to receive. Must stay in step with
 * FORWARDED_KEYS in public/sandbox/index.html — that side decides what is
 * SENT, this side decides what is ACCEPTED.
 */
export const SANDBOX_FORWARDED_KEYS: ReadonlySet<string> = new Set(['f', 'F', 'Escape']);

/** A captured frame is a PNG/JPEG/WebP data URL — never a network or same-origin URL. */
const IMAGE_DATA_URL_RE = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

/** Generous for a 4x capture of a large canvas; bounds memory, not legitimate use. */
export const MAX_CAPTURE_DATA_URL_CHARS = 40 * 1024 * 1024;

const MAX_ERROR_MESSAGE = 2000;
const MAX_ERROR_STACK = 4000;
/** The largest seeded sketch declares ~40 controls. */
const MAX_SCHEMA_KEYS = 256;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function finite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function isImageDataUrl(v: unknown): v is string {
  // The length check comes FIRST: running a regex over a 100 MB string the
  // sketch chose to send is itself a way to stall the host.
  return typeof v === 'string' && v.length <= MAX_CAPTURE_DATA_URL_CHARS && IMAGE_DATA_URL_RE.test(v);
}

/**
 * Validates one raw `message` event payload. Returns the sanitised message, or
 * null if it should be ignored — never throws, whatever it is handed.
 */
export function parseSandboxMessage(raw: unknown): SandboxToHost | null {
  try {
    return parse(raw);
  } catch {
    // A structured-cloned postMessage payload is plain data and can't carry a
    // throwing getter, but a validator that is the last line of defence
    // shouldn't lean on that: anything unexpected is simply not a message.
    return null;
  }
}

function parse(raw: unknown): SandboxToHost | null {
  if (!isPlainObject(raw)) return null;

  switch (raw.type) {
    case 'ready':
      return { type: 'ready' };

    case 'schema': {
      // A malformed schema is treated as "no schema" — the host already
      // falls back to the ingest-time scrape when `params` is absent.
      const params = raw.params;
      if (isPlainObject(params) && Object.keys(params).length <= MAX_SCHEMA_KEYS) {
        return { type: 'schema', params };
      }
      return { type: 'schema' };
    }

    case 'error': {
      const message = typeof raw.message === 'string' ? raw.message.slice(0, MAX_ERROR_MESSAGE) : undefined;
      const stack = typeof raw.stack === 'string' ? raw.stack.slice(0, MAX_ERROR_STACK) : undefined;
      return { type: 'error', message, stack };
    }

    case 'heartbeat':
      return {
        type: 'heartbeat',
        fps: finite(raw.fps) ? clamp(raw.fps, 0, 1000) : undefined,
        frame: finite(raw.frame) ? Math.max(0, Math.floor(raw.frame)) : undefined,
      };

    case 'vfx-frame': {
      if (!finite(raw.requestId) || !Number.isSafeInteger(raw.requestId) || raw.requestId < 1) return null;
      if (raw.bitmap == null) return { type: 'vfx-frame', requestId: raw.requestId };
      if (typeof ImageBitmap === 'undefined' || !(raw.bitmap instanceof ImageBitmap)) return null;
      if (raw.bitmap.width < 1 || raw.bitmap.height < 1 || raw.bitmap.width > 2048 || raw.bitmap.height > 2048 || raw.bitmap.width * raw.bitmap.height > 2_097_152) return null;
      return { type: 'vfx-frame', requestId: raw.requestId, bitmap: raw.bitmap };
    }

    case 'captured': {
      if (!finite(raw.requestId) || !Number.isInteger(raw.requestId)) return null;
      // A bad dataUrl still resolves the waiter — with null, i.e. "capture
      // failed" — instead of leaving it hanging until its 3s timeout.
      return { type: 'captured', requestId: raw.requestId, dataUrl: isImageDataUrl(raw.dataUrl) ? raw.dataUrl : undefined };
    }

    case 'key':
      return typeof raw.key === 'string' && SANDBOX_FORWARDED_KEYS.has(raw.key) ? { type: 'key', key: raw.key } : null;

    case 'hover':
      return { type: 'hover', hovering: raw.hovering === true };

    case 'pluck':
      return finite(raw.x) ? { type: 'pluck', x: clamp(raw.x, 0, 1) } : null;

    case 'energy':
      return finite(raw.energy) ? { type: 'energy', energy: clamp(raw.energy, 0, 1) } : null;

    default:
      return null;
  }
}
