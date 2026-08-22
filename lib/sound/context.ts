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

/** Full stop — every connected tile subgraph should have already
    disconnected itself via its own dispose path; this just mutes the
    remaining path defensively (e.g. a global mute toggle). */
export function suspendAudio(): Promise<void> | void {
  return ctx?.suspend();
}
