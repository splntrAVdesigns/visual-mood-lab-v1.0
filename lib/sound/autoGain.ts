/**
 * Visual Mood Lab — shared per-band auto-gain rescaling.
 *
 * Extracted from lib/sound/track.ts's original getTrackBand(), which had
 * this logic written inline. lib/sound/mic.ts needs the identical math for
 * a second, structurally different source — one shared stream app-wide
 * rather than one buffer per card — and duplicating it there would have
 * meant two copies of the same constants and the same peak/decay formula
 * silently drifting apart the next time either one got retuned. This is
 * now the one place either file needs to change.
 *
 * WHY THIS EXISTS AT ALL: the raw byte-frequency average for typical audio
 * input — music from a Track, or a room's ambient Mic signal, which tends
 * to have an even narrower dynamic range with no preamp — sits low and
 * fairly flat, nowhere near the full 0..1 swing an LFO source produces. A
 * control routed to Audio/Mic and cranked to max Amount would otherwise
 * barely visibly move, even though applyModulation() in control-schema.ts
 * applies the exact same math regardless of source. The signal itself
 * needs the dynamic range, not the application of it.
 *
 * REWRITTEN — the original approach here was ratio-to-recent-peak
 * (raw / decaying-max), and it had a real, proven bug: for any sustained
 * passage whose loudness doesn't swing much frame to frame — which
 * describes most commercially mastered music, compressed and limited to a
 * narrow dynamic range on purpose — the peak tracker chases the current
 * value upward in lockstep with it (peak = max(raw, decayedPeak) is always
 * >= raw, and equals raw almost immediately whenever raw isn't dropping),
 * so the ratio converges to ~1.0 and STAYS there for as long as the
 * passage stays roughly as loud. Verified numerically against realistic
 * low-variance sustained input before rewriting: the old formula held
 * 0.88-1.00 for a signal that only wobbled +/-0.02 around 0.15. Once that
 * pinned-near-1 signal fed into applyModulation()'s
 * `base + (signal - 0.5) * 2 * amount * span`, the result was a narrow,
 * barely-moving band on whatever control was routed to it — reported
 * as "modulation stuck around 0.35-0.39" on Motion Blur, which matches
 * this failure exactly for a plausible amount/base combination.
 *
 * Deviation from a slow-moving BASELINE (not ratio to a fast-chasing
 * PEAK) is the fix — the same mechanism seed/sketches/static-choir.js's
 * Blocked Bands render style already uses and had independently verified
 * for the identical reason, ported here since it turned out to be the
 * more fundamental fix: this is upstream of every audio/mic modulation
 * source AND of the raw band values Ribbon/Particles read directly via
 * getAudioBands(), not something local to one render style. A steady
 * signal naturally centers at "normal" (0.5) against its own baseline,
 * rather than at "maximum" against its own peak — verified against the
 * same sustained low-variance case: genuine wobble in the 0.43-0.59 range
 * instead of pinned 0.88-1.00.
 *
 * Location: lib/sound/autoGain.ts
 */

/** How fast a band's own baseline (its "recent normal", not a ceiling)
    converges toward the current raw value, in fraction-per-second — NOT
    a per-frame constant, since apply() is called at whatever rate each
    consumer happens to call it, not guaranteed to be once per rAF frame.
    ~1.4s to mostly settle after a section change (verse -> chorus), which
    is slow enough that it tracks a song's structure without chasing
    individual transients — those are exactly what should read as
    deviation FROM the baseline, not get absorbed into it. */
const BASELINE_CONVERGE_PER_SECOND = 2.5;

/** How much a deviation from baseline is amplified before being
    recentered at 0.5 — the same role Blocked Bands' own
    BLOCKED_DEVIATION_GAIN plays, tuned independently since this feeds
    general-purpose modulation (any control, any amount) rather than one
    render style's own segment ladder. */
const DEVIATION_GAIN = 4.0;

/** Attack/decay on the shaped OUTPUT, separate from the baseline's own
    convergence above — this is what keeps a genuine transient from
    getting smeared into invisibility while still reading as smooth
    rather than jittery frame to frame. Faster attack than decay, same
    VU-meter-style asymmetry as everywhere else audio reactivity is
    shaped in this codebase. Rates, not per-frame fractions, for the same
    call-rate-independence reason as BASELINE_CONVERGE_PER_SECOND. */
const ATTACK_PER_SECOND = 10;
const DECAY_PER_SECOND = 4;

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/**
 * Holds the baseline-deviation state for one source's set of bands (rms/
 * bass/mid/high, or any other string-keyed band set a future source
 * introduces). One instance per independent signal: track.ts creates one
 * per loaded TrackHandle (each card's track has its own dynamics, so each
 * needs its own baseline history), while mic.ts holds a single module-level
 * instance (one shared mic stream for the whole app — see that file's doc
 * for why an app-wide singleton is correct there and per-card would be
 * wrong for track.ts's case).
 */
export class BandAutoGain<Band extends string> {
  private baselines: Partial<Record<Band, number>> = {};
  private levels: Partial<Record<Band, number>> = {};
  private ticks: Partial<Record<Band, number>> = {};

  /**
   * Rescales `raw` (0..1) against this band's own recent baseline and
   * returns the result, also 0..1, centered at 0.5 for "at its own
   * normal" rather than "silent." Call once per band per frame that band
   * is actually read — ticks against wall-clock time internally, same
   * contract as before, so a band nobody's currently routed to simply
   * doesn't advance its baseline/level while unread rather than needing
   * its own idle-frame bookkeeping.
   */
  apply(band: Band, raw: number): number {
    const now = performance.now();
    const lastTick = this.ticks[band] ?? now;
    const dt = Math.max(0, (now - lastTick) / 1000);
    this.ticks[band] = now;

    const lastBaseline = this.baselines[band] ?? raw;
    const baselineRate = Math.min(1, BASELINE_CONVERGE_PER_SECOND * dt);
    const baseline = lastBaseline + (raw - lastBaseline) * baselineRate;
    this.baselines[band] = baseline;

    const deviation = raw - baseline;
    const target = clamp01(0.5 + deviation * DEVIATION_GAIN);

    const lastLevel = this.levels[band] ?? target;
    const rate = Math.min(1, (target > lastLevel ? ATTACK_PER_SECOND : DECAY_PER_SECOND) * dt);
    const level = lastLevel + (target - lastLevel) * rate;
    this.levels[band] = level;

    return level;
  }

  /** Drops all held baselines/levels — call when the underlying signal
      restarts (a new track loads, the mic stream re-acquires after being
      fully released) so a stale baseline from a previous session doesn't
      suppress or exaggerate the new one's early dynamics. */
  reset(): void {
    this.baselines = {};
    this.levels = {};
    this.ticks = {};
  }
}

