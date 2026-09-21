// lib/debug/soak-stats.ts
//
// A READ-ONLY stats hook for the soak test (scripts/soak.ts), installed only
// when the page is opened with `?soak=1`. Without that query parameter this
// module does nothing at all — no global, no timers, no listeners.
//
// What it exposes is counts and sizes, never content: how many renderers are
// live, how many GL textures / programs the shared stage holds, how many
// sandbox iframes and canvases are in the document, the DOM size, and the JS
// heap where the browser reports it (Chromium's `performance.memory`, which
// the soak runner unlocks with --enable-precise-memory-info).
//
// It exists so the "focus and blur every tile N times" test can prove — with
// numbers, on the real UI — that a tile that goes away takes its GPU and DOM
// resources with it. Sprint B fixed exactly that leak ("202 textures created,
// 0 freed over 50 tiles"); this is what keeps it fixed.

export interface PoolStats {
  live: number;
  focused: number;
  preview: number;
  /** MAX_LIVE_RENDERERS — the ceiling `live` must never exceed. */
  cap: number;
}

export interface StageStats {
  textureCount: number;
  programCount: number;
  isLost: boolean;
}

export interface SoakStats {
  live: number;
  focused: number;
  preview: number;
  cap: number;
  glTextures: number;
  glPrograms: number;
  glLost: boolean;
  iframes: number;
  canvases: number;
  domNodes: number;
  /** null where the browser does not report it (anything but Chromium). */
  heapMB: number | null;
}

export interface SoakApi {
  version: 1;
  /** `gc: true` asks for a garbage collection first, when the browser exposes one (--js-flags=--expose-gc). */
  stats(opts?: { gc?: boolean }): SoakStats;
}

declare global {
  interface Window {
    __vmlSoak?: SoakApi;
    gc?: () => void;
  }
}

/** True when the query string asks for the hook: `?soak`, `?soak=1`, `?x=1&soak=true`. */
export function soakEnabled(search: string | undefined): boolean {
  try {
    return new URLSearchParams(search ?? '').has('soak');
  } catch {
    return false;
  }
}

export function collectSoakStats(pool: PoolStats, stage: StageStats | null, win: Window): SoakStats {
  const memory = (win.performance as unknown as { memory?: { usedJSHeapSize?: number } } | undefined)?.memory;
  const heap = memory?.usedJSHeapSize;
  return {
    live: pool.live,
    focused: pool.focused,
    preview: pool.preview,
    cap: pool.cap,
    glTextures: stage?.textureCount ?? 0,
    glPrograms: stage?.programCount ?? 0,
    glLost: stage?.isLost ?? false,
    iframes: win.document.querySelectorAll('iframe').length,
    canvases: win.document.querySelectorAll('canvas').length,
    domNodes: win.document.getElementsByTagName('*').length,
    heapMB: typeof heap === 'number' ? Math.round((heap / 1048576) * 10) / 10 : null,
  };
}

/**
 * Installs `window.__vmlSoak` when (and only when) the page was opened with ?soak.
 *
 * This is called at MODULE LOAD (lib/render/pool.ts), so it must never throw:
 * a test harness or shim can provide a `window` with no `location`, and an
 * import-time exception there would take down everything that imports the pool.
 * Anything unexpected simply means "not installed".
 */
export function installSoakStats(poolStats: () => PoolStats, stage: () => StageStats | null, win?: Window): boolean {
  try {
    const target = win ?? (typeof window !== 'undefined' ? window : undefined);
    if (!target || !soakEnabled(target.location?.search)) return false;
    target.__vmlSoak = {
      version: 1,
      stats(opts) {
        if (opts?.gc) {
          try {
            target.gc?.();
          } catch {
            /* no gc exposed — the heap number is simply less precise */
          }
        }
        return collectSoakStats(poolStats(), stage(), target);
      },
    };
    return true;
  } catch {
    return false;
  }
}
