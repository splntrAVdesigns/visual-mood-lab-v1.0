/**
 * Visual Mood Lab — the shared AudioContext.
 *
 * ONE AudioContext for the whole app — same principle as
 * lib/gl/context-pool.ts's single shared WebGL2 stage. Forty tiles each
 * spinning up their own audio graph is the audio-side version of the exact
 * context-exhaustion problem that file exists to solve for rendering.
 *
 * Browsers block audio playback before a genuine user gesture, so the
 * context is created lazily on first call rather than at module load, and
 * unlockAudio() is exposed separately so a caller can explicitly resume it
 * from inside a real click/tap handler. The per-tile "Sound" toggle is
 * expected to be that gesture — see the Phase 4.8 concept doc.
 *
 * Location: lib/sound/context.ts
 */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;

function ensure(): { ctx: AudioContext; master: GainNode } {
  // Mobile bugfix (2026-09), part 2 — a `closed` context used to be
  // treated as "already have one" (this only ever checked `!ctx`, and a
  // closed AudioContext object is still non-null), so every subsequent
  // call kept handing back the same dead object. `createBufferSource()`
  // on a closed context throws synchronously, which is one concrete way
  // "tapped Play, time counter moved, no sound" could happen — the throw
  // needs somewhere to actually get caught (see track.ts's
  // startSourceAt()), but this is the fix that makes recovery possible
  // at all: treat `closed` exactly like "no context yet" and rebuild.
  if (ctx && ctx.state === 'closed') {
    ctx = null;
    master = null;
  }

  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = 1;

    // Peak limiter, sitting between master and the actual output — there
    // was previously nothing here at all: master connected straight to
    // ctx.destination, so anything summing hot (a multi-note chord, a
    // tremolo peak, several tiles' output landing in the same instant)
    // just hard-clipped with zero safety net. DynamicsCompressorNode
    // isn't a true brickwall limiter, but a fast attack + high ratio gets
    // close enough to function as one for this purpose, and it's the
    // standard technique for this in Web Audio — there's no dedicated
    // limiter node in the spec.
    //
    // RETUNED — the first pass (-3dB threshold, ratio 20, hard knee) was
    // too aggressive specifically on percussive material (Grid Snake,
    // Wound Thread's one-shots): drum/impact transients naturally carry
    // high momentary peaks, and grabbing every one of them with a fast,
    // steep, hard-knee limiter reads as audible squashing on exactly the
    // material that most needs its transient punch intact — the pad/drone
    // tiles never got this complaint, which is the tell. Threshold moved
    // up toward true peak (only the genuinely rare excursion should ever
    // engage this), ratio relaxed, and a soft knee added so what limiting
    // does happen eases in rather than switching on hard.
    //
    // This is a safety net, not a substitute for getting each preset's
    // own levels right at the source — see gainTrim on SoundPreset for
    // the per-preset side of that.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -1.5; // dBFS — engages only close to true peak now
    limiter.knee.value = 6; // soft knee — eases in rather than switching on hard
    limiter.ratio.value = 8; // still reads as limiting, without squashing normal transient dynamics
    limiter.attack.value = 0.006; // still fast enough to catch a transient before it clips
    limiter.release.value = 0.3; // slow enough to avoid audible pumping on sustained material

    master.connect(limiter);
    limiter.connect(ctx.destination);
  }
  return { ctx, master: master! };
}

export function getAudioContext(): AudioContext {
  return ensure().ctx;
}

/**
 * The single node every tile's subgraph should connect into, rather than
 * ctx.destination directly. This is what makes one app-wide master
 * volume/mute control possible without every tile's sound preset needing
 * to know that control exists.
 */
export function getMasterGain(): GainNode {
  return ensure().master;
}

/**
 * Call from within a real user-gesture event handler (the per-tile Sound
 * toggle's onClick, or a future header-level "enable audio" action) —
 * AudioContext starts life 'suspended' and browsers refuse to resume it
 * from anywhere that isn't a trusted, synchronous-with-the-gesture call.
 */
export async function unlockAudio(): Promise<void> {
  const { ctx: c } = ensure();
  if (c.state === 'suspended') {
    await c.resume();
  }
}

export function setMasterVolume(volume: number): void {
  getMasterGain().gain.value = Math.max(0, Math.min(1, volume));
}

export function isAudioUnlocked(): boolean {
  return ctx !== null && ctx.state === 'running';
}

