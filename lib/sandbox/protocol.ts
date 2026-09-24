/**
 * Message protocol between the host page and the sketch sandbox iframe.
 *
 * The iframe is the security and stability boundary: user code never touches
 * the main thread, so a `while(true)` kills one frame instead of the tab and
 * everything unsaved in it.
 */

export interface HostToSandbox {
  type: 'init' | 'params' | 'event' | 'resize' | 'play' | 'pause' | 'quality' | 'capture' | 'audioWaveform' | 'fonts' | 'vfx-frame';
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
  /**
   * Per-band scalars off this card's own TRACK specifically — bass/mid/
   * high, each auto-gained 0..1 (see lib/sound/track.ts's getTrackBand()
   * doc for the auto-gain reasoning). Deliberately track-only, not
   * track/mic/synth-preset like `waveform` above: mic and the synth
   * preset don't have a per-band split anywhere in this codebase today
   * (lib/sound/mic.ts's getMicBand exists but lib/sound/meter.ts's synth
   * tap only ever exposed a single collapsed level), and the existing
   * Audio — Bass/Mid/High modulation sources already carry the same
   * `requiresTrack: true` restriction in lib/modulation/bus.ts's
   * MOD_SOURCES — this mirrors that same, already-established line
   * rather than drawing a new one. Omitted (not just zeroed) whenever no
   * track is active, so a sketch can tell "no band data" apart from
   * "silence" and fall back to its own non-band-aware behavior, the same
   * way `waveform` being omitted already works.
   */
  bands?: { bass: number; mid: number; high: number };
  /**
   * The full 64-bin frequency array off this card's own active source —
   * track OR mic (unlike `bands` above, which is track-only; both
   * lib/sound/track.ts's getTrackFrequencyData() and lib/sound/mic.ts's
   * getMicFrequencyData() already return this exact shape, so both slot
   * in here with no new engine-level work). Each bin is 0..1, same
   * normalization as `bands`. Omitted (not zeroed) whenever the active
   * source has no frequency data available (the synth-preset case —
   * lib/sound/meter.ts's tap only ever exposed a single collapsed
   * level), so a sketch can fall back the same way it already does for
   * `bands` being absent.
   *
   * Exists for Static Choir's Blocked Bands render style, which buckets
   * these 64 linear bins into log-spaced Hz ranges for a genuine
   * multi-band EQ display — `bands`' fixed 3-way bass/mid/high split
   * doesn't have enough resolution for that. Generic plumbing any sketch
   * can read via p.getAudioSpectrum(), not specific to one tile.
   */
  spectrum?: Float32Array;
  /**
   * Hz per bin in `spectrum` above — i.e. getAudioContext().sampleRate /
   * 128 (the shared analyser's fftSize). Sent alongside `spectrum`
   * rather than assumed on the sandbox side because AudioContext sample
   * rate varies by device/OS (44100 and 48000 are both common) and a
   * sketch bucketing bins into real Hz ranges needs the actual value to
   * do that correctly, not a guess. 0 whenever `spectrum` is omitted.
   */
  spectrumBinHz?: number;
  /**
   * Embedded font files for a `font`-kind control (see
   * renderers/control-schema.ts's FontControl and lib/fonts/manifest.ts),
   * keyed by manifest id, each as a base64 `data:` URL rather than a
   * plain `/fonts/...` path.
   *
   * This frame runs with `sandbox="allow-scripts"` and deliberately
   * WITHOUT `allow-same-origin` (see p5.renderer.ts's iframe setup doc) —
   * it has a null/opaque origin. A plain `fetch('/fonts/...')` from
   * inside it sends an `Origin: null` header, and since the static
   * font files aren't served with an `Access-Control-Allow-Origin`
   * header permitting that, the browser blocks the sandbox from reading
   * the response even though the request itself resolves fine — a
   * same-origin-looking path that actually fails as a cross-origin read.
   * `data:` URLs sidestep this entirely: decoding one never involves a
   * network origin check at all, so it works the same regardless of the
   * frame's own origin. The host (p5.renderer.ts) does the actual
   * `fetch()` — from the real page, not the sandbox, so no origin
   * problem there — converts the result to a data URL, and sends the
   * string across, same as everything else in this protocol.
   *
   * Sent two ways: once per referenced font id inside `init`'s payload
   * (so text renders correctly from first paint), and again via a
   * standalone `fonts`-typed message whenever a `font` control's value
   * changes to an id the sandbox hasn't been sent yet. The sandbox
   * should key its own loaded-font cache by id and treat a repeat send
   * of an id it already has as a no-op.
   */
  fonts?: Array<{ id: string; dataUrl: string }>;
}

export interface SandboxToHost {
  /** Transferable frame, accepted only for an outstanding bounded request. */
  bitmap?: ImageBitmap;
  type: 'ready' | 'schema' | 'error' | 'heartbeat' | 'captured' | 'key' | 'hover' | 'pluck' | 'energy' | 'vfx-frame';
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

/** Missed heartbeats past this and the host tears the frame down.
    Doubled from the original 2000ms — see STALL_RESUME_THRESHOLD_MS's
    doc for why 2000ms wasn't enough safety margin on its own. */
export const HEARTBEAT_TIMEOUT_MS = 4000;
export const HEARTBEAT_INTERVAL_MS = 500;

/**
 * Separate, smaller threshold for the pool's own "did requestAnimationFrame
 * itself just get suspended for the whole tab" detection (see
 * lib/render/pool.ts's tick() and resumeFromStall's doc on
 * AssetRenderer) — deliberately well under HEARTBEAT_TIMEOUT_MS, not
 * the same number.
 *
 * The pool's own rAF-driven tick() and each sandboxed iframe's
 * independent heartbeat-sending setInterval are throttled by the
 * browser separately, not necessarily by the same amount — a native
 * file-picker dialog closing can let the parent tab's rAF resume
 * noticeably sooner than a given iframe's own setInterval catches back
 * up. With both checks sharing one threshold, a dialog held open for a
 * gap that landed just under it could leave the pool concluding nothing
 * stalled (so resumeFromStall() never fires) while that same sandbox's
 * own lastHeartbeat was still stale enough, once its heartbeat did
 * arrive late, to trip the teardown check in render() before anyone
 * re-armed the clock. Triggering resumeFromStall() at a meaningfully
 * lower gap re-arms every sandbox's clock well ahead of the stricter
 * teardown threshold, closing that race regardless of exactly how far
 * apart the two throttling curves happen to drift on a given browser.
 */
export const STALL_RESUME_THRESHOLD_MS = 1200;

/**
 * Cache-busting version for public/sandbox/index.html — see
 * p5.renderer.ts's frame.src, which appends this as a query param.
 * Bump this string (a date is fine — it doesn't need to be sequential or
 * parseable, only different from the last one) any time index.html
 * itself changes, so the browser can't keep serving a stale cached copy
 * that's missing whatever bridge function or protocol change just shipped.
 */
export const SANDBOX_RUNTIME_VERSION = '2026-09-24-vfx-cd';

/**
 * How long to wait after sending `init` before declaring the sketch dead.
 * Generous, because a cold sandbox has to parse ~1MB of p5 first.
 */
export const BOOT_TIMEOUT_MS = 8000;
