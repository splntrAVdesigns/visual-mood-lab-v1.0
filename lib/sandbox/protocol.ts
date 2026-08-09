/**
 * Message protocol between the host page and the sketch sandbox iframe.
 *
 * The iframe is the security and stability boundary: user code never touches
 * the main thread, so a `while(true)` kills one frame instead of the tab and
 * everything unsaved in it.
 */

export interface HostToSandbox {
  type: 'init' | 'params' | 'event' | 'resize' | 'play' | 'pause' | 'quality' | 'capture';
  source?: string;
  params?: Record<string, unknown>;
  id?: string;
  value?: unknown;
  event?: string;
  width?: number;
  height?: number;
  pixelRatio?: number;
  quality?: 'preview' | 'full';
  requestId?: number;
}

export interface SandboxToHost {
  type: 'ready' | 'schema' | 'error' | 'heartbeat' | 'captured' | 'key';
  params?: unknown;
  message?: string;
  stack?: string;
  fps?: number;
  frame?: number;
  dataUrl?: string;
  requestId?: number;
  /**
   * A keydown the sandbox saw while it held focus. Cross-origin iframe key
   * events never bubble to the host document, so once a person interacts
   * with a sketch (dragging to orbit, clicking the canvas) every subsequent
   * shortcut — F for fullscreen, Escape to close — went nowhere. The
   * sandbox forwards the few keys the host cares about instead.
   */
  key?: string;
}

/** Missed heartbeats past this and the host tears the frame down. */
export const HEARTBEAT_TIMEOUT_MS = 2000;
export const HEARTBEAT_INTERVAL_MS = 500;

/**
 * How long to wait after sending `init` before declaring the sketch dead.
 * Generous, because a cold sandbox has to parse ~1MB of p5 first.
 */
export const BOOT_TIMEOUT_MS = 8000;
