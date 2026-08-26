export const params = {
  staticIntensity:  { kind: 'slider', label: 'Static Intensity', min: 0, max: 1, step: 0.01, default: 0, modulatable: true, hint: 'Grain/roughness on the trace — not the Scanlines toggle below.' },
  waveShape:        { kind: 'select', label: 'Waveform Shape', options: [
                        { label: 'Sine', value: 'SINE' },
                        { label: 'Saw', value: 'SAW' },
                        { label: 'Square', value: 'SQUARE' },
                        { label: 'Triangle', value: 'TRIANGLE' },
                      ], default: 'SINE', hint: 'Idle shape (mock mode only).' },
  // Orthogonal to waveShape above: waveShape is the math the mock
  // generator uses to draw its idle shape; renderStyle is how ANY
  // waveform (mock or live) gets drawn to the screen. Line preserves the
  // exact original behavior byte-for-byte — every other style is new.
  renderStyle:      { kind: 'select', label: 'Render Style', options: [
                        { label: 'Line', value: 'LINE' },
                        { label: 'Mirrored', value: 'MIRRORED' },
                        { label: 'Ribbon', value: 'RIBBON' },
                        { label: 'Particles', value: 'PARTICLES' },
                        { label: 'Radial', value: 'RADIAL' },
                        { label: 'Gradient Bands', value: 'GRADIENT_BANDS' },
                        { label: 'Radial Gradient', value: 'RADIAL_GRADIENT' },
                        { label: 'Blocked Bands', value: 'BLOCKED_BANDS' },
                      ], default: 'LINE' },
  waveAmplitude:    { kind: 'slider', label: 'Wave Amplitude', min: 0, max: 200, step: 1, default: 90, modulatable: true },
  waveFrequency:    { kind: 'slider', label: 'Wave Frequency', min: 0.5, max: 4, step: 0.05, default: 1, modulatable: true, hint: 'Idle oscillator speed (mock mode) or horizontal zoom on the captured buffer (most live styles). On Blocked Bands, this instead controls how fast the columns respond — 1 is the tuned default, lower is more mellow/smoothed, higher is snappier.' },
  harmonicMix:      { kind: 'slider', label: 'Harmonic Mix', min: 0, max: 1, step: 0.01, default: 0.25 },
  layers:           { kind: 'stepper', label: 'Waveform Layers', min: 1, max: 7, step: 1, default: 2, hint: 'How many copies stack, offset from each other.' },
  layerSpread:      { kind: 'slider', label: 'Layer Spread', min: 0, max: 1, step: 0.01, default: 0.3, hint: 'Spacing between stacked layers — on Blocked Bands, this instead spaces the columns apart from each other.' },
  lfoRate:          { kind: 'slider', label: 'LFO Rate', min: 0.02, max: 1, step: 0.01, default: 0.12 },
  glitchFrequency:  { kind: 'slider', label: 'Glitch Frequency', min: 0, max: 1, step: 0.01, default: 0.15, hint: 'Chance per second of a jolt burst.' },
  motionBlur:       { kind: 'slider', label: 'Motion Blur', min: 0, max: 1, step: 0.01, default: 0, modulatable: true, hint: 'Trails recent frames instead of clearing each one.' },
  phosphorGlow:     { kind: 'slider', label: 'Phosphor Glow', min: 0, max: 2, step: 0.01, default: 0, modulatable: true, hint: 'Additive neon glow around the trace.' },
  tint:             { kind: 'color', label: 'Wave Tint', default: { r: 0.85, g: 0.9, b: 0.95, a: 1 } },
  tint2:            { kind: 'color', label: 'Wave Tint 2', default: { r: 0.55, g: 0.35, b: 0.95, a: 1 }, hint: 'Far end of the gradient.', showIf: { equals: ['renderStyle', 'GRADIENT_BANDS'] } },
  tint2Radial:      { kind: 'color', label: 'Wave Tint 2', default: { r: 0.55, g: 0.35, b: 0.95, a: 1 }, hint: 'Outer end of the gradient (or, in Blocked Bands, the high-band color — Wave Tint is the low end).', showIf: { any: [{ equals: ['renderStyle', 'RADIAL_GRADIENT'] }, { equals: ['renderStyle', 'BLOCKED_BANDS'] }] } },
  ribbonThickness:  { kind: 'slider', label: 'Ribbon Thickness', min: 1, max: 24, step: 0.5, default: 10, hint: 'Max width at full amplitude.', showIf: { equals: ['renderStyle', 'RIBBON'] } },
  particleSize:     { kind: 'slider', label: 'Particle Size', min: 1, max: 10, step: 0.5, default: 3, showIf: { equals: ['renderStyle', 'PARTICLES'] } },
  particleSpacing:  { kind: 'stepper', label: 'Particle Spacing', min: 2, max: 16, step: 1, default: 5, unit: 'px', hint: 'Lower is denser.', showIf: { equals: ['renderStyle', 'PARTICLES'] } },
  radialBaseSize:   { kind: 'slider', label: 'Radial Base Size', min: 0.1, max: 0.6, step: 0.01, default: 0.3, hint: 'Resting radius, as a fraction of the tile.', showIf: { equals: ['renderStyle', 'RADIAL'] } },
  radialBaseSizeGradient: { kind: 'slider', label: 'Radial Base Size', min: 0.05, max: 0.4, step: 0.01, default: 0.15, hint: 'Radius of the innermost band.', showIf: { equals: ['renderStyle', 'RADIAL_GRADIENT'] } },
  peakHoldEnabled:  { kind: 'toggle', label: 'Peak Hold', default: true, hint: 'A brief cap that snaps up with each column and falls back slower than the bars themselves, so a transient\u2019s peak stays visible for a moment after it passes.', showIf: { equals: ['renderStyle', 'BLOCKED_BANDS'] } },
  peakFallDelay:    { kind: 'slider', label: 'Peak Fall Delay', min: 0.3, max: 3, step: 0.05, default: 1.4, unit: 's', hint: 'How long the peak-hold cap takes to fall from full height back down to the bar. Higher holds it visible longer.', showIf: { equals: ['renderStyle', 'BLOCKED_BANDS'] } },
  scanlines:        { kind: 'toggle', label: 'Scanlines', default: true, hint: 'Mock mode only.' },
  scanlineColor:    { kind: 'color', label: 'Scanline Color', default: { r: 0, g: 0, b: 0, a: 1 } },
  scanlineWidth:    { kind: 'slider', label: 'Scanline Width', min: 1, max: 8, step: 0.5, default: 3 },
  scanlineMotion:   { kind: 'slider', label: 'Scanline Motion', min: -3, max: 3, step: 0.1, default: 0, hint: 'Negative scrolls up, positive scrolls down.' },
};

function waveValue(shape, x) {
  switch (shape) {
    case 'SAW': {
      const cycle = ((x / (2 * Math.PI)) % 1 + 1) % 1;
      return cycle * 2 - 1;
    }
    case 'SQUARE':
      return Math.sin(x) >= 0 ? 1 : -1;
    case 'TRIANGLE':
      return (2 / Math.PI) * Math.asin(Math.sin(x));
    default: // SINE
      return Math.sin(x);
  }
}

/** Plain linear RGBA lerp for the two-color gradient used by Gradient
    Bands and Radial Gradient. */
function mixColor(a, b, t) {
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
    a: (a.a ?? 1) + ((b.a ?? 1) - (a.a ?? 1)) * t,
  };
}

/**
 * Blocked Bands' fixed band count and edge frequencies — 12 columns,
 * each a real Hz range rather than a fabricated resolution. Log-spaced
 * (roughly a classic 12-band graphic EQ layout, extended slightly at
 * the high end) rather than linear, because the underlying analyser is
 * only 64 bins across the full ~0-22kHz range: linear spacing would
 * cram all twelve columns' worth of visual energy into the first two or
 * three, leaving the rest nearly flat, exactly the opposite of what a
 * real EQ shows and of what "real Hz spectrum" was asked for.
 *
 * Honest limitation, not hidden: at 64 bins across the full ~0-22kHz
 * range (~345Hz per bin at 44.1kHz), every band from 20Hz up through
 * ~2.5kHz gets exactly one real bin — verified numerically at both
 * 44.1kHz and 48kHz before shipping. That's coarser resolution than the
 * edge frequencies below might imply (a "160-315Hz" column is really
 * reading one ~345Hz-wide bin, not a precise 155Hz slice), but each of
 * those low/mid columns still reads a genuinely DIFFERENT bin from its
 * neighbors — verified contiguous and non-overlapping across all 12 —
 * so they move independently, just at coarser precision than the
 * highs, which get progressively more bins per band as the edges widen
 * out (the last band alone covers roughly a third of all 64 bins).
 */
const BLOCKED_BAND_EDGES_HZ = [20, 40, 80, 160, 315, 630, 1000, 1600, 2500, 4000, 6300, 10000, 16000];
const BLOCKED_BAND_COUNT = BLOCKED_BAND_EDGES_HZ.length - 1;
// 16 -> 10: fewer, chunkier segments read as more of the column actually
// filling/emptying with the music rather than mostly-lit all the time.
// 2 -> 5px gap: more visible daylight between segments at rest.
const BLOCKED_SEGMENTS = 10;
const BLOCKED_SEG_GAP = 5;
// Retuned after live testing: attack 0.5->0.8 (snaps up near-instantly
// on a kick/snare hit instead of easing toward it), decay 0.15->0.22
// (falls back a bit quicker too, so the whole thing doesn't read as
// sluggish in either direction), baseline convergence 0.02->0.035
// (settles to a new section's "normal" faster), deviation gain 3.5->4.2
// (more contrast between quiet and loud). Verified against a simulated
// kick-drum transient train plus the same steady/loud anti-pinning
// checks as before shipping — see the conversation for both runs.
const BLOCKED_BASELINE_RATE = 0.035;
const BLOCKED_DEVIATION_GAIN = 4.2;
const BLOCKED_ATTACK = 0.8;
const BLOCKED_DECAY = 0.22;
// Threshold for the silence-jump baseline snap in shapeBlockedBandLevel —
// see its own doc. Low enough that genuine quiet passages (which still
// register some non-zero band energy) don't false-trigger it, high
// enough to reliably catch actual digital silence (a paused/not-yet-
// started track, or true silence between tracks).
const BLOCKED_SILENCE_THRESHOLD = 0.03;