/**
 * Mobile bugfix (2026-09), part 2 — last-resort recovery for a context
 * that reports itself as fine (not `closed`, per ensure()'s own check
 * above) but genuinely isn't producing audio, which the Web Audio API
 * gives no reliable way to detect ahead of time. Forces the NEXT
 * getAudioContext()/ensure() call to build a fresh AudioContext (and
 * fresh master/limiter chain) from scratch, rather than trying to keep
 * reusing whatever the current one silently is.
 *
 * Deliberately closes the old context first when possible — leaving a
 * still-open-but-abandoned AudioContext running costs real resources
 * (some platforms cap how many can exist concurrently) — but never lets
 * a failure to close block the rebuild; a caller reaching for this is
 * already in a "something's gone wrong, get back to a known-good state"
 * path, not one where a second failure should compound the first.
 *
 * Callers are expected to rebuild whatever they need (a fresh
 * AudioBufferSourceNode, a fresh MediaStreamSource, etc.) against the
 * new context immediately after — this only clears the slate, it
 * doesn't restart anything on its own.
 */
export function resetAudioContextForRecovery(): void {
  const stale = ctx;
  ctx = null;
  master = null;
  if (stale && stale.state !== 'closed') {
    void stale.close().catch(() => {
      // Already unusable, which is exactly the state we're recovering
      // from — nothing further to do.
    });
  }
}

/** Full stop — every connected tile subgraph should have already
    disconnected itself via its own dispose path; this just mutes the
    remaining path defensively (e.g. a global mute toggle). */
export function suspendAudio(): Promise<void> | void {
  return ctx?.suspend();
}

/* ------------------------------------------------------------------ *
 * Lifecycle — resume on tab/app return.
 *
 * Mobile bugfix (2026-09): the browser can suspend the AudioContext out
 * from under the app — phone locked, tab backgrounded, another app/call
 * takes the audio session — and nothing in this codebase ever asked for
 * it back. `unlockAudio()` above only ever fires from inside a click
 * handler (Play, Sound toggle, a fresh track load); none of those happen
 * automatically just because the tab became visible again. A track whose
 * `playing` flag was already `true` before backgrounding stays marked
 * that way, its source node still technically scheduled, but the shared
 * context sits suspended and nothing is actually reaching the speakers —
 * while getTrackLevel()/getMicLevel()/getMeterLevel() keep reporting
 * whatever the (frozen — Web Audio processing halts while suspended)
 * analyser buffer last held, reading as "still playing" when nothing is
 * audible. See meter.ts/track.ts/mic.ts's isAudioUnlocked() gate for the
 * other half of that fix; this half is what gives the context a chance
 * to actually be running again by the time those get read.
 * ------------------------------------------------------------------ */

let lifecycleAttached = false;

/**
 * Wires a resume-on-return listener for the shared AudioContext. Meant to
 * be called exactly once, from a top-level, always-mounted component
 * (AppShell) — see that file's own useEffect. Idempotent regardless: a
 * second call is a no-op rather than double-registering listeners, so
 * callers don't need to carefully guard against React StrictMode's
 * double-invoke or a future second mount site.
 *
 * Listens on two different signals rather than just `visibilitychange`:
 *   - `visibilitychange` catches the common case (switch tabs, switch
 *     apps, screen lock) on every browser.
 *   - `pageshow` catches bfcache restores specifically — iOS Safari can
 *     restore a page from the back/forward cache without necessarily
 *     running through the same visibility transition every other browser
 *     does, and `event.persisted` is the documented signal for "this
 *     page came back from bfcache," which is exactly the scenario most
 *     likely to have left the AudioContext behind in a suspended (or, in
 *     rarer OS-level interruption cases, unrecoverable) state.
 *
 * Doesn't attempt to resurrect a `closed` context — that only happens in
 * genuinely unrecoverable cases (the OS tore down the audio session
 * entirely) and would require rebuilding the whole shared graph, which
 * is real scope beyond this fix; resume() is a no-op on a closed context
 * regardless, so this stays a safe, silent no-op rather than throwing.
 */
export function attachAudioLifecycleListeners(): () => void {
  if (typeof document === 'undefined') return () => {};
  if (lifecycleAttached) return () => {};
  lifecycleAttached = true;

  const tryResume = () => {
    // Reads the module-level `ctx` directly rather than via ensure() —
    // this must never CREATE a context (a background tab regaining
    // visibility is not a user gesture, and creating-then-immediately-
    // resuming an AudioContext outside a gesture is exactly the pattern
    // browsers block), only resume one that already exists and has
    // simply been suspended.
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      void ctx.resume().catch(() => {
        // Nothing to do — most likely no valid gesture to resume from
        // yet. The next real tap (Play, Sound toggle) still unlocks it
        // via unlockAudio() as before; this listener gets another
        // chance on the next visibility/pageshow event regardless.
      });
    }
  };

  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') tryResume();
  };
  const onPageShow = (e: PageTransitionEvent) => {
    if (e.persisted) tryResume();
  };

  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('pageshow', onPageShow);

  return () => {
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('pageshow', onPageShow);
    lifecycleAttached = false;
  };
}
