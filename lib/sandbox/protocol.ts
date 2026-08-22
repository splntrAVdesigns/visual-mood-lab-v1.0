/**
 * Message protocol between the host page and the sketch sandbox iframe.
 *
 * The iframe is the security and stability boundary: user code never touches
 * the main thread, so a `while(true)` kills one frame instead of the tab and
 * everything unsaved in it.
 */

export interface HostToSandbox {
  type: 'init' | 'params' | 'event' | 'resize' | 'play' | 'pause' | 'quality' | 'capture' | 'audioWaveform';
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
  /**
   * Whether THIS card's own sound engine is actually running right now —
   * see lib/sound/engine.ts's isTileAudioActive(). A sketch that wants to
   * render a real audio-driven trace (Static Choir) switches its drawing
   * mode on this flag rather than inferring it from `waveform` being
   * non-null, so the falling edge (sound just turned off) is an explicit,
   * single message rather than something the sketch has to notice by a
   * buffer going quiet.
   */
  enabled?: boolean;
  /**
   * Current time-domain samples off this card's own sound engine output,
   * roughly -1..1 — the same analyser tap lib/sound/meter.ts already
   * maintains for the Sound panel's level meter, just exposing the raw
   * buffer instead of a single collapsed level. Float32Array clones
   * across postMessage natively (structured clone), so this is sent
   * as-is rather than converted to a plain array. Only meaningful when
   * `enabled` is true; omitted (not just empty) when it isn't, so a
   * sketch can't accidentally read a stale buffer from before sound was
   * switched off.
   */
  waveform?: Float32Array;
}

export interface SandboxToHost {
  type: 'ready' | 'schema' | 'error' | 'heartbeat' | 'captured' | 'key' | 'hover' | 'pluck' | 'energy';
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
  /**
   * Same problem, same fix, for pointer presence instead of keys: the
   * sketch's own canvas already knows whether the pointer is over it
   * (p.mouseX/mouseY, or a plain pointerenter/pointerleave listener on
   * p.canvas), but that knowledge is trapped inside the iframe until the
   * sandbox explicitly forwards it. Used by interaction-gated sound
   * presets (Field Lines' arp only plays while genuinely hovered) — see
   * lib/sound/engine.ts's setTileHovering().
   */
  hovering?: boolean;
  /**
   * Normalized 0..1 position along the tile's x-axis, sent with a `pluck`
   * message. Graze-to-pluck's payload: the sketch fires one of these per
   * line the cursor actually crosses (via the p.pluck(x) bridge injected
   * into the sandbox), and the host maps x onto a pitch — see
   * ArpEngine.pluck() in lib/sound/engines/arp.ts. What x means beyond
   * "normalized position" is entirely the host's business; the protocol
   * itself doesn't know it's pitch.
   */
  x?: number;
  /**
   * Sent with an `energy` message: a continuous 0..1 "how much is the
   * user currently disturbing this tile" signal, for interaction-gated
   * abstract-engine presets (Wound Thread's foley textures, which should
   * be near-silent until the person actually pushes on the thread, not
   * playing continuously the moment Sound is switched on). The sketch
   * computes its own meaning for this — Wound Thread derives it from the
   * physics sim's own current velocity, smoothed — via a p.setEnergy(v)
   * bridge injected into the sandbox, mirroring p.pluck(x)'s pattern in
   * spirit but continuous rather than a discrete event. Forwarded to
   * setTileEnergy() in lib/sound/engine.ts, which no-ops for anything
   * that isn't an AbstractEngine with interactionGated set on its preset.
   */
  energy?: number;
}

/** Missed heartbeats past this and the host tears the frame down. */
export const HEARTBEAT_TIMEOUT_MS = 2000;
export const HEARTBEAT_INTERVAL_MS = 500;

/**
 * Cache-busting version for public/sandbox/index.html — see
 * p5.renderer.ts's frame.src, which appends this as a query param.
 * Bump this string (a date is fine — it doesn't need to be sequential or
 * parseable, only different from the last one) any time index.html
 * itself changes, so the browser can't keep serving a stale cached copy
 * that's missing whatever bridge function or protocol change just shipped.
 */
export const SANDBOX_RUNTIME_VERSION = '2026-08-15-1';

/**
 * How long to wait after sending `init` before declaring the sketch dead.
 * Generous, because a cold sandbox has to parse ~1MB of p5 first.
 */
export const BOOT_TIMEOUT_MS = 8000;