export default function sketch(p, get) {
  let rowOffsets = [];
  let scanScroll = 0;

  // Persistent, frame-to-frame smoothed copy of the live audio buffer —
  // see updateSmoothedAudio()'s doc below for why this exists. Sized and
  // (re)filled lazily on first use since sample count depends on the
  // sound engine's own buffer size, not anything known at sketch setup.
  let smoothedAudio = null;

  // Blocked Bands' own per-column state — 12 independent instances of
  // the SAME baseline-deviation mechanism Radial Spectrum used before
  // it was removed (verified against synthetic signals before
  // shipping; a naive ratio-to-recent-peak scheme was tried first and
  // mathematically pins at max for any steady signal — see
  // shapeBlockedBandLevel's own doc). blockedBandPeakHeights is
  // separate: the peak-hold cap's own slow-falling state, independent
  // of the bar level's attack/decay envelope. blockedBandPrevRaw feeds
  // the silence-jump baseline snap — see shapeBlockedBandLevel's doc.
  let blockedBandBaselines = new Array(BLOCKED_BAND_COUNT).fill(0);
  let blockedBandLevels = new Array(BLOCKED_BAND_COUNT).fill(0);
  let blockedBandPeakHeights = new Array(BLOCKED_BAND_COUNT).fill(0);
  let blockedBandPrevRaw = new Array(BLOCKED_BAND_COUNT).fill(0);
  // Memoized bin-range lookup — see blockedBandRangesFor's own doc.
  let blockedBandRangeCache = { binHz: 0, ranges: null };

  // Glitch is now a real timed burst state, not a per-row coin flip on
  // noise (which was imperceptible — shifting noise sideways barely reads).
  // Shared by both draw paths via advanceGlitch() below, so mock and live
  // modes burst on the identical schedule/feel rather than each having
  // their own slightly-different timing.
  let glitchTimer = 0;
  let glitchStrength = 0;

  p.setup = () => {
    p.createCanvas(p.windowWidth, p.windowHeight);
    p.pixelDensity(1);
    rowOffsets = new Array(Math.ceil(p.height / 2)).fill(0);
  };

  p.windowResized = () => {
    p.resizeCanvas(p.windowWidth, p.windowHeight);
    rowOffsets = new Array(Math.ceil(p.height / 2)).fill(0);
  };

  /** Advances the shared glitch-burst state by one frame and returns
      whether a burst is currently in progress. ~glitchFrequency chance
      per second of a new burst starting once the previous one (if any)
      has fully decayed. Factored out of drawMockWaveform so drawLiveWaveform
      can trigger the identical chromatic RGB-split burst on real audio
      too, rather than reimplementing its own version of "is this a
      glitch frame." */
  function advanceGlitch(glitchFrequency) {
    if (glitchTimer <= 0) {
      if (p.random() < glitchFrequency / 60) {
        glitchTimer = Math.floor(p.random(6, 16));
        glitchStrength = p.random(0.5, 1);
      }
    } else {
      glitchTimer--;
    }
    return glitchTimer > 0;
  }

  /**
   * Shared amplitude sampling for the mock generator, used by every
   * render style — factored out of drawMockWaveform's own Line-mode loop
   * (left untouched below, for zero regression risk on the one style
   * that was already working) so the six new styles can reuse the exact
   * same waveform math without each reimplementing it. Returns a raw
   * pixel-space deviation — NOT yet positioned against a baseline or
   * radius; each render style decides how to place it (vertical offset
   * for Cartesian styles, radial offset for polar ones).
   */
  function mockAmpAt(x, layer, dirSign, fade, opts) {
    const { waveShape, waveAmplitude, waveFrequency, harmonicMix, lfoA, lfoB, glitching, glitchStrength } = opts;
    const t = x * 0.02 * waveFrequency;
    const amp = waveAmplitude * (0.4 + 0.6 * lfoA) * fade;
    const phase = dirSign * p.frameCount * 0.02;
    const fundamental = waveValue(waveShape, t + phase) * amp * 0.5;
    const harmonic = Math.sin(t * 2.3 + dirSign * p.frameCount * 0.013) * amp * 0.25 * lfoB * (0.3 + harmonicMix);
    const grain = (p.noise(x * 0.01, layer * 10 + p.frameCount * 0.01) - 0.5) * amp * 0.2;
    let jolt = 0;
    if (glitching) jolt = (p.noise(x * 0.05, p.frameCount * 0.6, layer) - 0.5) * amp * glitchStrength * 1.4;
    return fundamental + harmonic + grain + jolt;
  }

  /** Same idea as mockAmpAt, for the live audio path — factored out of
      drawLiveWaveform's own sampleY() (also left untouched below) so the
      new styles read the same real trace the same way. `layerIdx`/
      `layerCount` only matter for Gradient Bands/Radial Gradient's
      targeted exception to the mock-only layering rule (see
      drawLiveWaveform's doc comment) — every other live style ignores
      them and reads the single real trace once. */
  /**
   * Raw audio samples plotted directly, frame to frame, is what read as
   * "too reactive"/jittery rather than fluid — real audio is genuinely
   * noisy sample-to-sample, and every polished audio visualizer applies
   * some temporal smoothing for exactly this reason. This is an
   * attack/release-style exponential lerp toward each new raw sample,
   * applied once per frame to a persistent buffer, rather than to any
   * one style's rendering — so every render style benefits identically,
   * and it stays correct regardless of how many times a given style
   * samples the trace per frame.
   *
   * A fixed constant rather than a new exposed control, on the same
   * "keep the Inspector minimal" direction as the recent hint-text
   * pass — 0.4 reads as fluid without feeling laggy/delayed behind the
   * actual audio. Only smooths the real sample itself; grain/glitch stay
   * exactly as sharp as designed; see liveAmpAt below.
   */
  const LIVE_SMOOTHING = 0.4;

  function updateSmoothedAudio(audio) {
    if (!smoothedAudio || smoothedAudio.length !== audio.length) {
      smoothedAudio = Float32Array.from(audio);
      return smoothedAudio;
    }
    for (let i = 0; i < audio.length; i++) {
      smoothedAudio[i] += (audio[i] - smoothedAudio[i]) * LIVE_SMOOTHING;
    }
    return smoothedAudio;
  }

  /**
   * A real hardware oscilloscope doesn't plot whatever's in the buffer
   * starting from wherever the buffer happens to start — it triggers:
   * finds a stable reference point (classically a rising zero-crossing)
   * and starts reading from there every time, so the displayed waveform
   * holds still instead of visibly "swimming" as the audio's phase
   * drifts frame to frame. Static Choir never did this — every style
   * always just read the buffer from index 0, so the actual shape drawn
   * could shift left/right at random relative to what the ear associates
   * with a given beat, even with the temporal smoothing already applied.
   *
   * Searches only the first half of the (already-smoothed) buffer — a
   * genuine trigger just needs A stable nearby starting point, not a
   * scan of the whole thing, and limiting the search keeps this cheap
   * (a plain linear scan, once per frame, not per sample) and keeps the
   * visible window from potentially jumping by a large, jarring amount
   * frame to frame if the "found" crossing were allowed to be far from
   * the start. Falls back to 0 (today's original, unshifted behavior)
   * when no clean rising crossing exists in that range — silence or a
   * DC-biased signal, mainly.
   */
  function findTriggerOffset(audio) {
    const searchLimit = Math.floor(audio.length / 2);
    for (let i = 1; i < searchLimit; i++) {
      if (audio[i - 1] < 0 && audio[i] >= 0) return i;
    }
    return 0;
  }

  function liveAmpAt(x, audio, sampleCount, windowLength, waveAmplitude, staticIntensity, glitching, glitchStrength, layerIdx, layerCount, triggerOffset) {
    const t = x / p.width;
    const rawIdx = Math.min(sampleCount - 1, Math.floor(t * windowLength));
    const idx = (rawIdx + (triggerOffset || 0)) % sampleCount;
    const sample = audio[idx] || 0;
    // 0.9, not the original 0.6 — bumped for visibility. At 0.6 the grain
    // this control adds was easy to miss against a real trace, especially
    // on the filled/thick render styles, which is exactly what read as
    // "doesn't seem to do anything" even though it was genuinely working.
    const grain = staticIntensity > 0
      ? (p.noise(x * 0.05, p.frameCount * 0.05, layerIdx || 0) - 0.5) * staticIntensity * waveAmplitude * 0.9
      : 0;
    let jolt = 0;
    if (glitching) jolt = (p.noise(x * 0.05, p.frameCount * 0.6, layerIdx || 0) - 0.5) * waveAmplitude * glitchStrength * 0.8;
    return sample * waveAmplitude + grain + jolt;
  }

  /**
   * Live-mode-only performance fix for Gradient Bands / Radial Gradient at
   * Waveform Layers > 1: every "layer" in live mode reads the identical
   * one real trace (see drawLiveWaveform's doc on why that's the deliberate
   * exception), so recomputing liveAmpAt from scratch for every layer —
   * each call doing its own p.noise() lookups — was pure waste, and it's
   * exactly what caused "frames start to skip drastically" at higher
   * layer counts: an O(layers x steps) cost for something that only
   * needed to be O(steps). Caching by x (quantized slightly, since the
   * handful of sampling schemes here don't all land on identical x values)
   * means every layer after the first hits the cache instead of
   * recomputing. Only used for the two styles that read layers live —
   * every other style already computes a single trace once, uncached, so
   * there's nothing to cache for them.
   */
  function memoizedAmpFn(baseFn) {
    const cache = new Map();
    return (layerIdx, x) => {
      const key = Math.round(x * 4);
      if (cache.has(key)) return cache.get(key);
      const v = baseFn(0, x);
      cache.set(key, v);
      return v;
    };
  }

  /**
   * Particles and Ribbon's own live-mode dispatch (below) — genuinely
   * different from every other style's "one real signal, N identical
   * offset copies" treatment. Per your direction: these two should read
   * as a real low/mid/high analyzer, each band visibly reacting on its
   * own, rather than the whole shape moving together. Layer 0/1/2 map to
   * bass/mid/high (cycling via modulo if Layers > 3, so nothing above 3
   * goes to waste, though 3 is the meaningful range for "one band per
   * layer" to mean anything); each layer's amplitude gets scaled by
   * that band's own current 0..1 value, on top of — not instead of —
   * the real waveform shape underneath, so a loud bass hit visibly
   * pushes the bass layer bigger while mid/high do their own thing.
   *
   * `bands` is only ever real for track audio (see getAudioBands' own
   * doc) — null for mic/synth-preset audio or no band data at all,
   * in which case every layer's multiplier is exactly 1 and this
   * degrades to the identical global behavior every other style already
   * has, rather than guessing at a fake per-band split from a source
   * that doesn't have one.
   */
  function bandedAmpFn(baseFn, bands) {
    return (layerIdx, x) => {
      const bandName = ['bass', 'mid', 'high'][layerIdx % 3];
      const bandValue = bands ? bands[bandName] : null;
      const mult = bandValue == null ? 1 : (0.3 + 1.4 * bandValue);
      return baseFn(layerIdx, x) * mult;
    };
  }

  /**
   * The six new render styles, each written once and shared by both
   * drawMockWaveform and drawLiveWaveform below — every one takes an
   * `ampFn(layerIdx, x)` callback (mock and live each supply their own,
   * built from mockAmpAt/liveAmpAt above) so the actual drawing code
   * never needs to know or care which mode produced the numbers.
   */

  function renderMirroredLayer(ampFn, layerIdx, midY, dx, color, alpha) {
    p.noStroke();
    p.fill(color.r * 255, color.g * 255, color.b * 255, alpha);
    p.beginShape();
    for (let x = 0; x <= p.width; x += 4) p.vertex(dx + x, midY + ampFn(layerIdx, x));
    for (let x = p.width; x >= 0; x -= 4) p.vertex(dx + x, midY);
    p.endShape(p.CLOSE);
    p.beginShape();
    for (let x = 0; x <= p.width; x += 4) p.vertex(dx + x, midY - ampFn(layerIdx, x));
    for (let x = p.width; x >= 0; x -= 4) p.vertex(dx + x, midY);
    p.endShape(p.CLOSE);
  }

  // A true variable-width ribbon needs to be one filled polygon whose
  // local thickness changes, not a sequence of separately-stroked
  // segments (which leaves visible gaps/kinks at the joins) — so this
  // builds an upper and lower edge offset from the centerline curve by
  // half the local thickness, then fills between them in one shape.
  function renderRibbonLayer(ampFn, layerIdx, midY, dx, color, alpha, waveAmplitude, maxThickness) {
    const pts = [];
    for (let x = 0; x <= p.width; x += 4) {
      const amp = ampFn(layerIdx, x);
      const norm = waveAmplitude > 0 ? Math.min(1, Math.abs(amp) / waveAmplitude) : 0;
      const half = Math.max(0.5, norm * maxThickness) / 2;
      pts.push({ x, y: midY + amp, half });
    }
    p.noStroke();
    p.fill(color.r * 255, color.g * 255, color.b * 255, alpha);
    p.beginShape();
    for (const pt of pts) p.vertex(dx + pt.x, pt.y - pt.half);
    for (let i = pts.length - 1; i >= 0; i--) p.vertex(dx + pts[i].x, pts[i].y + pts[i].half);
    p.endShape(p.CLOSE);
  }

  // Batched point rendering — same technique as Strange Attractor's own
  // performance rework (one beginShape(POINTS)/endShape per layer,
  // instead of a separate draw call per particle).
  function renderParticlesLayer(ampFn, layerIdx, midY, dx, color, alpha, spacing, size) {
    p.stroke(color.r * 255, color.g * 255, color.b * 255, alpha);
    p.strokeWeight(size);
    p.beginShape(p.POINTS);
    for (let x = 0; x <= p.width; x += spacing) p.vertex(dx + x, midY + ampFn(layerIdx, x));
    p.endShape();
  }

  // Folds the waveform into a closed polar loop instead of an open
  // horizontal line. The one real wrinkle: a live audio buffer's first
  // and last samples don't necessarily match, so the 0deg/360deg join
  // could show a visible seam. Blending the last `blendSamples` samples
  // back toward the first ones guarantees a clean loop regardless of
  // what the live buffer looks like, rather than hoping the discontinuity
  // happens to be small.
  // `postProcess`, applied to each raw sample BEFORE the seam-blend below,
  // exists specifically because of a subtle bug: renderRadialGradientLayer
  // used to clamp negative deviations to 0 AFTER blending, but clamping is
  // a nonlinear operation — two blended-to-be-close values straddling zero
  // can clamp to visibly different results, reintroducing exactly the seam
  // this function exists to remove. Clamping (or any other transform) has
  // to happen before the blend, not after, for the blend to guarantee
  // continuity in the values actually being drawn.
  function radialSamples(ampFn, layerIdx, steps, postProcess) {
    // Widened from steps*0.08 (capped 16) to steps*0.18 (capped 30), and
    // switched from a straight linear ramp to a smoothstep ease. An
    // 8-sample linear blend wasn't wide enough to fully hide the seam
    // against a genuinely jagged waveform — high Harmonic Mix / Wave
    // Frequency can put a real, sharp discontinuity right at the wrap
    // point that a short linear fade doesn't smooth over completely.
    // Both changes are strictly more forgiving, not a different
    // mechanism from before.
    const blend = Math.min(30, Math.floor(steps * 0.18));
    const raw = new Array(steps);
    for (let i = 0; i < steps; i++) {
      const v = ampFn(layerIdx, (i / steps) * p.width);
      raw[i] = postProcess ? postProcess(v) : v;
    }
    for (let k = 0; k < blend; k++) {
      // Blends the tail toward raw[0] specifically, not raw[k] — the
      // previous version paired the tail sample with the k-th HEAD
      // sample as a moving target through the blend window, which
      // smooths the general shape of the transition but never actually
      // targets the one point that has to match: index 0, the thing
      // index steps-1 is adjacent to once the ring wraps. That's why
      // this kept showing a real gap through several earlier attempts
      // at "widen the blend" or "fix the clamp order" — those all
      // smoothed the approach without fixing what it was approaching.
      // Verified numerically before shipping this time: with the target
      // fixed to raw[0], the gap between raw[steps-1] and raw[0] comes
      // out to exactly 0, not just small.
      const t = blend > 1 ? k / (blend - 1) : 1;
      const w = t * t * (3 - 2 * t); // smoothstep, 0 at the start of the blend zone, 1 at the very last sample
      const idxEnd = steps - blend + k;
      raw[idxEnd] = raw[idxEnd] * (1 - w) + raw[0] * w;
    }
    return raw;
  }

  /**
   * Radial and Radial Gradient's own amplitude scale — decouples the
   * visual deviation from the raw Wave Amplitude pixel value (tuned for
   * a several-hundred-pixel-wide flat canvas) and ties it to the shape's
   * own base radius instead. Radial Base Size defaults well under half
   * the tile, so a Wave Amplitude sized for the flat styles could be
   * several times the size of the circle it's decorating — every
   * legitimate waveform detail read as wild, asymmetric chaos at that
   * mismatch, which is what "erratic, not symmetric" actually was, not
   * a rendering bug. 0.55 means the shape can bulge up to just over half
   * its own resting radius outward at the loudest point — plenty of
   * visible reactivity without the shape ever losing its basic
   * roundness. A fixed constant, not a new control, same reasoning as
   * LIVE_SMOOTHING above.
   */
  function radialScale(raw, baseRadius, waveAmplitude) {
    const maxDeviation = baseRadius * 0.55;
    return waveAmplitude > 0 ? raw * (maxDeviation / waveAmplitude) : 0;
  }

  // Pure drawing from an already-computed sample array — no sampling work
  // of its own. Split out from renderRadialLayer() specifically so live
  // mode can call radialSamples() ONCE per frame and reuse the same array
  // across every layer, instead of every layer separately re-running the
  // full sample-and-blend pass on what is, in live mode, the identical
  // underlying signal every time (see drawLiveWaveform's RADIAL/
  // RADIAL_GRADIENT dispatch below). That per-layer re-sampling was the
  // actual bottleneck behind "Radial gets sluggish with Layers > 1" —
  // the per-value lookup was already cached, but the 100+ iteration
  // array-build-and-blend around it wasn't, and was being redone from
  // scratch on every one of up to 10 layers, every frame.
  function drawRadialRing(raw, steps, baseRadius, ccx, ccy, color, alpha, weight) {
    p.noFill();
    p.stroke(color.r * 255, color.g * 255, color.b * 255, alpha);
    p.strokeWeight(weight);
    p.beginShape();
    for (let i = 0; i < steps; i++) {
      const angle = (i / steps) * p.TWO_PI;
      const r = baseRadius + raw[i];
      p.vertex(ccx + Math.cos(angle) * r, ccy + Math.sin(angle) * r);
    }
    p.endShape(p.CLOSE);
  }

  // Mock-mode-facing wrapper — mock's own layers are genuinely
  // phase-varied per layer (unlike live's identical-trace-per-layer
  // case), so mock still needs its own real radialSamples() call per
  // layer; this just keeps that call site's signature exactly as it was.
  function renderRadialLayer(ampFn, layerIdx, baseRadius, waveAmplitude, ccx, ccy, color, alpha, weight) {
    const steps = 110;
    // Clamped to only ever deviate outward from baseRadius, never inward
    // — unclamped, the outline could bulge both larger and smaller than
    // baseRadius from sample to sample, which is what read as "erratic,
    // bounces all over the tile" instead of a controlled shape reacting
    // outward from a stable resting circle. radialScale (see its own
    // doc) is what keeps that bulge proportional to the shape's own
    // size, on top of the outward-only clamp.
    const raw = radialSamples(ampFn, layerIdx, steps, v => radialScale(Math.max(0, v), baseRadius, waveAmplitude));
    drawRadialRing(raw, steps, baseRadius, ccx, ccy, color, alpha, weight);
  }

  function renderGradientBandLayer(ampFn, layerIdx, layerCount, midY, dx, colorNear, colorFar, alpha) {
    const t = layerCount > 1 ? layerIdx / (layerCount - 1) : 0;
    const col = mixColor(colorNear, colorFar, t);
    p.noStroke();
    p.fill(col.r * 255, col.g * 255, col.b * 255, alpha);
    p.beginShape();
    for (let x = 0; x <= p.width; x += 4) p.vertex(dx + x, midY + ampFn(layerIdx, x));
    for (let x = p.width; x >= 0; x -= 4) p.vertex(dx + x, midY);
    p.endShape(p.CLOSE);
  }

  /**
   * Full redesign, replacing the old ring-per-layer approach entirely.
   * Three problems fixed together, since they all came from the same
   * structure:
   *
   * 1. "Radial Gradient looks basically the same as Radial, just
   *    filled" — both anchored to a base circle with outward-only
   *    bulges; the only difference was stroke vs fill. This version's
   *    center-disc-plus-soft-halo look (below) is what actually made
   *    the two visually distinct originally, before the seam-fix
   *    rounds regressed it.
   * 2. "Solid color, not a gradient" — each band used to get ONE flat
   *    interpolated color computed per layer (mixColor), never an
   *    actual gradient. This builds one real Canvas2D radial gradient
   *    and every layer's pass shares that same gradient object — a
   *    genuine continuous blend from Wave Tint at the center to Wave
   *    Tint 2 at the outer edge, not steps.
   * 3. "Layers fragments into separate rings instead of one shape" —
   *    the old version gave each layer its own fully-opaque, widely-
   *    spaced ring. This draws every layer as a semi-transparent pass
   *    of the SAME shape, offset from center by only a small fraction
   *    of baseRadius, so they overlap heavily and accumulate into one
   *    denser, softer halo as Layers increases.
   *
   * Built with the RAW Canvas2D path API (ctx.beginPath/lineTo/fill)
   * rather than p5's beginShape/vertex/endShape wrapper — this is what
   * fixed a real "renders nothing at all" bug, not a style preference.
   * p5's own shape renderer tracks its own internal fill state
   * (set via p.fill()/p.noFill()) and applies that when endShape()
   * actually calls the underlying fill — since this function only ever
   * set `drawingContext.fillStyle` directly and never called p.fill(),
   * p5 had nothing telling it "yes, fill this shape," so the gradient
   * silently never painted regardless of what fillStyle held. Talking
   * to the canvas context directly sidesteps that entirely: what's set
   * on `ctx` is exactly what gets used, no intermediate state to get
   * out of sync with. Save/restore also moved outside the per-layer
   * loop (fillStyle/globalAlpha are constant across every layer here),
   * which is a real, if secondary, performance win in its own right.
   *
   * `sampleLayer(i)` returns that layer's own raw sample array — for
   * live mode this can return the same already-computed array every
   * time (every layer reads the identical real trace), for mock mode it
   * computes each layer's own phase-varied samples, matching every
   * other style's mock behavior.
   */
  function drawRadialGradientHalo(sampleLayer, steps, layerCount, baseRadius, layerSpread, ccx, ccy, colorNear, colorFar) {
    const maxDeviation = baseRadius * 0.55;
    const ctx = p.drawingContext;
    // Guaranteed minimum gap before the outer edge is even allowed to
    // approach the flat inner edge — reintroduced after this function's
    // "overlapping halo passes" rewrite dropped it, which silently
    // brought back the exact zero-width-pinch bug an earlier round
    // fixed: outer = ringBase + raw[k] with raw[k] clamped to >= 0 means
    // every angle where the real deviation is 0 collapses outer and
    // inner to the identical radius — a real hole in the shape, not a
    // thin seam, which is what was still showing up. A constant gap
    // that's always present regardless of the signal keeps that
    // collapse structurally impossible, the same fix as before.
    const minGap = Math.max(4, baseRadius * 0.06);

    // Gradient stops now tied to the ring's own actual visible geometry,
    // not an arbitrary wider span. The previous version ran the
    // gradient from baseRadius*0.4 out to baseRadius+maxDeviation — a
    // much bigger radius range than the ring itself ever occupies (the
    // ring's true inner edge sits up near `baseRadius`, well past that
    // 0.4 inner stop, and the inner-circle cutout below removes
    // everything closer in than that anyway). The visible band only
    // ever sampled a thin outer slice of that gradient's total
    // transition, which is why it read as flat/solid instead of a real
    // gradient. Reported as "should have an actual color gradient in
    // it" — the gradient existed, it just never had room to visibly
    // transition across the shape actually being filled.
    //
    // layerOffset's own range (see the per-layer loop below) is
    // symmetric, +/- baseRadius*0.15*layerSpread at the two extremes —
    // computing that same bound here means the gradient's stops cover
    // every layer's own ring, from the innermost layer's inner edge out
    // to the outermost layer's peak deviation, so the full color
    // transition is visible across whichever layers are actually drawn
    // rather than being computed per layer (one shared gradient reused
    // across the loop stays cheap regardless of layer count).
    const maxLayerOffsetAbs = layerCount > 1 ? baseRadius * 0.15 * layerSpread : 0;
    const gradientInner = Math.max(0, baseRadius - maxLayerOffsetAbs + minGap);
    const gradientOuter = baseRadius + maxLayerOffsetAbs + minGap + maxDeviation;
    const gradient = ctx.createRadialGradient(
      ccx, ccy, gradientInner,
      ccx, ccy, gradientOuter,
    );
    gradient.addColorStop(0, `rgba(${colorNear.r * 255}, ${colorNear.g * 255}, ${colorNear.b * 255}, ${colorNear.a})`);
    gradient.addColorStop(1, `rgba(${colorFar.r * 255}, ${colorFar.g * 255}, ${colorFar.b * 255}, ${colorFar.a})`);

    // Passes get proportionally lighter as Layers goes up, so the total
    // accumulated density in the middle of the stack stays roughly
    // constant instead of the whole halo just getting flatly brighter —
    // floor of 35 keeps a single layer (Layers = 1) clearly visible.
    // The LAST layer drawn (i === layerCount - 1, the one that ends up
    // on top since later draws composite over earlier ones) stays fully
    // solid instead — reported as "top layer should remain solid, no
    // transparency" — so there's always one crisp, fully-opaque ring
    // anchoring the shape regardless of how many trailing/fainter
    // layers sit behind it.
    const passAlpha = Math.max(35, Math.round(150 / Math.max(1, layerCount)));
    ctx.save();
    ctx.fillStyle = gradient;
    for (let i = 0; i < layerCount; i++) {
      const raw = sampleLayer(i);
      const layerOffset = layerCount > 1 ? (i / (layerCount - 1) - 0.5) * baseRadius * 0.3 * layerSpread : 0;
      const ringBase = baseRadius + layerOffset;
      ctx.globalAlpha = i === layerCount - 1 ? 1 : passAlpha / 255;
      ctx.beginPath();
      // Outer boundary — its own fully closed loop, not one continuous
      // path stitched together with the inner edge. That distinction is
      // the actual fix: the previous version built ONE path that walked
      // the outer edge (k=0..steps-1), then capped straight down to the
      // inner radius, then walked the inner circle back around — which
      // left the small angular gap between the LAST outer sample and
      // the FIRST outer sample (2π/steps wide, however small) with no
      // outer-edge segment covering it at all. That gap was a genuine
      // geometric notch cut into the ring, completely independent of
      // whether raw[steps-1] and raw[0] happened to match numerically —
      // which is exactly why matching them still left a visible seam.
      for (let k = 0; k < steps; k++) {
        const angle = (k / steps) * p.TWO_PI;
        const r = ringBase + minGap + raw[k];
        const x = ccx + Math.cos(angle) * r;
        const y = ccy + Math.sin(angle) * r;
        if (k === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      // Inner boundary — a second, independent closed loop (a perfect
      // circle, no deviation), wound in the opposite direction so the
      // canvas's default nonzero-winding fill rule treats it as a hole
      // subtracted from the outer loop, rather than the two being
      // welded into one path with a seam between them. Two genuinely
      // separate closed shapes have no shared wrap point to get wrong —
      // there's no "the last sample must equal the first sample"
      // condition left to satisfy, because there's no seam left at all.
      for (let k = steps; k >= 0; k--) {
        const angle = (k / steps) * p.TWO_PI;
        const x = ccx + Math.cos(angle) * ringBase;
        const y = ccy + Math.sin(angle) * ringBase;
        if (k === steps) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  /**
   * Converts BLOCKED_BAND_EDGES_HZ into actual bin-index ranges against
   * the spectrum's real bin width (spectrumBinHz — device sample rate
   * dependent, see protocol.ts's doc), then forces the ranges to be
   * non-overlapping and at least 1 bin wide. Straight Hz-to-bin division
   * alone isn't enough: at low frequencies several consecutive edges all
   * round to bin 0 (see BLOCKED_BAND_COUNT's own doc on why), which
   * without this pass would make two or three "different" bands read
   * the identical bin and move in perfect lockstep — indistinguishable
   * from a bug even though it's really a resolution limit. Forcing each
   * band to start where the previous one ended keeps every column tied
   * to a genuinely distinct (if sometimes single-bin) slice of the real
   * spectrum. The last band always extends to the end of the array
   * rather than stopping at its nominal 16kHz edge, so the remaining
   * high-frequency bins aren't left completely unused.
   *
   * Memoized against the last binHz seen — this only needs recomputing
   * if the audio context's sample rate itself changes mid-session, which
   * in practice never happens once a context exists.
   */
  function blockedBandRangesFor(binHz, totalBins) {
    if (blockedBandRangeCache.ranges && blockedBandRangeCache.binHz === binHz) {
      return blockedBandRangeCache.ranges;
    }
    const ranges = [];
    let prevEnd = 0;
    for (let i = 0; i < BLOCKED_BAND_COUNT; i++) {
      const loHz = BLOCKED_BAND_EDGES_HZ[i];
      const hiHz = BLOCKED_BAND_EDGES_HZ[i + 1];
      let start = Math.max(prevEnd, Math.round(loHz / binHz));
      let end = i === BLOCKED_BAND_COUNT - 1 ? totalBins : Math.round(hiHz / binHz);
      start = Math.min(start, totalBins - 1);
      end = Math.min(Math.max(end, start + 1), totalBins);
      ranges.push([start, end]);
      prevEnd = end;
    }
    blockedBandRangeCache = { binHz, ranges };
    return ranges;
  }

  /** Averages the real spectrum's bins within each band's range into one
      0..1 value per column — the actual "how loud is this Hz range right
      now" read, before any of shapeBlockedBandLevel's smoothing. */
  function sampleBlockedBands(spectrum, ranges) {
    const out = new Array(ranges.length);
    for (let i = 0; i < ranges.length; i++) {
      const [from, to] = ranges[i];
      let sum = 0;
      const end = Math.min(to, spectrum.length);
      for (let b = from; b < end; b++) sum += spectrum[b];
      out[i] = sum / Math.max(end - from, 1);
    }
    return out;
  }

  /**
   * Per-column reactivity — 12 independent instances of the exact
   * mechanism Radial Spectrum used to ship (baseline-deviation, not
   * ratio-to-peak). This isn't the simpler "direct mapping" originally
   * asked for: a plain ratio against a recent-peak reference was tried
   * first and verified numerically to pin at max for any steady signal
   * (a mathematical property of that approach, not a tuning miss — a
   * value normalized against its OWN recent peak always converges
   * toward a ratio of 1). Deviation from a slow-moving baseline is the
   * one mechanism that's actually been proven against synthetic signals
   * before shipping, per your go-ahead. The exact same bug, in the exact
   * same shape, turned out to also be live in lib/sound/autoGain.ts —
   * see that file's rewritten doc for the full story.
   *
   * `gainMultiplier` is Wave Amplitude's real, new job on this render
   * style — see the BLOCKED_BANDS branches' own comments. `speedMultiplier`
   * is Wave Frequency's: scales the attack/decay RATE, not the deviation
   * gain, so amplitude and frequency stay two genuinely independent
   * knobs — contrast vs. responsiveness — rather than both doing a
   * version of "more reactive." Both default to 1 (today's tuned
   * baseline) when omitted, so nothing else calling this needs to
   * change. Clamped to 1 at the top end since a rate above 1 has no
   * further meaning for a per-frame lerp fraction.
   *
   * SILENCE-JUMP SNAP: reported as every column shooting to peak height
   * for the first second or two whenever a track starts playing, then
   * settling into normal behavior. Root cause, verified numerically
   * before fixing: the baseline starts at (or decays down to, during
   * any lead-in silence) ~0, so the moment real audio begins, `raw`
   * jumps to something like 0.3 while `baseline` is still ~0 — a huge
   * apparent deviation that reads as "louder than anything recently
   * seen," clamping every column to max. Because the baseline only
   * converges at BLOCKED_BASELINE_RATE, that false deviation doesn't
   * clear for as long as it takes baseline to catch up — the exact
   * ~1-2s spike duration reported. The fix is narrowly targeted rather
   * than just converging the baseline faster everywhere (which would
   * also dull genuine mid-song dynamics): if the PREVIOUS raw sample
   * was near-silence and this one clearly isn't, that's a clean,
   * one-time "playback just started/resumed" signal — nothing in normal
   * musical dynamics looks like this, since a real transient never
   * follows literal silence the way a track's first frame does. Only in
   * that specific case does the baseline snap straight to the new
   * value instead of slow-converging toward it; every other frame
   * behaves exactly as before, including real kick/snare transients
   * mid-song (verified numerically alongside the startup fix).
   */
  function shapeBlockedBandLevel(idx, rawValue, gainMultiplier, speedMultiplier) {
    const wasSilent = blockedBandPrevRaw[idx] < BLOCKED_SILENCE_THRESHOLD;
    const jumpedUp = rawValue > BLOCKED_SILENCE_THRESHOLD * 2;
    if (wasSilent && jumpedUp) {
      blockedBandBaselines[idx] = rawValue;
    } else {
      blockedBandBaselines[idx] += (rawValue - blockedBandBaselines[idx]) * BLOCKED_BASELINE_RATE;
    }
    blockedBandPrevRaw[idx] = rawValue;
    const deviation = rawValue - blockedBandBaselines[idx];
    const gain = BLOCKED_DEVIATION_GAIN * (gainMultiplier ?? 1);
    const target = Math.max(0, Math.min(1, 0.5 + deviation * gain));
    const current = blockedBandLevels[idx];
    const baseRate = target > current ? BLOCKED_ATTACK : BLOCKED_DECAY;
    const rate = Math.max(0, Math.min(1, baseRate * (speedMultiplier ?? 1)));
    blockedBandLevels[idx] = current + (target - current) * rate;
    return blockedBandLevels[idx];
  }

  /**
   * The peak-hold cap's own state — separate from the bar level's own
   * attack/decay envelope above. Snaps up instantly to match a new
   * high, then falls back on its own clock, independent of how fast the
   * bar itself is currently moving — that gap between the two is the
   * whole point: it's what keeps a transient's peak position visible
   * for a moment after the bar has already started easing back down.
   *
   * `fallSpeed` here is still units-per-second internally (how this
   * function has always worked), but the control the person actually
   * turns — Peak Fall Delay — is framed the opposite way, as seconds to
   * fall from full height to empty. Reported testing found the original
   * "speed" framing backwards in practice: real music constantly
   * re-triggers the cap upward before a fast fall setting ever gets a
   * chance to visibly separate from the bar, so higher settings read as
   * "no falling happening at all" even though the math was doing exactly
   * what it said. The call sites convert seconds -> units/second
   * (1 / delaySeconds) right where they read the control, so this
   * function's own contract doesn't need to change, only what feeds it.
   */
  function updateBlockedBandPeak(idx, level, fallSpeed, dt) {
    const current = blockedBandPeakHeights[idx];
    blockedBandPeakHeights[idx] = level >= current ? level : Math.max(level, current - fallSpeed * dt);
    return blockedBandPeakHeights[idx];
  }

  /** One column: a 16-segment LED ladder, same segmented-block language
      as Radial Spectrum's bars (transparent below the current level, no
      dim "ghost" segments), lit bottom-up from the shared baseline. The
      peak-hold cap, when enabled, draws as a brighter short bar floating
      at its own independently-decaying height above the lit segments. */
  function drawBlockedBandColumn(ctx, x, colWidth, baselineY, maxHeight, level, peakLevel, color, showPeak) {
    const segments = BLOCKED_SEGMENTS;
    const segGap = BLOCKED_SEG_GAP;
    const segHeight = (maxHeight - segGap * (segments - 1)) / segments;
    if (segHeight <= 0) return;
    for (let s = 0; s < segments; s++) {
      const segFrom = s / segments;
      const segTo = (s + 1) / segments;
      if (level <= segFrom) continue;
      const alphaMul = level >= segTo ? 1 : (level - segFrom) / (segTo - segFrom);
      const segTop = baselineY - (s + 1) * (segHeight + segGap) + segGap;
      ctx.fillStyle = `rgba(${color.r * 255}, ${color.g * 255}, ${color.b * 255}, ${(color.a ?? 1) * alphaMul})`;
      ctx.fillRect(x, segTop, colWidth, segHeight);
    }
    if (showPeak && peakLevel > 0.02) {
      const peakY = baselineY - peakLevel * maxHeight;
      ctx.fillStyle = `rgba(${color.r * 255}, ${color.g * 255}, ${color.b * 255}, 0.95)`;
      ctx.fillRect(x, peakY - 2.5, colWidth, 3);
    }
  }

  /** The mirrored translucent "shadow" below the baseline — literally
      the same segment ladder as the column above it, flipped downward
      and drawn at reduced alpha, no peak cap (a reflection of the peak
      indicator would read as a second, confusing signal rather than
      decoration). Drawn from the SAME level as the real column, not a
      separately-computed one, so it's always an honest mirror of what's
      actually above it, never its own thing drifting out of sync. */
  function drawBlockedBandReflection(ctx, x, colWidth, baselineY, maxHeight, level, color) {
    const segments = BLOCKED_SEGMENTS;
    const segGap = BLOCKED_SEG_GAP;
    const segHeight = (maxHeight - segGap * (segments - 1)) / segments;
    if (segHeight <= 0) return;
    for (let s = 0; s < segments; s++) {
      const segFrom = s / segments;
      const segTo = (s + 1) / segments;
      if (level <= segFrom) continue;
      const alphaMul = level >= segTo ? 1 : (level - segFrom) / (segTo - segFrom);
      const segTop = baselineY + s * (segHeight + segGap);
      ctx.fillStyle = `rgba(${color.r * 255}, ${color.g * 255}, ${color.b * 255}, ${(color.a ?? 1) * alphaMul * 0.28})`;
      ctx.fillRect(x, segTop, colWidth, segHeight);
    }
  }

  /**
   * Orchestrates all 12 columns for one frame — shared by both live and
   * mock draw paths, exactly like every other render style's shared
   * helper below. `levels`/`peakLevels` are precomputed by the caller
   * (from real spectrum data live, from phased oscillators in mock
   * mode) so this function only knows about drawing, not where the
   * numbers came from.
   *
   * gapFraction is Layer Spread (0..1), repurposed here as horizontal
   * spacing between columns rather than its usual vertical-layer-offset
   * meaning — see the layerSpread control's own hint. Columns always
   * span the full tile width regardless of spacing; more spread means
   * narrower columns, not columns that stop short of the edges.
   */
  function drawBlockedBands(levels, peakLevels, colorNear, colorFar, gapFraction, peakHoldEnabled) {
    const ctx = p.drawingContext;
    const n = levels.length;
    const baselineY = p.height * 0.7;
    const maxHeight = p.height * 0.55;
    const reflectionHeight = Math.max(0, Math.min(maxHeight * 0.45, p.height - baselineY - 4));
    const gapPx = gapFraction * 22;
    const totalGap = gapPx * (n - 1);
    const colWidth = Math.max(3, (p.width - totalGap) / n);

    for (let i = 0; i < n; i++) {
      const x = i * (colWidth + gapPx);
      const t = n > 1 ? i / (n - 1) : 0;
      const color = mixColor(colorNear, colorFar, t);
      if (reflectionHeight > 0) {
        drawBlockedBandReflection(ctx, x, colWidth, baselineY, reflectionHeight, levels[i], color);
      }
      drawBlockedBandColumn(ctx, x, colWidth, baselineY, maxHeight, levels[i], peakLevels[i], color, peakHoldEnabled);
    }

    // Thin baseline anchor, same reasoning as Radial Spectrum's own ring
    // — reads as one shared structure instead of 12 columns floating
    // loose against the background.
    ctx.save();
    ctx.strokeStyle = `rgba(${colorNear.r * 255}, ${colorNear.g * 255}, ${colorNear.b * 255}, 0.3)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, baselineY);
    ctx.lineTo(p.width, baselineY);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Live mode: this card's own real sound engine output, read straight
   * off the shared analyser tap (see lib/sound/meter.ts's getWaveform()
   * and the audioWaveform bridge in p5.renderer.ts / the sandbox
   * runtime).
   *
   * Layer stacking and the scanline roll bands stay genuinely inert here
   * (see InspectorDrawer's STATIC_CHOIR_MOCK_ONLY_CONTROL_IDS) — those
   * are specifically mock-generator artifacts, not something a real
   * signal should be decorated with. One targeted exception: Gradient
   * Bands and Radial Gradient DO respect Waveform Layers/Layer Spread in
   * live mode too, drawing several color-graded copies of the SAME real
   * trace at different offsets. That's a different use of "layers" than
   * Line mode's — there, each layer is a phase-varied, genuinely
   * different-looking copy (only possible because the mock generator can
   * invent that variation; real audio can't). Here, identical offset
   * copies IS the intended effect — the banded look is a property of the
   * visual treatment, not of having multiple independent signals — so it
   * applies just as well to one real trace duplicated as it does to
   * several procedurally-varied mock ones. Everything else now applies
   * to the real trace too:
   *
   *  - Wave Amplitude: a direct visual gain on the real (roughly -1..1)
   *    samples, same idea as the mock's own amp scaling, just applied to
   *    real data instead of a generated one.
   *  - Wave Frequency: "frequency" has no literal meaning against an
   *    already-captured buffer, so this is repurposed as a horizontal
   *    zoom — 1 (default) stretches the whole captured window across the
   *    tile; higher values zoom into a shorter leading slice of it.
   *  - Static Intensity (now defaults to 0, unlike the mock's roll
   *    bands): per-point grain jitter on the trace itself. At 0 the
   *    trace is perfectly clean; dialing it up roughens it.
   *  - Glitch Frequency: the SAME timed chromatic RGB-split burst the
   *    mock generator uses, applied to the real trace. Line, Mirrored,
   *    Ribbon, and Gradient Bands get the full multi-pass split;
   *    Particles, Radial, and Radial Gradient still jitter but skip it.
   *  - Motion Blur: trails recent frames instead of a full clear each
   *    draw, via a translucent background fill — the same technique
   *    Cursor Ripple's own persistence trail uses. Also applies to the
   *    mock generator (see drawMockWaveform), not live-only anymore.
   *  - Phosphor Glow: a soft shadow blur behind the stroke via real
   *    Canvas2D compositing (drawingContext.shadowBlur), not a fake
   *    overlay — GPU-composited like any other canvas blend. Also
   *    applies to the mock generator.
   */
  function drawLiveWaveform(rawAudio) {
    // Smoothed once here, so every downstream use of `audio` in this
    // function — every render style's sampling, all of them — picks up
    // the smoothing automatically. See updateSmoothedAudio's own doc.
    const audio = updateSmoothedAudio(rawAudio);
    // Track-only, and can be null even when audio itself is playing (mic
    // or the synth preset) — see getAudioBands' own doc in the sandbox
    // runtime. Particles/Ribbon's band-mapped dispatch (below) falls
    // back to neutral, equal-weighted bands when this is null, so a
    // mic-driven tile still looks reasonable, just without genuine
    // per-band differentiation — there's no real band data to show.
    const bands = typeof p.getAudioBands === 'function' ? p.getAudioBands() : null;
    const waveAmplitude = get('waveAmplitude');
    const waveFrequency = get('waveFrequency');
    const tint = get('tint');
    const staticIntensity = get('staticIntensity');
    const glitchFrequency = get('glitchFrequency');
    const motionBlur = get('motionBlur');
    const phosphorGlow = get('phosphorGlow');
    const renderStyle = get('renderStyle');

    // Filled/dense styles carry more visual mass than a thin 2px stroke,
    // so the same Motion Blur / Phosphor Glow slider position reads as
    // much heavier on them — a light trail behind a hairline looks
    // subtle; the identical trail behind a filled ribbon or gradient band
    // reads as smeared. Scaling both effects down for those styles keeps
    // the default (0) identically off for everyone, while giving the
    // filled styles more headroom before a modest setting looks extreme.
    const isDenseStyle = renderStyle === 'MIRRORED' || renderStyle === 'RIBBON'
      || renderStyle === 'GRADIENT_BANDS' || renderStyle === 'RADIAL_GRADIENT'
      || renderStyle === 'BLOCKED_BANDS';
    const effectWeight = isDenseStyle ? 0.55 : 1;

    // Motion blur: a partially-transparent clear leaves a fading trail of
    // the last several frames behind instead of wiping to black every
    // draw. 0 (default) is a fully opaque clear — identical to the old
    // always-crisp behavior.
    const clearAlpha = 255 - motionBlur * effectWeight * 240;
    p.background(4, 4, 4, clearAlpha);
    p.noFill();

    const glitching = advanceGlitch(glitchFrequency);
    const midY = p.height / 2;
    const sampleCount = audio.length;
    const windowLength = Math.max(8, Math.floor(sampleCount / Math.max(0.25, waveFrequency)));
    const triggerOffset = findTriggerOffset(audio);

    const passes = glitching
      ? [
          { dx: -glitchStrength * 6, color: { r: 1, g: 0.2, b: 0.2 }, alpha: 130 },
          { dx: glitchStrength * 6, color: { r: 0.2, g: 0.6, b: 1 }, alpha: 130 },
          { dx: 0, color: tint, alpha: 255 },
        ]
      : [{ dx: 0, color: tint, alpha: 235 }];

    // Shared by every style, Line included — see liveAmpAt's own doc.
    // Line used to have its own separate sampleY() doing the same
    // amplitude math inline; consolidated onto the same ampFn every
    // other style already used so Line could pick up layer support
    // (below) without a second, drifting copy of the same formula.
    const ampFn = (layerIdx, x) => liveAmpAt(x, audio, sampleCount, windowLength, waveAmplitude, staticIntensity, glitching, glitchStrength, layerIdx, 1, triggerOffset);

    // Every style now respects Waveform Layers/Layer Spread live, Line
    // included — duplicating the one real trace across N offset copies,
    // same as mock mode's phase-varied layers do positionally (just
    // without the phase variation, since there's only one real signal to
    // vary). memoizedAmpFn() keeps this affordable regardless of style:
    // every layer after the first hits the cache instead of resampling
    // the identical trace from scratch.
    const layerCount = Math.round(get('layers'));
    const layerSpread = get('layerSpread');
    const cachedAmpFn = memoizedAmpFn(ampFn);

    if (renderStyle === 'LINE') {
      for (const pass of passes) {
        if (phosphorGlow > 0) {
          // Additive blending + a smaller blur radius, not shadowBlur
          // doing all the work alone — 'lighter' makes overlapping
          // strokes/anti-aliased edges brighten each other instead of
          // just overwriting, which reads as a brighter, more "neon"
          // glow than blur alone, genuinely cheaper (no per-pixel
          // convolution to lean on as hard), and pairs naturally with
          // Motion Blur's fading trail already accumulating brightness
          // frame to frame. See RADIAL_GRADIENT's own glow comment
          // below for why the blur radius itself also matters for cost.
          p.drawingContext.shadowBlur = phosphorGlow * 14;
          p.drawingContext.shadowColor = `rgba(${pass.color.r * 255}, ${pass.color.g * 255}, ${pass.color.b * 255}, 0.9)`;
          p.drawingContext.globalCompositeOperation = 'lighter';
        }
        for (let i = 0; i < layerCount; i++) {
          const layerOffset = layerCount > 1 ? (i / (layerCount - 1) - 0.5) * p.height * layerSpread : 0;
          p.stroke(pass.color.r * 255, pass.color.g * 255, pass.color.b * 255, pass.alpha);
          p.strokeWeight(2);
          p.beginShape();
          for (let x = 0; x <= p.width; x += 2) {
            p.vertex(pass.dx + x, midY + layerOffset + cachedAmpFn(i, x));
          }
          p.endShape();
        }
        if (phosphorGlow > 0) {
          p.drawingContext.shadowBlur = 0;
          p.drawingContext.globalCompositeOperation = 'source-over';
        }
      }
      return;
    }

    if (phosphorGlow > 0) {
      // Radial Gradient's own passes are each a full gradient fill — the
      // single most expensive combination with an active shadowBlur,
      // since the blur gets recomputed on every one of those fills, not
      // just once. Dividing the radius by sqrt(layer count) keeps the
      // total glow looking roughly consistent (more, smaller-radius
      // passes read similarly to fewer, larger ones) while directly
      // cutting the per-call cost that was compounding with Layers.
      // 14, not the original 24 — see LINE's own identical comment
      // above on why 'lighter' additive blending picks up more of the
      // visual load, letting the blur radius itself (the expensive part)
      // shrink without the glow reading as weaker overall.
      const glowLayerDivisor = renderStyle === 'RADIAL_GRADIENT' ? Math.sqrt(Math.min(layerCount, 3)) : 1;
      p.drawingContext.shadowBlur = phosphorGlow * effectWeight * 14 / glowLayerDivisor;
      p.drawingContext.shadowColor = `rgba(${tint.r * 255}, ${tint.g * 255}, ${tint.b * 255}, 0.9)`;
      // 'lighter' additive blending is only safe for thin/sparse content
      // (Line got it above; Radial's own stroke-only outline is the one
      // case here). Every FILLED, multi-layer style — Mirrored, Ribbon,
      // Gradient Bands, Radial Gradient, Radial Spectrum's wedges — has
      // many overlapping filled regions by design, and additive
      // blending across that many overlaps blows straight past white,
      // especially during a glitch burst's extra chromatic passes on
      // top. That's the literal cause of the reported "whitening" —
      // this isn't a style preference, it's the actual mechanism.
      // Particles keeps 'lighter' (safe — points barely overlap) but
      // loses shadowBlur below instead, for an unrelated reason.
      const additiveSafe = !isDenseStyle;
      p.drawingContext.globalCompositeOperation = additiveSafe ? 'lighter' : 'source-over';
      // Particles draws each sample as its own separate stroked point —
      // hundreds of them per layer. shadowBlur recomputes on every one
      // of those individually, not once per shape like every other
      // style here, which is a multiplicative cost this file's other
      // per-layer dampening never accounted for because no other style
      // draws this many discrete primitives in one pass. Turning it off
      // for this one style specifically is what actually fixes the
      // "Particles is unusable" bottleneck — 'lighter' above still gives
      // it some glow via overlapping dots, just without the blur.
      if (renderStyle === 'PARTICLES') {
        p.drawingContext.shadowBlur = 0;
      }
    }

    if (renderStyle === 'MIRRORED') {
      for (const pass of passes) {
        for (let i = 0; i < layerCount; i++) {
          const layerOffset = layerCount > 1 ? (i / (layerCount - 1) - 0.5) * p.height * layerSpread : 0;
          renderMirroredLayer(cachedAmpFn, i, midY + layerOffset, pass.dx, pass.color, pass.alpha);
        }
      }
    } else if (renderStyle === 'RIBBON') {
      const maxThickness = get('ribbonThickness');
      const bandAmpFn = bandedAmpFn(cachedAmpFn, bands);
      for (const pass of passes) {
        for (let i = 0; i < layerCount; i++) {
          const layerOffset = layerCount > 1 ? (i / (layerCount - 1) - 0.5) * p.height * layerSpread : 0;
          renderRibbonLayer(bandAmpFn, i, midY + layerOffset, pass.dx, pass.color, pass.alpha, waveAmplitude, maxThickness);
        }
      }
    } else if (renderStyle === 'PARTICLES') {
      const bandAmpFn = bandedAmpFn(cachedAmpFn, bands);
      for (let i = 0; i < layerCount; i++) {
        const layerOffset = layerCount > 1 ? (i / (layerCount - 1) - 0.5) * p.height * layerSpread : 0;
        renderParticlesLayer(bandAmpFn, i, midY + layerOffset, 0, tint, 235, get('particleSpacing'), get('particleSize'));
      }
    } else if (renderStyle === 'RADIAL') {
      const baseRadius = Math.min(p.width, p.height) * get('radialBaseSize');
      // Capped independently of the global Layers slider — polar
      // sampling and drawing costs more per layer than the flat styles
      // (trig per vertex, plus Radial Gradient's gradient-filled passes
      // below), so this stays smooth well past where the flat styles
      // would still be fine at the full 1-10 range. Other styles keep
      // the full range; this cap is local to Radial/Radial Gradient only.
      const radialLayerCount = Math.min(layerCount, 3);
      // Sampled once, not once per layer — every layer reads the
      // identical live trace, so there's nothing layer-specific about
      // the sample-and-blend pass itself, only about where each ring
      // gets drawn. See drawRadialRing's doc for what this replaced.
      // radialScale (see its own doc) keeps the deviation proportional
      // to baseRadius instead of the raw Wave Amplitude pixel value.
      // steps trimmed from 150 — the wider seam-blend from an earlier
      // round has enough margin to stay smooth at a lower sample count,
      // and fewer vertices per layer is a direct, real cost reduction.
      const steps = 110;
      const raw = radialSamples(cachedAmpFn, 0, steps, v => radialScale(Math.max(0, v), baseRadius, waveAmplitude));
      for (let i = 0; i < radialLayerCount; i++) {
        const layerRadius = baseRadius + i * baseRadius * layerSpread * 0.6;
        drawRadialRing(raw, steps, layerRadius, p.width / 2, p.height / 2, tint, 235, 2);
      }
    } else if (renderStyle === 'GRADIENT_BANDS') {
      const tint2 = get('tint2');
      for (let i = 0; i < layerCount; i++) {
        const layerOffset = layerCount > 1 ? (i / (layerCount - 1) - 0.5) * p.height * layerSpread : 0;
        renderGradientBandLayer(cachedAmpFn, i, layerCount, midY + layerOffset, 0, tint, tint2, 160);
      }
    } else if (renderStyle === 'RADIAL_GRADIENT') {
      const tint2Radial = get('tint2Radial');
      const baseRadius = Math.min(p.width, p.height) * get('radialBaseSizeGradient');
      // Same layer cap as Radial above — each layer here is additionally
      // a full gradient-filled path, the single most expensive per-layer
      // draw of any style in this file, so this is where the cap matters
      // most.
      const radialLayerCount = Math.min(layerCount, 3);
      // Same one-sample-pass-reused-across-layers fix as Radial above —
      // every live layer reads the identical trace, so sampleLayer just
      // hands back the same precomputed array regardless of i. steps
      // trimmed from 100 for the same reason as Radial's own cut above.
      const steps = 70;
      const raw = radialSamples(cachedAmpFn, 0, steps, v => radialScale(Math.max(0, v), baseRadius, waveAmplitude));
      drawRadialGradientHalo(() => raw, steps, radialLayerCount, baseRadius, layerSpread, p.width / 2, p.height / 2, tint, tint2Radial);
    } else if (renderStyle === 'BLOCKED_BANDS') {
      const tint2Radial = get('tint2Radial');
      const peakHoldEnabled = get('peakHoldEnabled');
      // Peak Fall Delay is authored in seconds-to-fall (see
      // updateBlockedBandPeak's own doc on why); converted to
      // units/second right here at the read site.
      const peakFallSpeed = 1 / Math.max(0.05, get('peakFallDelay'));
      // Wave Amplitude's real job on this render style: an overall
      // sensitivity/contrast multiplier on the reactivity math, not a
      // literal wave height (there's no trace to scale here). Default
      // 90 -> multiplier 1 (today's tuned baseline, unchanged); turning
      // it up makes every column swing harder for the same audio,
      // turning it down flattens the whole display. Gives Wave
      // Amplitude — already `modulatable: true` — a genuine, visible
      // effect on Blocked Bands, which it didn't have before (reported
      // as "no change" when modulated).
      const gainMultiplier = waveAmplitude / 90;
      // Wave Frequency's real job on this render style: response
      // speed, not amplitude — see shapeBlockedBandLevel's own doc
      // for why this is a separate knob from gainMultiplier above
      // rather than folded into it. Its declared range (0.5-4,
      // default 1) already centers exactly where a multiplier needs
      // to, so it's used as-is with no rescaling.
      const speedMultiplier = waveFrequency;
      // Track OR mic — see protocol.ts's `spectrum` doc. Null for the
      // synth-preset case (no frequency-domain tap exists for it
      // anywhere in this codebase), same as `bands` above; falls back to
      // an all-zero raw signal, which shapeBlockedBandLevel naturally
      // decays every column toward "at rest" rather than freezing.
      const spectrum = typeof p.getAudioSpectrum === 'function' ? p.getAudioSpectrum() : null;
      const spectrumBinHz = typeof p.getAudioSpectrumBinHz === 'function' ? p.getAudioSpectrumBinHz() : 0;
      const rawBands = spectrum && spectrumBinHz > 0
        ? sampleBlockedBands(spectrum, blockedBandRangesFor(spectrumBinHz, spectrum.length))
        : new Array(BLOCKED_BAND_COUNT).fill(0);
      // p.deltaTime is milliseconds; clamped so a stalled/backgrounded
      // tab's first frame back doesn't send the peak cap's fall
      // calculation flying on one huge dt.
      const dt = p.deltaTime ? Math.min(0.1, p.deltaTime / 1000) : 1 / 60;
      const levels = new Array(BLOCKED_BAND_COUNT);
      const peaks = new Array(BLOCKED_BAND_COUNT);
      for (let i = 0; i < BLOCKED_BAND_COUNT; i++) {
        levels[i] = shapeBlockedBandLevel(i, rawBands[i] ?? 0, gainMultiplier, speedMultiplier);
        peaks[i] = updateBlockedBandPeak(i, levels[i], peakFallSpeed, dt);
      }
      drawBlockedBands(levels, peaks, tint, tint2Radial, layerSpread, peakHoldEnabled);
    }

    if (phosphorGlow > 0) {
      p.drawingContext.shadowBlur = 0;
      p.drawingContext.globalCompositeOperation = 'source-over';
    }
  }

  /** Mock mode: the original procedural generator, entirely unchanged —
      what every card shows before Sound is ever turned on, and what a
      sound-less variant of this tile still shows indefinitely. */
  function drawMockWaveform() {
    const staticIntensity = get('staticIntensity');
    const waveShape = get('waveShape');
    const renderStyle = get('renderStyle');
    const waveAmplitude = get('waveAmplitude');
    const waveFrequency = get('waveFrequency');
    const harmonicMix = get('harmonicMix');
    const layers = Math.round(get('layers'));
    const layerSpread = get('layerSpread');
    const lfoRate = get('lfoRate');
    const glitchFrequency = get('glitchFrequency');
    const motionBlur = get('motionBlur');
    const phosphorGlow = get('phosphorGlow');
    const tint = get('tint');
    const scanlines = get('scanlines');
    const scanlineColor = get('scanlineColor');
    const scanlineWidth = get('scanlineWidth');
    const scanlineMotion = get('scanlineMotion');

    // Same reasoning as drawLiveWaveform's identical isDenseStyle/
    // effectWeight — filled/dense styles carry more visual mass than a
    // thin stroke, so the same slider position reads heavier on them.
    const isDenseStyle = renderStyle === 'MIRRORED' || renderStyle === 'RIBBON'
      || renderStyle === 'GRADIENT_BANDS' || renderStyle === 'RADIAL_GRADIENT'
      || renderStyle === 'BLOCKED_BANDS';
    const effectWeight = isDenseStyle ? 0.55 : 1;

    // Same translucent-clear motion-blur technique as the live path —
    // 0 (default) is a fully opaque clear, identical to the old
    // always-crisp behavior.
    const clearAlpha = 255 - motionBlur * effectWeight * 240;
    p.background(4, 4, 4, clearAlpha);

    const glitching = advanceGlitch(glitchFrequency);

    // Static/roll bands — now fully owned by the Scanlines toggle, so
    // switching it off actually removes every horizontal artifact instead
    // of just the overlay color.
    if (scanlines) {
      const bandHeight = 2;
      p.noStroke();
      for (let y = 0; y < p.height; y += bandHeight) {
        const rowIdx = Math.floor(y / bandHeight);

        const glitchChance = glitching ? 0.25 : 0.004;
        if (p.random() < glitchChance) {
          rowOffsets[rowIdx] = p.random(-30, 30) * (glitching ? 1.8 : 1);
        } else {
          rowOffsets[rowIdx] *= 0.85;
        }

        const brightness = p.random(0, staticIntensity * 60);
        p.fill(brightness, brightness, brightness);
        p.rect(rowOffsets[rowIdx] || 0, y, p.width + 40, bandHeight);
      }
    }

    const lfoA = 0.5 + 0.5 * Math.sin(p.frameCount * lfoRate * 0.02);
    const lfoB = 0.5 + 0.5 * Math.sin(p.frameCount * lfoRate * 0.031 + 1.7);

    p.noFill();

    // During a glitch burst, draw the waveform 2-3 times with a chromatic
    // (RGB-split) offset — cheap, and it's the thing that actually reads
    // as "alive" rather than the old sideways-noise-shift approach.
    const passes = glitching
      ? [
          { dx: -glitchStrength * 6, color: { r: 1, g: 0.2, b: 0.2 }, alpha: 130 },
          { dx: glitchStrength * 6, color: { r: 0.2, g: 0.6, b: 1 }, alpha: 130 },
          { dx: 0, color: tint, alpha: 255 },
        ]
      : [{ dx: 0, color: tint, alpha: 220 }];

    for (const pass of passes) {
      if (phosphorGlow > 0) {
        // Same reasoning as drawLiveWaveform's identical divisor and
        // radius, and the same additiveSafe/PARTICLES carve-outs — see
        // its comments.
        const glowLayerDivisor = renderStyle === 'RADIAL_GRADIENT' ? Math.sqrt(Math.min(layers, 3)) : 1;
        p.drawingContext.shadowBlur = phosphorGlow * effectWeight * 14 / glowLayerDivisor;
        p.drawingContext.shadowColor = `rgba(${pass.color.r * 255}, ${pass.color.g * 255}, ${pass.color.b * 255}, 0.9)`;
        const additiveSafe = !isDenseStyle;
        p.drawingContext.globalCompositeOperation = additiveSafe ? 'lighter' : 'source-over';
        if (renderStyle === 'PARTICLES') {
          p.drawingContext.shadowBlur = 0;
        }
      }

      if (renderStyle === 'LINE') {
        for (let layer = 0; layer < layers; layer++) {
          const dirSign = layer % 2 === 0 ? 1 : -1;
          const layerOffset = layers > 1
            ? (layer / (layers - 1) - 0.5) * p.height * layerSpread
            : 0;
          const fade = 1 - (layer / Math.max(layers, 1)) * 0.35;

          p.stroke(pass.color.r * 255, pass.color.g * 255, pass.color.b * 255, pass.alpha * fade);
          p.strokeWeight(2);
          p.beginShape();
          const midY = p.height / 2 + layerOffset;

          for (let x = 0; x <= p.width; x += 4) {
            const t = x * 0.02 * waveFrequency;
            const amp = waveAmplitude * (0.4 + 0.6 * lfoA) * fade;
            const phase = dirSign * p.frameCount * 0.02;

            const fundamental = waveValue(waveShape, t + phase) * amp * 0.5;
            const harmonic = Math.sin(t * 2.3 + dirSign * p.frameCount * 0.013) * amp * 0.25 * lfoB * (0.3 + harmonicMix);
            const grain = (p.noise(x * 0.01, layer * 10 + p.frameCount * 0.01) - 0.5) * amp * 0.2;

            let jolt = 0;
            if (glitching) {
              jolt = (p.noise(x * 0.05, p.frameCount * 0.6, layer) - 0.5) * amp * glitchStrength * 1.4;
            }

            p.vertex(pass.dx + x, midY + fundamental + harmonic + grain + jolt);
          }
          p.endShape();
        }
      } else {
        // Every other style shares one ampFn built from mockAmpAt.
        const ampOpts = { waveShape, waveAmplitude, waveFrequency, harmonicMix, lfoA, lfoB, glitching, glitchStrength };
        const ampFn = (layerIdx, x) => {
          const dirSign = layerIdx % 2 === 0 ? 1 : -1;
          const fade = 1 - (layerIdx / Math.max(layers, 1)) * 0.35;
          return mockAmpAt(x, layerIdx, dirSign, fade, ampOpts);
        };

        if (renderStyle === 'MIRRORED') {
          for (let layer = 0; layer < layers; layer++) {
            const layerOffset = layers > 1 ? (layer / (layers - 1) - 0.5) * p.height * layerSpread : 0;
            renderMirroredLayer(ampFn, layer, p.height / 2 + layerOffset, pass.dx, pass.color, pass.alpha);
          }
        } else if (renderStyle === 'RIBBON') {
          const maxThickness = get('ribbonThickness');
          for (let layer = 0; layer < layers; layer++) {
            const layerOffset = layers > 1 ? (layer / (layers - 1) - 0.5) * p.height * layerSpread : 0;
            renderRibbonLayer(ampFn, layer, p.height / 2 + layerOffset, pass.dx, pass.color, pass.alpha, waveAmplitude, maxThickness);
          }
        } else if (renderStyle === 'PARTICLES') {
          // Particles skips the chromatic glitch split (see Glitch
          // Frequency's hint) — draw once per layer regardless of pass.
          if (pass.dx === 0) {
            for (let layer = 0; layer < layers; layer++) {
              const layerOffset = layers > 1 ? (layer / (layers - 1) - 0.5) * p.height * layerSpread : 0;
              renderParticlesLayer(ampFn, layer, p.height / 2 + layerOffset, 0, tint, 220, get('particleSpacing'), get('particleSize'));
            }
          }
        } else if (renderStyle === 'RADIAL') {
          if (pass.dx === 0) {
            const baseRadius = Math.min(p.width, p.height) * get('radialBaseSize');
            // Same cap as live mode's own RADIAL branch — see its comment.
            const radialLayerCount = Math.min(layers, 3);
            for (let layer = 0; layer < radialLayerCount; layer++) {
              const layerRadius = baseRadius + layer * baseRadius * layerSpread * 0.6;
              renderRadialLayer(ampFn, layer, layerRadius, waveAmplitude, p.width / 2, p.height / 2, tint, 220, 2);
            }
          }
        } else if (renderStyle === 'GRADIENT_BANDS') {
          const tint2 = get('tint2');
          for (let layer = 0; layer < layers; layer++) {
            const layerOffset = layers > 1 ? (layer / (layers - 1) - 0.5) * p.height * layerSpread : 0;
            renderGradientBandLayer(ampFn, layer, layers, p.height / 2 + layerOffset, pass.dx, tint, tint2, 150);
          }
        } else if (renderStyle === 'RADIAL_GRADIENT') {
          if (pass.dx === 0) {
            const tint2Radial = get('tint2Radial');
            const baseRadius = Math.min(p.width, p.height) * get('radialBaseSizeGradient');
            // Same cap and step reduction as live mode's own
            // RADIAL_GRADIENT branch — see its comments.
            const radialLayerCount = Math.min(layers, 3);
            const steps = 70;
            drawRadialGradientHalo(
              (layer) => radialSamples(ampFn, layer, steps, v => radialScale(Math.max(0, v), baseRadius, waveAmplitude)),
              steps, radialLayerCount, baseRadius, layerSpread, p.width / 2, p.height / 2, tint, tint2Radial,
            );
          }
        } else if (renderStyle === 'BLOCKED_BANDS') {
          if (pass.dx === 0) {
            const tint2Radial = get('tint2Radial');
            const peakHoldEnabled = get('peakHoldEnabled');
            const peakFallSpeed = 1 / Math.max(0.05, get('peakFallDelay'));
            const gainMultiplier = waveAmplitude / 90;
            // Same speed-vs-amplitude split as the live branch —
            // see its comment.
            const speedMultiplier = waveFrequency;
            const dt = p.deltaTime ? Math.min(0.1, p.deltaTime / 1000) : 1 / 60;
            const levels = new Array(BLOCKED_BAND_COUNT);
            const peaks = new Array(BLOCKED_BAND_COUNT);
            for (let i = 0; i < BLOCKED_BAND_COUNT; i++) {
              // No real spectrum in mock mode — 12 independently phased
              // oscillators standing in for the real bands, same spirit
              // as Radial Spectrum's own 3-oscillator mock fallback,
              // just enough of them to fill every column.
              const raw = 0.5 + 0.5 * Math.sin(p.frameCount * (0.015 + i * 0.004) + i * 1.7);
              levels[i] = shapeBlockedBandLevel(i, raw, gainMultiplier, speedMultiplier);
              peaks[i] = updateBlockedBandPeak(i, levels[i], peakFallSpeed, dt);
            }
            drawBlockedBands(levels, peaks, tint, tint2Radial, layerSpread, peakHoldEnabled);
          }
        }
      }

      if (phosphorGlow > 0) {
        p.drawingContext.shadowBlur = 0;
        p.drawingContext.globalCompositeOperation = 'source-over';
      }
    }

    if (scanlines) {
      scanScroll += scanlineMotion;
      const spacing = Math.max(2, scanlineWidth * 3);
      p.stroke(scanlineColor.r * 255, scanlineColor.g * 255, scanlineColor.b * 255, 60);
      p.strokeWeight(1);
      const offset = ((scanScroll % spacing) + spacing) % spacing;
      for (let y = -spacing; y < p.height + spacing; y += spacing) {
        p.line(0, y + offset, p.width, y + offset);
      }
    }
  }

  p.draw = () => {
    // getAudioWaveform() is only defined once the sandbox bridge exists
    // (see public/sandbox/index.html) — the typeof guard is defensive,
    // matching cursor-ripple.js's identical guard around p.pluck. Returns
    // null whenever this card's own Sound isn't currently enabled/running
    // (see the protocol doc), which is exactly the mock-mode condition.
    const audio = typeof p.getAudioWaveform === 'function' ? p.getAudioWaveform() : null;
    if (audio) {
      drawLiveWaveform(audio);
    } else {
      drawMockWaveform();
    }
  };
}
