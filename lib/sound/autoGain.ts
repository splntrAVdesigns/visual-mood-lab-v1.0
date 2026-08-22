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
 * needs the dynamic range, not the application of it. Rescaling per-band
 * against a slow-decaying peak means a source's own quiet-to-loud dynamics
 * stretch back out toward the full range regardless of its absolute
 * loudness, without a fixed multiplier that would either do nothing for a
 * quiet source or clip constantly on a loud one.
 *
 * Location: lib/sound/autoGain.ts
 */

/** How fast a band's auto-gain peak falls back toward 0, in units per
    second — deliberately much slower than a level meter's own decay (e.g.
    lib/sound/meter.ts's DECAY_PER_SECOND, or track.ts's own
    LEVEL_DECAY_PER_SECOND for its held-peak meter reading). Those hold a
    peak for a visual meter, where a quick decay reads as responsive; this
    one sets the CEILING that modulation depth is measured against, and a
    ceiling that resets every beat would chase the source's own dynamics
    rather than exposing them — every note would briefly clip to "loudest
    thing ever," flattening exactly the swings modulation is supposed to
    make visible. Slow enough to track a song's verse/chorus loudness
    change (or a room going from quiet to someone talking, for Mic), not
    its individual transients. */
const BAND_PEAK_DECAY_PER_SECOND = 0.15;

/** Auto-gain floor. Without this, a genuinely quiet passage (peak near 0)
    divides a small `raw` by an equally small `peak`, and the ratio comes
    out noisy and close to 1 — silence would read as "fully modulated" the
    instant literally anything registers above the noise floor. This keeps
    quiet material reading as quiet, and only lets true loudness fully
    collapse the ceiling toward 1. Same 0..1 normalized units as the band
    values themselves. */
const BAND_PEAK_FLOOR = 0.05;

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/**
 * Holds the peak-with-decay state for one source's set of bands (rms/
 * bass/mid/high, or any other string-keyed band set a future source
 * introduces). One instance per independent signal: track.ts creates one
 * per loaded TrackHandle (each card's track has its own dynamics, so each
 * needs its own peak history), while mic.ts holds a single module-level
 * instance (one shared mic stream for the whole app — see that file's doc
 * for why an app-wide singleton is correct there and per-card would be
 * wrong for track.ts's case).
 */
export class BandAutoGain<Band extends string> {
  private peaks: Partial<Record<Band, number>> = {};
  private ticks: Partial<Record<Band, number>> = {};

  /**
   * Rescales `raw` (0..1) against this band's own recent peak and returns
   * the result, also 0..1. Call once per band per frame that band is
   * actually read — ticks against wall-clock time internally, so a band
   * nobody's currently routed to simply doesn't decay while unread rather
   * than needing its own idle-frame bookkeeping.
   */
  apply(band: Band, raw: number): number {
    const now = performance.now();
    const lastTick = this.ticks[band] ?? now;
    const dt = Math.max(0, (now - lastTick) / 1000);
    this.ticks[band] = now;

    const lastPeak = this.peaks[band] ?? 0;
    const decayed = lastPeak * Math.max(0, 1 - BAND_PEAK_DECAY_PER_SECOND * dt);
    const peak = Math.max(raw, decayed, BAND_PEAK_FLOOR);
    this.peaks[band] = peak;

    return clamp01(raw / peak);
  }

  /** Drops all held peaks — call when the underlying signal restarts (a
      new track loads, the mic stream re-acquires after being fully
      released) so a stale peak from a previous session doesn't suppress
      the new one's early dynamics. */
  reset(): void {
    this.peaks = {};
    this.ticks = {};
  }
}
