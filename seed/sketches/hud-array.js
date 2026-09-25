/**
 * hud-array — three genuinely different futuristic HUD languages behind
 * one mode selector, not reskins of the same layout:
 *
 *   Radial — concentric independently-rotating rings, segmented tick
 *            arcs, a dotted scan ring, a rotating chase-lit outer dot
 *            ring, small numeric readouts. A sci-fi targeting/instrument
 *            dial.
 *   Alpha  — flat translucent panels at different depths, drifting
 *            slowly (parallax), with a scanline sweep and corner
 *            readouts. A cockpit flat-panel display.
 *   Delta  — aviation-style: horizon line, pitch ladder, centre
 *            reticle, corner brackets, airspeed/altitude-style
 *            numeric tickers.
 *
 * "Interactive controls for individual assets" is taken literally: each
 * mode exposes SEPARATE speed controls per moving element (outer ring
 * vs inner ring vs tick sweep, not one global speed), each independently
 * @mod-ready, so distinct HUD elements can eventually answer to
 * different frequency bands rather than all breathing in lockstep. Only
 * the active mode's own controls are shown (via showIf), so the panel
 * stays legible despite the total control count across all three modes.
 */

export const params = {
  hudMode: {
    kind: 'select', label: 'HUD mode', group: 'mode', default: 'radial',
    options: [
      { value: 'radial', label: '3D Radial' },
      { value: 'alpha', label: 'Alpha' },
      { value: 'delta', label: 'Delta' },
      { value: 'sigma', label: 'Sigma' },
    ],
  },

  // Colors first, then the two truly global controls (Scale, Glow) —
  // both apply regardless of mode, so both sit above every per-mode
  // section rather than buried inside Radial's own control list where
  // Scale/Glow used to live.
  accentColor: { kind: 'color', label: 'Accent', group: 'colors', default: { r: 0.6, g: 0.95, b: 1.0, a: 1 } },
  dimColor: { kind: 'color', label: 'Dim elements', group: 'colors', default: { r: 0.6, g: 0.95, b: 1.0, a: 0.35 } },
  bgColor: { kind: 'color', label: 'Background', group: 'colors', default: { r: 0.02, g: 0.03, b: 0.05, a: 1 } },

  scale: { kind: 'slider', label: 'Scale', group: 'global', min: 0.5, max: 1.4, step: 0.01, default: 1.0 },
  glow: { kind: 'slider', label: 'Glow', group: 'global', min: 0, max: 2, step: 0.01, default: 0.8 },

  // --- Radial mode — Motion (every *Speed control, plus the zoom-pulse
  // and signature-band rates: anything that's a rate of change rather
  // than a static shape/size/color) ---
  outerRingSpeed: { kind: 'slider', label: 'Outer ring speed', group: 'radialMotion', min: -60, max: 60, step: 1, default: 8, unit: 'deg/s', modulatable: true, showIf: { equals: ['hudMode', 'radial'] } },
  segmentRingSpeed: { kind: 'slider', label: 'Segment arc speed', group: 'radialMotion', min: -60, max: 60, step: 1, default: -14, unit: 'deg/s', modulatable: true, showIf: { equals: ['hudMode', 'radial'] } },
  tickRingSpeed: { kind: 'slider', label: 'Outer dot ring speed', group: 'radialMotion', min: -90, max: 90, step: 1, default: 22, unit: 'deg/s', modulatable: true, showIf: { equals: ['hudMode', 'radial'] } },
  scanDotSpeed: { kind: 'slider', label: 'Scan dot speed', group: 'radialMotion', min: -180, max: 180, step: 1, default: -60, unit: 'deg/s', modulatable: true, showIf: { equals: ['hudMode', 'radial'] } },
  dataBandSpeed: { kind: 'slider', label: 'Dot ring pulse speed', group: 'radialMotion', min: 0, max: 4, step: 0.01, default: 1.2, modulatable: true, showIf: { equals: ['hudMode', 'radial'] } },
  radialZoomPulseSpeed: { kind: 'slider', label: 'Zoom pulse speed', group: 'radialMotion', min: 0.1, max: 4, step: 0.05, default: 1.2, modulatable: true, showIf: { equals: ['hudMode', 'radial'] } },
  radialBandSpeedA: { kind: 'slider', label: 'Band A speed', group: 'radialMotion', min: -90, max: 90, step: 1, default: 14, unit: 'deg/s', modulatable: true, showIf: { equals: ['hudMode', 'radial'] } },
  radialBandSpeedB: { kind: 'slider', label: 'Band B speed', group: 'radialMotion', min: -90, max: 90, step: 1, default: -19, unit: 'deg/s', modulatable: true, showIf: { equals: ['hudMode', 'radial'] } },

  // --- Radial mode — Visual (shape, size, count, color: everything that
  // ISN'T a rate) ---
  segmentCount: { kind: 'stepper', label: 'Segment count', group: 'radialVisual', min: 8, max: 32, step: 1, default: 18, showIf: { equals: ['hudMode', 'radial'] } },
  segmentRoundness: { kind: 'slider', label: 'Segment roundness', group: 'radialVisual', min: 0, max: 1, step: 0.02, default: 0.5, showIf: { equals: ['hudMode', 'radial'] }, hint: '0 = flat blocks, 1 = fully rounded pills.' },
  tickerCount: { kind: 'stepper', label: 'Outer ticker count', group: 'radialVisual', min: 4, max: 40, step: 1, default: 16, showIf: { equals: ['hudMode', 'radial'] } },
  tickerHeight: { kind: 'slider', label: 'Outer ticker height', group: 'radialVisual', min: 0.02, max: 0.25, step: 0.005, default: 0.10, showIf: { equals: ['hudMode', 'radial'] }, hint: 'Base height for the minor ticks.' },
  tickerThickness: { kind: 'slider', label: 'Outer ticker thickness', group: 'radialVisual', min: 0.5, max: 4, step: 0.1, default: 2, showIf: { equals: ['hudMode', 'radial'] }, hint: 'Base stroke weight for the minor ticks.' },
  // Accent markers: every Nth tick in the outer ring is upsized and
  // alternates between a filled inward-pointing triangle and a thick
  // bar, so the ring reads as a logical repeating sequence (a batch of
  // thin/short minor ticks, then one accent, then another batch, then
  // the other accent shape) rather than one uniform ring of identical
  // marks. `tickerAccentScale` multiplies both height and thickness
  // for the accent tick only — the minor ticks stay driven purely by
  // tickerHeight / tickerThickness above.
  tickerAccentEvery: { kind: 'stepper', label: 'Accent marker every', group: 'radialVisual', min: 2, max: 10, step: 1, default: 4, showIf: { equals: ['hudMode', 'radial'] }, hint: 'Every Nth tick becomes an oversized accent.' },
  tickerAccentScale: { kind: 'slider', label: 'Accent marker scale', group: 'radialVisual', min: 1, max: 3, step: 0.05, default: 1.8, showIf: { equals: ['hudMode', 'radial'] }, hint: 'How much bigger the accent is than a minor tick.' },
  dotSize: { kind: 'slider', label: 'Dot size', group: 'radialVisual', min: 0.5, max: 3, step: 0.05, default: 1.0, showIf: { equals: ['hudMode', 'radial'] }, hint: 'Scales the scan-dot and outer dot rings together.' },
  lineThickness: { kind: 'slider', label: 'Line thickness', group: 'radialVisual', min: 0.5, max: 3, step: 0.05, default: 1.0, showIf: { equals: ['hudMode', 'radial'] }, hint: 'Scales the outer ring line and its ticks.' },
  // Zoom-pulse: only the segmented arc ring breathes now — the outer
  // ring/tickers and both dot rings all stay geometrically fixed, per
  // direct instruction (motion-smoothness + fewer per-frame recomputes
  // on the busiest draw in this mode). Amount defaults to 0 (off), same
  // convention as cube-transform.js's Breathe control.
  radialZoomPulseAmount: { kind: 'slider', label: 'Zoom pulse amount', group: 'radialVisual', min: 0, max: 0.4, step: 0.01, default: 0, modulatable: true, hint: 'How far the segmented ring scales in/out. 0 = off.', showIf: { equals: ['hudMode', 'radial'] } },
  // Radial's own version of Delta's "signature band" — separate params
  // from Delta's own (see lib below) so each mode's look stays tunable
  // independently, matching every other per-mode constant in this file.
  radialBandArc: { kind: 'slider', label: 'Signature band arc', group: 'radialVisual', min: 60, max: 180, step: 1, default: 130, unit: 'deg', showIf: { equals: ['hudMode', 'radial'] }, hint: '90 = quarter circle, 180 = half circle.' },
  radialBandRadius: { kind: 'slider', label: 'Signature band radius', group: 'radialVisual', min: 0.4, max: 0.95, step: 0.01, default: 0.72, showIf: { equals: ['hudMode', 'radial'] }, hint: 'Fraction of ring radius, dot ring (0.62) to segmented ring (1.0).' },
  radialBandWeight: { kind: 'slider', label: 'Signature band weight', group: 'radialVisual', min: 0.5, max: 4, step: 0.1, default: 1.6, showIf: { equals: ['hudMode', 'radial'] } },
  radialBandColor: { kind: 'color', label: 'Signature band color', group: 'radialVisual', default: { r: 1.0, g: 0.35, b: 0.25, a: 0.85 }, showIf: { equals: ['hudMode', 'radial'] } },

  // --- Alpha mode — Motion ---
  panelDriftSpeed: { kind: 'slider', label: 'Panel drift speed', group: 'alphaMotion', min: 0, max: 2, step: 0.01, default: 0.4, modulatable: true, showIf: { equals: ['hudMode', 'alpha'] } },
  scanlineSpeed: { kind: 'slider', label: 'Scanline speed', group: 'alphaMotion', min: 0, max: 3, step: 0.01, default: 0.8, unit: 'px/s×100', modulatable: true, showIf: { equals: ['hudMode', 'alpha'] } },

  // --- Alpha mode — Visual ---
  panelCount: { kind: 'stepper', label: 'Panel count', group: 'alphaVisual', min: 2, max: 6, step: 1, default: 4, showIf: { equals: ['hudMode', 'alpha'] } },
  panelOpacity: { kind: 'slider', label: 'Panel opacity', group: 'alphaVisual', min: 0.1, max: 0.9, step: 0.01, default: 0.4, showIf: { equals: ['hudMode', 'alpha'] } },
  panelBorderWeight: { kind: 'slider', label: 'Panel border weight', group: 'alphaVisual', min: 0.5, max: 4, step: 0.1, default: 1, showIf: { equals: ['hudMode', 'alpha'] } },
  scanlineWeight: { kind: 'slider', label: 'Scanline weight', group: 'alphaVisual', min: 0.5, max: 4, step: 0.1, default: 1.5, showIf: { equals: ['hudMode', 'alpha'] } },
  panelGridDensity: { kind: 'stepper', label: 'Panel grid density', group: 'alphaVisual', min: 2, max: 14, step: 1, default: 6, showIf: { equals: ['hudMode', 'alpha'] } },
  microIconGap: { kind: 'slider', label: 'Micro-icon spacing', group: 'alphaVisual', min: 16, max: 40, step: 1, default: 24, unit: 'px', showIf: { equals: ['hudMode', 'alpha'] }, hint: 'Spacing between the bottom-row micro icons.' },

  // --- Delta mode — Motion ---
  horizonBobSpeed: { kind: 'slider', label: 'Horizon bob speed', group: 'deltaMotion', min: 0, max: 2, step: 0.01, default: 0.35, modulatable: true, showIf: { equals: ['hudMode', 'delta'] } },
  reticlePulseSpeed: { kind: 'slider', label: 'Reticle pulse speed', group: 'deltaMotion', min: 0, max: 4, step: 0.01, default: 1.4, modulatable: true, showIf: { equals: ['hudMode', 'delta'] } },
  tickerSpeed: { kind: 'slider', label: 'Readout ticker speed', group: 'deltaMotion', min: 0, max: 5, step: 0.01, default: 1.0, modulatable: true, showIf: { equals: ['hudMode', 'delta'] } },
  outerRingSpeedDelta: { kind: 'slider', label: 'Outer ring speed', group: 'deltaMotion', min: -60, max: 60, step: 1, default: 5, unit: 'deg/s', modulatable: true, showIf: { equals: ['hudMode', 'delta'] } },
  deltaBandSpeedA: { kind: 'slider', label: 'Band A speed', group: 'deltaMotion', min: -90, max: 90, step: 1, default: 16, unit: 'deg/s', modulatable: true, showIf: { equals: ['hudMode', 'delta'] } },
  deltaBandSpeedB: { kind: 'slider', label: 'Band B speed', group: 'deltaMotion', min: -90, max: 90, step: 1, default: -11, unit: 'deg/s', modulatable: true, showIf: { equals: ['hudMode', 'delta'] } },

  // --- Delta mode — Visual ---
  horizonBobAmount: { kind: 'slider', label: 'Horizon bob amount', group: 'deltaVisual', min: 0, max: 15, step: 0.5, default: 4, unit: 'deg', showIf: { equals: ['hudMode', 'delta'] } },
  ladderCount: { kind: 'stepper', label: 'Pitch ladder count', group: 'deltaVisual', min: 1, max: 8, step: 1, default: 4, showIf: { equals: ['hudMode', 'delta'] } },
  ladderSpacing: { kind: 'slider', label: 'Pitch ladder spacing', group: 'deltaVisual', min: 10, max: 40, step: 1, default: 22, unit: 'px', showIf: { equals: ['hudMode', 'delta'] } },
  bracketLength: { kind: 'slider', label: 'Corner bracket length', group: 'deltaVisual', min: 8, max: 32, step: 1, default: 16, unit: 'px', showIf: { equals: ['hudMode', 'delta'] } },
  bracketWeight: { kind: 'slider', label: 'Corner bracket weight', group: 'deltaVisual', min: 1, max: 4, step: 0.1, default: 2, showIf: { equals: ['hudMode', 'delta'] } },
  outerRingColor: { kind: 'color', label: 'Outer ring color', group: 'deltaVisual', default: { r: 0.6, g: 0.95, b: 1.0, a: 0.45 }, showIf: { equals: ['hudMode', 'delta'] } },
  outerRingOpacity: { kind: 'slider', label: 'Outer ring opacity', group: 'deltaVisual', min: 0, max: 1, step: 0.02, default: 1, showIf: { equals: ['hudMode', 'delta'] }, hint: '0 hides it entirely.' },
  // Two independently-rotating arc bands just inside the outer ring —
  // "signature bands." Each has its own speed/direction (set apart in
  // the defaults above) so they continually pass each other instead of
  // staying locked together; deltaBandArc controls how much of the ring
  // each one covers, from a quarter-circle up to a full half-circle.
  deltaBandArc: { kind: 'slider', label: 'Signature band arc', group: 'deltaVisual', min: 60, max: 180, step: 1, default: 130, unit: 'deg', showIf: { equals: ['hudMode', 'delta'] }, hint: '90 = quarter circle, 180 = half circle.' },
  deltaBandInset: { kind: 'slider', label: 'Signature band inset', group: 'deltaVisual', min: 2, max: 30, step: 1, default: 10, unit: 'px', showIf: { equals: ['hudMode', 'delta'] }, hint: 'Gap between the bands and the outer ring.' },
  deltaBandWeight: { kind: 'slider', label: 'Signature band weight', group: 'deltaVisual', min: 0.5, max: 4, step: 0.1, default: 1.6, showIf: { equals: ['hudMode', 'delta'] } },
  deltaBandColor: { kind: 'color', label: 'Signature band color', group: 'deltaVisual', default: { r: 1.0, g: 0.35, b: 0.25, a: 0.85 }, showIf: { equals: ['hudMode', 'delta'] } },

  // --- Sigma mode — curved panel plates, a small-block ring, a dash
  // ring, and a triangular targeting reticle at center. The 4th HUD
  // language, per direct instruction (curved panels / small blocks /
  // dashes / triangular center reticle), added as a 4th `hudMode` value
  // alongside Radial/Alpha/Delta rather than a separate seed asset —
  // same file, same selector, same Motion/Visual grouping convention.

  // --- Sigma mode — Motion ---
  sigmaPanelSpeed: { kind: 'slider', label: 'Panel ring speed', group: 'sigmaMotion', min: -60, max: 60, step: 1, default: 6, unit: 'deg/s', modulatable: true, showIf: { equals: ['hudMode', 'sigma'] } },
  sigmaBlockSpeed: { kind: 'slider', label: 'Block ring speed', group: 'sigmaMotion', min: -90, max: 90, step: 1, default: -18, unit: 'deg/s', modulatable: true, showIf: { equals: ['hudMode', 'sigma'] } },
  sigmaDashSpeed: { kind: 'slider', label: 'Dash ring speed', group: 'sigmaMotion', min: -90, max: 90, step: 1, default: 26, unit: 'deg/s', modulatable: true, showIf: { equals: ['hudMode', 'sigma'] } },
  sigmaReticleSpeed: { kind: 'slider', label: 'Reticle spin speed', group: 'sigmaMotion', min: -60, max: 60, step: 1, default: 0, unit: 'deg/s', modulatable: true, showIf: { equals: ['hudMode', 'sigma'] }, hint: 'Defaults to 0 — a still reticle often reads better as a targeting mark.' },

  // --- Sigma mode — Visual ---
  sigmaPanelCount: { kind: 'stepper', label: 'Panel count', group: 'sigmaVisual', min: 3, max: 8, step: 1, default: 5, showIf: { equals: ['hudMode', 'sigma'] } },
  sigmaPanelArc: { kind: 'slider', label: 'Panel arc', group: 'sigmaVisual', min: 20, max: 70, step: 1, default: 42, unit: 'deg', showIf: { equals: ['hudMode', 'sigma'] }, hint: 'Angular width of each curved panel.' },
  sigmaPanelWeight: { kind: 'slider', label: 'Panel weight', group: 'sigmaVisual', min: 4, max: 24, step: 1, default: 12, showIf: { equals: ['hudMode', 'sigma'] } },
  sigmaBlockCount: { kind: 'stepper', label: 'Block count', group: 'sigmaVisual', min: 8, max: 40, step: 1, default: 20, showIf: { equals: ['hudMode', 'sigma'] } },
  sigmaBlockSize: { kind: 'slider', label: 'Block size', group: 'sigmaVisual', min: 2, max: 14, step: 0.5, default: 6, unit: 'px', showIf: { equals: ['hudMode', 'sigma'] } },
  sigmaDashCount: { kind: 'stepper', label: 'Dash count', group: 'sigmaVisual', min: 12, max: 60, step: 1, default: 30, showIf: { equals: ['hudMode', 'sigma'] } },
  sigmaDashLength: { kind: 'slider', label: 'Dash length', group: 'sigmaVisual', min: 0.02, max: 0.15, step: 0.005, default: 0.05, showIf: { equals: ['hudMode', 'sigma'] } },
  sigmaReticleSize: { kind: 'slider', label: 'Reticle size', group: 'sigmaVisual', min: 0.1, max: 0.4, step: 0.01, default: 0.22, showIf: { equals: ['hudMode', 'sigma'] }, hint: 'Fraction of the ring radius.' },
  sigmaReticleWeight: { kind: 'slider', label: 'Reticle weight', group: 'sigmaVisual', min: 0.5, max: 4, step: 0.1, default: 1.6, showIf: { equals: ['hudMode', 'sigma'] } },

  // Not mode-specific — applies regardless of which HUD mode is active.
  // Pinned to its own group, declared last, so it always renders as the
  // very last section in the drawer (below every mode's own controls,
  // including each mode's own Signature Band color), per direct
  // instruction, rather than sitting near the top where Scale/Glow live.
  pointerParallax: { kind: 'toggle', label: 'Pointer parallax', group: 'interaction', default: true, hint: 'The whole HUD subtly tracks the pointer.' },
};

function hash(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export default function sketch(p, get) {
  // Accumulated angles/phases per independently-controllable element —
  // integrated from each element's own speed every frame, not derived
  // from p.frameCount, so speed changes take effect smoothly rather
  // than jumping.
  let outerAngle = 0, segmentAngle = 0, tickAngle = 0, scanDotAngle = 0;
  let radialPulsePhase = 0;
  // Chase-lit outer dot ring's brightness sweep position — previously
  // driven straight off p.frameCount (see the chasePos fix below), which
  // broke the "integrated from speed every frame" rule this comment
  // describes for every other accumulator here: frameCount assumes a
  // fixed 60fps, so on any frame it isn't (a busy tab, a temporary dip
  // while another card promotes) the sweep's real-world speed visibly
  // wobbled even though nothing the person did changed. Integrated by dt
  // exactly like outerAngle etc. now, so it's frame-rate independent.
  let chasePhase = 0;
  // Radial's signature-band angles — separate accumulators from Delta's
  // deltaBandAAngle/deltaBandBAngle (see radialBandArc's schema doc for
  // why these are independently tunable rather than shared), started at
  // different baked-in angles for the same reason Delta's are: so they
  // never begin the loop aligned.
  let radialBandAAngle = Math.PI * 0.4;
  let radialBandBAngle = Math.PI * 1.3;
  // See the segmented-ring call site in drawRadial for the full doc —
  // caches the segmented ring's per-segment vertex geometry across
  // frames since it only depends on {count, roundness, radius, weight},
  // none of which change on a typical frame.
  let segmentGeomCache = null;
  let segmentGeomKey = '';
  let panelPhase = 0, scanlinePhase = 0;
  let horizonPhase = 0, reticlePhase = 0, tickerPhase = 0;
  let deltaRingAngle = 0;
  // Delta's two signature bands — distinct starting angles baked in so
  // they never begin the loop aligned, and independent speeds (set in
  // their params, defaults pointed in opposite directions) so they keep
  // passing each other rather than staying locked together.
  let deltaBandAAngle = Math.PI * 0.15;
  let deltaBandBAngle = Math.PI * 1.05;
  // Sigma's four independently-rotating elements — same "each moving
  // part gets its own accumulator, integrated by dt" convention as
  // every other mode in this file.
  let sigmaPanelAngle = 0, sigmaBlockAngle = 0, sigmaDashAngle = 0, sigmaReticleAngle = 0;
  let cx = 0, cy = 0, radius = 0;
  const rand = hash(0xf00d);
  const panelSeeds = Array.from({ length: 8 }, () => ({ dx: (rand() - 0.5) * 40, dy: (rand() - 0.5) * 40, phase: rand() * 6.283 }));
  // Alpha's bottom-row micro-icon cluster — a fixed [bars, LED matrix,
  // dial-knob, dial-knob, LED matrix, bars] sextet drawn as one
  // contiguous, centered row (see drawMicroRow) rather than the old
  // random-density scatter, and rather than the two corner-hugging
  // clusters this replaced (those visibly overlapped the DRIFT/STUTTER
  // corner readouts at ordinary tile sizes). Kept as two seed objects
  // purely so every one of the 6 instances gets its own fixed phase/
  // speed offset, seeded once here (not per-frame) — duplicated icons
  // of the same kind (bars appears twice, led twice, dial twice) would
  // otherwise move in lockstep with their mirror if they shared a seed.
  const microLeft = {
    bars: { phase: rand() * 6.283, speed: 0.8 + rand() * 0.4 },
    led: { phase: rand() * 6.283, speed: 0.8 + rand() * 0.4 },
    dial: { phase: rand() * 6.283, speed: 0.7 + rand() * 0.5 },
  };
  const microRight = {
    dial: { phase: rand() * 6.283, speed: 0.7 + rand() * 0.5 },
    led: { phase: rand() * 6.283, speed: 0.8 + rand() * 0.4 },
    bars: { phase: rand() * 6.283, speed: 0.8 + rand() * 0.4 },
  };
  // Delta's left/right tickers cycle through these instead of always
  // showing the same fixed pair — see drawDelta().
  const deltaReadouts = [
    { label: 'SPD', base: 220, amp: 18, freq: 1 },
    { label: 'ALT', base: 8400, amp: 120, freq: 0.8 },
    { label: 'HDG', base: 180, amp: 25, freq: 0.6 },
  ];

  function layout() {
    cx = p.width / 2;
    cy = p.height / 2;
    radius = Math.min(p.width, p.height) * 0.34 * get('scale');
  }

  function parallaxOffset() {
    if (!get('pointerParallax')) return { x: 0, y: 0 };
    const pointer = p.getCanvasPointer();
    if (!pointer.active) return { x: 0, y: 0 };
    const nx = (pointer.x / Math.max(1, p.width)) * 2 - 1;
    const ny = (pointer.y / Math.max(1, p.height)) * 2 - 1;
    return { x: nx * 10, y: ny * 10 };
  }

  /**
   * Scale multiplier for the Radial zoom-pulse. Only the segmented arc
   * ring pulses now — the outer ring/tickers and both dot rings all stay
   * geometrically fixed, per direct instruction: a single pulsing layer
   * reads as a cleaner, more deliberate accent than the previous
   * two-ring version, and skipping the extra per-frame recompute on the
   * outer ring + its tickers (the most vertex-heavy element in this
   * mode) is one less thing competing for frame budget on a busy board.
   * No more per-ring phase offset either — with only one ring left,
   * there was nothing left to offset it from (see radialZoomPulseOffset
   * removal note where the segmented ring is drawn).
   * Returns 1 (no-op) whenever Amount is 0, its default — consistent
   * with this file's existing modulatable-radial controls, which stay
   * fully inert until someone deliberately turns them on.
   */
  function radialPulseFactor() {
    const amount = get('radialZoomPulseAmount');
    if (amount <= 0) return 1;
    return 1 + amount * Math.sin(radialPulsePhase);
  }

  function ring(r, a0, a1, weight, col) {
    p.noFill();
    p.stroke(col.r, col.g, col.b, col.a);
    p.strokeWeight(weight);
    p.arc(0, 0, r * 2, r * 2, a0, a1);
  }

  /**
   * Radial's Glow, done as ONE post-process bloom pass over the whole
   * frame instead of per-shape `drawingContext.shadowBlur` — which is
   * how the other three modes do it, and which is genuinely expensive:
   * the browser recomputes a blur for every single stroke/fill made
   * while shadowBlur is active, and Radial alone draws upward of 90
   * shapes a frame (the segmented ring, both dot rings, the outer
   * ticks). Reintroducing that cost right after the previous pass spent
   * effort removing per-frame cost from this exact mode would directly
   * undercut it.
   *
   * Standard bloom recipe instead: snapshot what was just drawn, blur
   * ONE copy of it, composite that back on top with ADD blending. Cost
   * is now O(1) per frame — one snapshot, one blur, one composite —
   * regardless of how many shapes are in the HUD, rather than O(shapes).
   *
   * The blur buffer is kept at half resolution (glowLayer's own size)
   * and drawn back stretched to full size — cheaper to blur (1/4 the
   * pixels) and the extra softness from the upscale is desirable here,
   * not a defect; bloom effects in real-time engines are conventionally
   * done at reduced resolution for exactly this reason, not just as a
   * shortcut.
   */
  let glowLayer = null;

  function ensureGlowLayer() {
    const w = Math.max(1, Math.round(p.width * 0.5));
    const h = Math.max(1, Math.round(p.height * 0.5));
    if (!glowLayer || glowLayer.width !== w || glowLayer.height !== h) {
      if (glowLayer) glowLayer.remove();
      glowLayer = p.createGraphics(w, h);
    }
  }

  function applyRadialGlow(glowAmt, accent) {
    ensureGlowLayer();
    const snap = p.get(); // pixel snapshot of the frame as already drawn
    glowLayer.clear();
    glowLayer.image(snap, 0, 0, glowLayer.width, glowLayer.height); // downscale copy
    glowLayer.filter(p.BLUR, 3 + glowAmt * 3);
    p.push();
    p.blendMode(p.ADD);
    p.tint(accent.r * 255, accent.g * 255, accent.b * 255, 255 * Math.min(1, glowAmt));
    p.image(glowLayer, 0, 0, p.width, p.height); // upscale back over the sharp frame
    p.pop();
    p.blendMode(p.BLEND); // belt-and-suspenders on top of push/pop's own state restore
  }

  // A thick arc segment with continuously adjustable end roundness.
  // p5's strokeCap is only ever ROUND or SQUARE — no in-between — so a
  // real slider needs actual geometry, not a cap-style toggle: this
  // draws the body as a flat-capped arc pulled in slightly at both
  // ends, then adds filled round end-caps whose radius scales with
  // `roundness` (0 = they vanish, ends read as flat; 1 = they cover the
  // full pulled-in gap, ends read as fully rounded pills).
  // Samples a quarter-circle fillet between two locally-perpendicular
  // edges meeting at (cornerX, cornerY) — standard rounded-rectangle
  // corner construction. (tx,ty) and (nx,ny) are unit vectors pointing
  // INTO the shape along each of the two edges. Returns points from the
  // touch point on the t-edge to the touch point on the n-edge, so
  // callers can splice this directly into a vertex list.
  function filletPoints(cornerX, cornerY, tx, ty, nx, ny, rad, steps) {
    const cx = cornerX + rad * (tx + nx), cy = cornerY + rad * (ty + ny);
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      const theta = (i / steps) * (Math.PI / 2);
      const ux = -nx * Math.cos(theta) - tx * Math.sin(theta);
      const uy = -ny * Math.cos(theta) - ty * Math.sin(theta);
      pts.push([cx + rad * ux, cy + rad * uy]);
    }
    return pts;
  }

  // A thick arc segment with genuinely continuous corner roundness —
  // built as one closed polygon. Each end has TWO corners (outer and
  // inner), each rounded with its own quarter-circle fillet, connected
  // by a short straight radial segment between them — a single fillet
  // per end can't work, since a 90deg arc of radius `rad` only reaches
  // `rad` inward from its own corner, not all the way across the full
  // stroke thickness to the opposite corner (confirmed numerically:
  // the first version of this function left an ~19px gap at the exact
  // roundness value from the bug report). The radial segment between
  // the two fillets shrinks to zero length exactly when rad reaches
  // weight/2, at which point the two fillets meet and together form a
  // true semicircular cap — same continuous construction at every
  // roundness value, no special-casing the extremes.
  //
  // Split into pure geometry (this function, returns a plain point
  // list) and a separate draw step (drawSegmentPoints, below) so the
  // Radial segmented ring can cache the point lists across frames —
  // see segmentGeomCache's doc at that call site for why that matters.
  function computeRoundedSegmentPoints(r, a0, a1, weight, roundness) {
    const rOut = r + weight / 2, rIn = r - weight / 2;
    const rad = Math.min(weight / 2, (weight / 2) * roundness);
    const pullOut = rOut > 0 ? rad / rOut : 0;
    const pullIn = rIn > 0 ? rad / rIn : 0;
    const steps = 6;
    const pts = [];

    // Outer arc, a0 -> a1, pulled in at both ends.
    const oa0 = a0 + pullOut, oa1 = a1 - pullOut;
    for (let i = 0; i <= steps; i++) {
      const a = oa0 + (i / steps) * (oa1 - oa0);
      pts.push([Math.cos(a) * rOut, Math.sin(a) * rOut]);
    }

    if (rad > 0.01) {
      // Outer corner at a1: tangent = decreasing-angle arc direction, normal = inward.
      for (const pt of filletPoints(
        Math.cos(a1) * rOut, Math.sin(a1) * rOut,
        Math.sin(a1), -Math.cos(a1), -Math.cos(a1), -Math.sin(a1), rad, steps
      )) pts.push(pt);

      // Short straight radial segment at angle a1, from (rOut-rad) to (rIn+rad).
      pts.push([Math.cos(a1) * (rIn + rad), Math.sin(a1) * (rIn + rad)]);

      // Inner corner at a1: tangent = decreasing-angle arc direction (same), normal = outward.
      // Need the normal-edge touch point first (continuing from the radial
      // segment above) and the tangent-edge touch point last (continuing
      // into the inner arc below), so the fillet's natural point order
      // (tangent-first) is reversed here.
      const f = filletPoints(
        Math.cos(a1) * rIn, Math.sin(a1) * rIn,
        Math.sin(a1), -Math.cos(a1), Math.cos(a1), Math.sin(a1), rad, steps
      ).reverse();
      for (const pt of f) pts.push(pt);
    }

    // Inner arc, a1 -> a0 (reversed), pulled in the same way.
    const ia1 = a1 - pullIn, ia0 = a0 + pullIn;
    for (let i = 0; i <= steps; i++) {
      const a = ia1 - (i / steps) * (ia1 - ia0);
      pts.push([Math.cos(a) * rIn, Math.sin(a) * rIn]);
    }

    if (rad > 0.01) {
      // Inner corner at a0: tangent = increasing-angle arc direction, normal = outward.
      for (const pt of filletPoints(
        Math.cos(a0) * rIn, Math.sin(a0) * rIn,
        -Math.sin(a0), Math.cos(a0), Math.cos(a0), Math.sin(a0), rad, steps
      )) pts.push(pt);

      // Short straight radial segment at angle a0, from (rIn+rad) to (rOut-rad).
      pts.push([Math.cos(a0) * (rOut - rad), Math.sin(a0) * (rOut - rad)]);

      // Outer corner at a0: tangent = increasing-angle arc direction, normal = inward, normal-first.
      const f = filletPoints(
        Math.cos(a0) * rOut, Math.sin(a0) * rOut,
        -Math.sin(a0), Math.cos(a0), -Math.cos(a0), -Math.sin(a0), rad, steps
      ).reverse();
      for (const pt of f) pts.push(pt);
    }

    return pts;
  }

  function drawSegmentPoints(pts, col) {
    p.noStroke();
    p.fill(col.r, col.g, col.b, col.a);
    p.beginShape();
    for (const [x, y] of pts) p.vertex(x, y);
    p.endShape(p.CLOSE);
  }

  // ---------------- Radial mode ----------------
  function drawRadial(accent, dim) {
    p.push();
    p.translate(cx, cy);
    p.rotate(0);

    // Outer thin ring with floating tick marks. Labels that used to sit
    // outside these ticks are gone entirely now — removed per direct
    // instruction, not just pulled inward like the previous pass did.
    // Fixed radius, no zoom-pulse — per direct instruction, only the
    // segmented arc ring (below) breathes now. Keeps this ring and its
    // full tick set (the most vertex-heavy draw in this mode) out of the
    // per-frame pulse recompute entirely, which is both smoother to look
    // at and cheaper to render.
    p.push();
    p.rotate(outerAngle);
    const lineThick = get('lineThickness');
    ring(radius * 1.18, 0, p.TWO_PI, 1.5 * lineThick, dim);
    const outerTicks = Math.round(get('tickerCount'));
    const tickHeight = get('tickerHeight');
    const tickWeight = get('tickerThickness');
    const accentEvery = Math.max(2, Math.round(get('tickerAccentEvery')));
    const accentScale = get('tickerAccentScale');
    const angStep = p.TWO_PI / outerTicks;
    const r0Base = radius * 1.18;
    let accentIndex = 0;
    for (let i = 0; i < outerTicks; i++) {
      const a = i * angStep;
      const isAccent = (i % accentEvery) === (accentEvery - 1);

      if (!isAccent) {
        const r1 = radius * (1.18 + tickHeight);
        p.stroke(accent.r, accent.g, accent.b, accent.a * 0.8);
        p.strokeWeight(tickWeight);
        p.line(Math.cos(a) * r0Base, Math.sin(a) * r0Base, Math.cos(a) * r1, Math.sin(a) * r1);
        continue;
      }

      // Accent marker — alternates shape each time one comes up, so the
      // sequence reads as thin batch -> triangle -> thin batch -> thick
      // bar -> repeat, rather than every accent looking identical.
      const r1 = radius * (1.18 + tickHeight * accentScale);
      const useTriangle = (accentIndex % 2) === 0;
      accentIndex++;

      if (useTriangle) {
        const halfAng = angStep * 0.32;
        p.noStroke();
        p.fill(accent.r, accent.g, accent.b, accent.a * 0.95);
        p.beginShape();
        p.vertex(Math.cos(a) * r0Base, Math.sin(a) * r0Base);
        p.vertex(Math.cos(a - halfAng) * r1, Math.sin(a - halfAng) * r1);
        p.vertex(Math.cos(a + halfAng) * r1, Math.sin(a + halfAng) * r1);
        p.endShape(p.CLOSE);
      } else {
        p.stroke(accent.r, accent.g, accent.b, accent.a * 0.95);
        p.strokeWeight(tickWeight * accentScale);
        p.line(Math.cos(a) * r0Base, Math.sin(a) * r0Base, Math.cos(a) * r1, Math.sin(a) * r1);
      }
    }
    p.pop();

    // Segmented chunky arc ring — discrete rectangular blocks around a
    // circle, rotating at its own independent speed. The only ring the
    // zoom-pulse still touches — see radialPulseFactor's doc.
    //
    // This is where the reported stutter actually came from — not just
    // the frameCount-vs-dt bug fixed last round (that fixed the chase
    // ring's SPEED staying correct across dropped frames; it never made
    // any frame cheaper to produce). Each segment's rounded-corner
    // fillets are genuinely expensive geometry (computeRoundedSegmentPoints
    // runs ~4 trig-heavy corner constructions per segment), and every
    // segment's shape only depends on {count, roundness, weight, radius}
    // — none of which change on a typical frame; ROTATION is handled
    // entirely by the p.rotate(segmentAngle) transform below, not by
    // recomputing vertex positions. Recomputing all 32 segments' full
    // geometry from scratch every single frame regardless, even though
    // nothing shape-relevant had changed, was pure wasted work competing
    // for frame budget. Cached here: only rebuilt when the signature
    // actually changes (radius keeps changing every frame same as
    // before whenever the zoom-pulse is on — not a regression there,
    // since that's already the cost the pulse feature signs up for).
    p.push();
    p.rotate(segmentAngle);
    const segN = Math.round(get('segmentCount'));
    const segGap = 0.35;
    const segRoundness = get('segmentRoundness');
    const pulse1 = radialPulseFactor();
    const segR = radius * pulse1;
    const segWeight = radius * 0.16 * pulse1;
    const segKey = `${segN}|${segRoundness}|${segR.toFixed(2)}|${segWeight.toFixed(2)}`;
    if (segKey !== segmentGeomKey) {
      segmentGeomCache = [];
      for (let i = 0; i < segN; i++) {
        const a0 = (i / segN) * p.TWO_PI;
        const a1 = a0 + (p.TWO_PI / segN) * (1 - segGap);
        segmentGeomCache.push(computeRoundedSegmentPoints(segR, a0, a1, segWeight, segRoundness));
      }
      segmentGeomKey = segKey;
    }
    for (let i = 0; i < segN; i++) {
      const lit = (Math.floor((i + segmentAngle * 3) / 2) % 5) !== 0;
      const col = lit ? accent : dim;
      drawSegmentPoints(segmentGeomCache[i], col);
    }
    p.pop();

    // Signature band arcs — ported from Delta on request (see
    // radialBandArc's schema doc). Positioned as a fraction of the base
    // `radius`, not `radius * pulse1` and not a flat pixel inset from
    // the segmented ring — the original pixel-inset version couldn't
    // reach anywhere near the inner dot ring (radius * 0.62, below) on
    // most tile sizes, which is why the slider barely seemed to move it.
    // Fraction-based keeps it consistent with every other ring in this
    // file (0.62, 1.0, 1.14, 1.18 are all fractions of radius too), and
    // stays stationary through the zoom pulse the same way, by using the
    // base `radius` rather than a pulsed one.
    const bandArc = get('radialBandArc') * (Math.PI / 180);
    const bandR = radius * get('radialBandRadius');
    const bandCol = get('radialBandColor');
    p.noFill();
    p.stroke(bandCol.r, bandCol.g, bandCol.b, bandCol.a);
    p.strokeWeight(get('radialBandWeight'));
    p.arc(0, 0, bandR * 2, bandR * 2, radialBandAAngle - bandArc / 2, radialBandAAngle + bandArc / 2);
    p.arc(0, 0, bandR * 2, bandR * 2, radialBandBAngle - bandArc / 2, radialBandBAngle + bandArc / 2);

    // Inner dotted scan ring, opposite rotation for visual counter-motion.
    // Not part of the zoom-pulse — the two dot rings stay stationary in
    // radius (per direct instruction) so the pulse reads as one clean
    // outer-layer breathing effect rather than the whole HUD pumping at
    // once, and it's a little cheaper besides (no radialPulseFactor call
    // per frame for these two).
    p.push();
    p.rotate(scanDotAngle);
    const dotN = 48;
    const dotSizeMult = get('dotSize');
    for (let i = 0; i < dotN; i++) {
      const a = (i / dotN) * p.TWO_PI;
      const r = radius * 0.62;
      const pulse = 0.5 + 0.5 * Math.sin(a * 3 - scanDotAngle * 2);
      p.noStroke();
      p.fill(accent.r, accent.g, accent.b, accent.a * (0.3 + 0.5 * pulse));
      p.circle(Math.cos(a) * r, Math.sin(a) * r, (2 + 2 * pulse) * dotSizeMult);
    }
    p.pop();

    // Outer dot ring: a full 360deg ring of dots that both rotates
    // (tickAngle, driven by "Outer dot ring speed") and chases a
    // brightness pulse around itself (driven by "Dot ring pulse speed").
    // Replaces the old "dense data band," which was a fixed ~63deg arc
    // that never rotated — nothing in its render read any angle variable
    // at all, it only pulsed brightness in place. tickAngle itself used
    // to be accumulated every frame in the main draw loop and then never
    // read anywhere in this function — a second, separate dead-control
    // bug. Both are fixed together here by giving tickAngle a real ring
    // to drive. Also stationary against the zoom-pulse, same reasoning
    // as the scan-dot ring above.
    p.push();
    p.rotate(tickAngle);
    const ringDotN = 40;
    // *3 matches the original frameCount-driven sweep's real-world speed
    // at 60fps (frameCount * 0.05 == 3 units/sec at chaseSpeed 1), just
    // integrated by dt now instead of assumed frame rate.
    const chasePos = (chasePhase * 3) % ringDotN;
    for (let i = 0; i < ringDotN; i++) {
      const a = (i / ringDotN) * p.TWO_PI;
      const r = radius * 1.14;
      let dist = Math.abs(i - chasePos);
      dist = Math.min(dist, ringDotN - dist); // wrap-around distance, so the chase loops seamlessly
      const chaseLit = Math.max(0, 1 - dist / 4);
      const b = 0.25 + 0.75 * chaseLit;
      p.noStroke();
      p.fill(accent.r, accent.g, accent.b, accent.a * b);
      p.circle(Math.cos(a) * r, Math.sin(a) * r, (2.5 + chaseLit * 2.5) * dotSizeMult);
    }
    p.pop();

    // Three dots encircling the centre readout in a fixed triangular
    // formation. Deliberately synced to scanDotAngle — the same angle
    // driving the inner dotted scan ring above — so this orbits at
    // exactly that ring's speed rather than running its own clock, per
    // direct instruction. It only orbits: there's no radialPulseFactor
    // or frame-based size wobble here, so the triangle itself never
    // grows/shrinks, it just rotates as one rigid shape.
    p.push();
    p.rotate(scanDotAngle);
    const centreDotR = radius * 0.16;
    // Bumped from 2.6 to 3.6 — "slightly thicker in diameter," per direct
    // instruction.
    const centreDotSize = 3.6 * dotSizeMult;
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * p.TWO_PI - p.HALF_PI; // one vertex pointing straight up
      p.noStroke();
      p.fill(accent.r, accent.g, accent.b, accent.a * 0.85);
      p.circle(Math.cos(a) * centreDotR, Math.sin(a) * centreDotR, centreDotSize);
    }
    p.pop();

    // Centre readout.
    p.noStroke();
    p.fill(accent.r, accent.g, accent.b, accent.a * 0.7);
    p.textAlign(p.CENTER, p.CENTER);
    p.textSize(11);
    const val = (0.3 + 0.5 * (0.5 + 0.5 * Math.sin(p.frameCount * 0.015))).toFixed(2);
    p.text(val, 0, radius * 0.05);

    p.pop();
  }

  // ---------------- Alpha mode ----------------
  // --- Alpha micro-components: rotary dial knobs, LED dot-matrix grids
  // ("color block"), and segmented level-meter bars ("audio bars").
  // Arrow clusters and crosshair/target rings were removed — they read
  // as off-aesthetic against the rest of the HUD language. Drawn as two
  // fixed [bars, color block, knob] clusters on the same row as the
  // DRIFT / STUTTER corner readouts (see drawMicroRow), not scattered
  // freely across the panel. ---

  function drawDialKnob(x, y, r, angle, col) {
    p.noFill();
    p.stroke(col.r, col.g, col.b, col.a * 0.7);
    p.strokeWeight(1);
    p.circle(x, y, r * 2);
    p.line(x, y, x + Math.cos(angle) * r * 0.8, y + Math.sin(angle) * r * 0.8);
    p.noStroke();
    p.fill(col.r, col.g, col.b, col.a * 0.5);
    p.circle(x, y, r * 0.3);
  }

  function drawLedMatrix(x, y, cols, rows, cell, chasePos, col) {
    p.noStroke();
    const total = cols * rows;
    for (let i = 0; i < total; i++) {
      const gx = i % cols, gy = Math.floor(i / cols);
      let dist = Math.abs(i - chasePos);
      dist = Math.min(dist, total - dist);
      const lit = Math.max(0, 1 - dist / 2.5);
      p.fill(col.r, col.g, col.b, col.a * (0.15 + lit * 0.7));
      p.rect(x + gx * cell, y + gy * cell, cell * 0.7, cell * 0.7);
    }
  }

  function drawLevelBars(x, y, count, barW, maxH, phase, col) {
    p.noStroke();
    for (let i = 0; i < count; i++) {
      const h = maxH * (0.25 + 0.75 * (0.5 + 0.5 * Math.sin(phase + i * 0.9)));
      p.fill(col.r, col.g, col.b, col.a * 0.6);
      p.rect(x + i * (barW + 1.5), y - h, barW, h);
    }
  }

  // Draws one [bars, color block, knob] triplet centered on `x`, all
  // vertically centered on `rowY` so the cluster sits on the same row as
  // the DRIFT / STUTTER corner readouts rather than scattered through
  // the panel. `order` is left-to-right draw order for this cluster —
  // callers pass the mirrored order for the right-hand side.
  function drawMicroCluster(order, seeds, x, rowY, gap, time, accent) {
    for (let i = 0; i < order.length; i++) {
      const kind = order[i];
      const ix = x + i * gap;
      const seed = seeds[kind];
      const t = time * seed.speed + seed.phase;

      if (kind === 'bars') {
        // Bars draw upward from their y — pass the row's baseline so the
        // bar tops land above it, matching how the text sits above its
        // own baseline.
        drawLevelBars(ix - 10, rowY + 6, 5, 3, 13, t * 2, accent);
      } else if (kind === 'led') {
        // LED matrix draws downward from a top-left origin — offset by
        // half its footprint so it's vertically centered on the row.
        const chase = ((t * 2) % 12 + 12) % 12;
        drawLedMatrix(ix - 10, rowY - 7, 4, 3, 5, chase, accent);
      } else if (kind === 'dial') {
        drawDialKnob(ix, rowY, 7, t, accent);
      }
    }
  }

  function drawMicroRow(accent, time, baseW, baseH) {
    // Same row as the DRIFT / STUTTER corner readouts (cy + baseH*0.72),
    // nudged up slightly so the icons sit visually centered on that
    // line rather than overlapping the text baseline.
    const rowY = cy + baseH * 0.72 - 6;
    const gap = get('microIconGap');
    // One combined 6-icon row, centered on cx — replaces the previous
    // two separate clusters hugging the DRIFT/STUTTER corner readouts.
    // Hugging the corners put each cluster's start position close enough
    // to that corner's own label text width that they visibly overlapped
    // at ordinary tile sizes, worse at lower microIconGap values. A
    // centered row's total span is fixed by gap alone (max 5*40=200px),
    // comfortably inside baseW*0.62 (where the labels sit) even at the
    // smallest tiles this HUD renders at, so it clears both labels
    // across the control's whole range rather than only at some sizes.
    // microLeft/microRight stay as two distinct seed sources purely so
    // all 6 icons keep independently offset phase/speed (see their
    // declaration above) — same instances, laid out contiguously now
    // instead of split to opposite corners.
    const totalSpan = gap * 5; // 6 icons, 5 gaps between their centers
    const startX = cx - totalSpan / 2;
    drawMicroCluster(['bars', 'led', 'dial'], microLeft, startX, rowY, gap, time, accent);
    drawMicroCluster(['dial', 'led', 'bars'], microRight, startX + gap * 3, rowY, gap, time, accent);
  }

  function drawAlpha(accent, dim, glowAmt) {
    const n = Math.round(get('panelCount'));
    const op = get('panelOpacity');
    const baseW = radius * 2.1, baseH = radius * 1.5;
    const borderWeight = get('panelBorderWeight');
    const gridN = Math.round(get('panelGridDensity'));

    if (glowAmt > 0) {
      p.drawingContext.shadowBlur = 10 * glowAmt;
      p.drawingContext.shadowColor = `rgba(${accent.r * 255},${accent.g * 255},${accent.b * 255},0.5)`;
    }

    for (let i = 0; i < n; i++) {
      const seed = panelSeeds[i % panelSeeds.length];
      const depth = i / Math.max(1, n - 1);
      const drift = Math.sin(panelPhase + seed.phase) * (6 + depth * 10);
      const w = baseW * (0.55 + depth * 0.45);
      const h = baseH * (0.45 + depth * 0.4);
      const x = cx + seed.dx * 0.4 + drift;
      const y = cy + seed.dy * 0.4 + Math.cos(panelPhase * 0.7 + seed.phase) * 4;

      p.push();
      p.translate(x, y);
      p.noFill();
      p.stroke(accent.r, accent.g, accent.b, accent.a * op * (0.4 + depth * 0.6));
      p.strokeWeight(borderWeight);
      p.rectMode(p.CENTER);
      p.rect(0, 0, w, h, 4);

      // Fine grid texture inside the panel.
      p.stroke(accent.r, accent.g, accent.b, accent.a * op * 0.25);
      for (let g = 1; g < gridN; g++) {
        const gx = -w / 2 + (w / gridN) * g;
        p.line(gx, -h / 2, gx, h / 2);
      }
      p.pop();
    }

    // Scanline sweep across the whole HUD region.
    const sweepY = cy - baseH * 0.7 + (Math.sin(scanlinePhase) * 0.5 + 0.5) * baseH * 1.4;
    p.stroke(accent.r, accent.g, accent.b, accent.a * 0.5);
    p.strokeWeight(get('scanlineWeight'));
    p.line(cx - baseW * 0.6, sweepY, cx + baseW * 0.6, sweepY);

    drawMicroRow(accent, panelPhase * 3, baseW, baseH);

    // Corner readouts — all four now animate (FILTER/SPACE used to sit
    // static while DRIFT alone moved, reading as inert/decorative
    // rather than live instrument data).
    p.drawingContext.shadowBlur = 0;
    p.noStroke();
    p.fill(dim.r, dim.g, dim.b, dim.a);
    p.textSize(10);
    const filterVal = (94 + Math.sin(p.frameCount * 0.008) * 5).toFixed(1);
    const spaceVal = (40 + Math.cos(p.frameCount * 0.006) * 3).toFixed(1);
    const stutterVal = (96 + Math.sin(p.frameCount * 0.013 + 2.1) * 4).toFixed(1);
    p.textAlign(p.LEFT, p.TOP);
    p.text('FILTER  ' + filterVal, cx - baseW * 0.62, cy - baseH * 0.72);
    p.textAlign(p.RIGHT, p.TOP);
    p.text('SPACE  ' + spaceVal, cx + baseW * 0.62, cy - baseH * 0.72);
    p.textAlign(p.LEFT, p.BOTTOM);
    p.text('DRIFT  ' + (Math.sin(p.frameCount * 0.01) * 5).toFixed(1), cx - baseW * 0.62, cy + baseH * 0.72);
    p.textAlign(p.RIGHT, p.BOTTOM);
    p.text('STUTTER  ' + stutterVal, cx + baseW * 0.62, cy + baseH * 0.72);
  }

  // ---------------- Delta mode ----------------
  function drawDelta(accent, dim, glowAmt) {
    const w = radius * 2.4, h = radius * 1.8;
    const bob = Math.sin(horizonPhase) * get('horizonBobAmount') * (Math.PI / 180);

    if (glowAmt > 0) {
      p.drawingContext.shadowBlur = 12 * glowAmt;
      p.drawingContext.shadowColor = `rgba(${accent.r * 255},${accent.g * 255},${accent.b * 255},0.5)`;
    }

    // Outer circular HUD ring — its own rotation/color/opacity, drawn
    // first so everything else in the frame sits on top of it.
    const ringOp = get('outerRingOpacity');
    const ringR = Math.max(w, h) * 0.6;
    if (ringOp > 0) {
      const ringCol = get('outerRingColor');
      p.push();
      p.translate(cx, cy);
      p.rotate(deltaRingAngle);
      p.noFill();
      p.stroke(ringCol.r, ringCol.g, ringCol.b, ringCol.a * ringOp);
      p.strokeWeight(1.2);
      p.circle(0, 0, ringR * 2);
      const ringTicks = 24;
      for (let i = 0; i < ringTicks; i++) {
        const a = (i / ringTicks) * p.TWO_PI;
        const r0 = ringR, r1 = ringR + (i % 6 === 0 ? 10 : 5);
        p.line(Math.cos(a) * r0, Math.sin(a) * r0, Math.cos(a) * r1, Math.sin(a) * r1);
      }
      p.pop();

      // Two "signature band" arcs just inside the outer ring — each
      // rotates continuously at its own speed/direction (deltaBandSpeedA
      // vs deltaBandSpeedB default opposite signs), starting from
      // different baked-in angles, so they keep passing each other
      // rather than tracking together. Independent of the outer ring's
      // own rotation — these are a separate moving layer, not ticks
      // riding along with it.
      const bandArc = get('deltaBandArc') * (Math.PI / 180);
      const bandR = ringR - get('deltaBandInset');
      const bandCol = get('deltaBandColor');
      p.push();
      p.translate(cx, cy);
      p.noFill();
      p.stroke(bandCol.r, bandCol.g, bandCol.b, bandCol.a * ringOp);
      p.strokeWeight(get('deltaBandWeight'));
      p.arc(0, 0, bandR * 2, bandR * 2, deltaBandAAngle - bandArc / 2, deltaBandAAngle + bandArc / 2);
      p.arc(0, 0, bandR * 2, bandR * 2, deltaBandBAngle - bandArc / 2, deltaBandBAngle + bandArc / 2);
      p.pop();
    }

    p.push();
    p.translate(cx, cy);
    p.rotate(bob);

    // Horizon line.
    p.stroke(accent.r, accent.g, accent.b, accent.a * 0.9);
    p.strokeWeight(2);
    p.line(-w * 0.4, 0, w * 0.4, 0);

    // Pitch ladder — count and spacing both configurable now.
    p.stroke(accent.r, accent.g, accent.b, accent.a * 0.5);
    p.strokeWeight(1.2);
    const ladderN = Math.round(get('ladderCount'));
    const ladderSp = get('ladderSpacing');
    for (let i = 1; i <= ladderN; i++) {
      const yy = i * ladderSp;
      const ww = w * 0.14;
      p.line(-ww, -yy, ww, -yy);
      p.line(-ww, yy, ww, yy);
    }
    p.pop();

    // Centre reticle, pulsing.
    const pulse = 0.5 + 0.5 * Math.sin(reticlePhase);
    p.noFill();
    p.stroke(accent.r, accent.g, accent.b, accent.a * (0.6 + 0.4 * pulse));
    p.strokeWeight(1.5);
    p.circle(cx, cy, 14 + pulse * 4);
    p.line(cx - 22, cy, cx - 10, cy);
    p.line(cx + 10, cy, cx + 22, cy);
    p.line(cx, cy - 22, cx, cy - 10);

    // Corner brackets — length/weight configurable, plus a short
    // diagonal tick at the joint for a more layered reticle-bracket
    // look instead of a bare right-angle.
    const bx = w * 0.46, by = h * 0.46;
    const bl = get('bracketLength');
    p.stroke(accent.r, accent.g, accent.b, accent.a * 0.8);
    p.strokeWeight(get('bracketWeight'));
    const corners = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
    for (const [sx, sy] of corners) {
      const x = cx + sx * bx, y = cy + sy * by;
      p.line(x, y, x - sx * bl, y);
      p.line(x, y, x, y - sy * bl);
      p.line(x - sx * bl * 0.3, y - sy * bl * 0.3, x - sx * bl * 0.65, y - sy * bl * 0.65);
    }

    // Airspeed / altitude style tickers — now cycle between three data
    // types (SPD/ALT/HDG) instead of always showing the same pair, so
    // the readouts read as actually interchanging rather than static
    // labels with a wiggling number.
    p.drawingContext.shadowBlur = 0;
    p.noStroke();
    p.fill(dim.r, dim.g, dim.b, dim.a);
    p.textSize(13);
    const cyclePeriod = 4.2;
    const cycleIdx = Math.floor(tickerPhase / cyclePeriod) % deltaReadouts.length;
    const leftR = deltaReadouts[cycleIdx];
    const rightR = deltaReadouts[(cycleIdx + 1) % deltaReadouts.length];
    p.textAlign(p.RIGHT, p.CENTER);
    const leftVal = (leftR.base + Math.sin(tickerPhase * leftR.freq) * leftR.amp).toFixed(0);
    p.text(leftR.label + ' ' + leftVal, cx - bx - 4, cy);
    p.textAlign(p.LEFT, p.CENTER);
    const rightVal = (rightR.base + Math.cos(tickerPhase * rightR.freq * 0.8) * rightR.amp).toFixed(0);
    p.text(rightR.label + ' ' + rightVal, cx + bx + 4, cy);
  }

  // ---------------- Sigma mode ----------------
  // Curved panel plates, a small-block ring, a dash ring, and a
  // triangular targeting reticle at center — the sci-fi HUD language
  // from the reference screenshots (curved panels / small blocks /
  // dashes / triangular center reticle), distinct from Radial's rings,
  // Alpha's flat panels, and Delta's aviation horizon.
  function drawSigma(accent, dim, glowAmt) {
    p.push();
    p.translate(cx, cy);

    // shadowBlur set BEFORE the draw calls below, not after — Radial's
    // glow control is currently dead code for exactly the inverted
    // reason (see the sprint notes on that known issue), so this
    // deliberately follows Alpha's (correct) placement instead.
    if (glowAmt > 0) {
      p.drawingContext.shadowBlur = 12 * glowAmt;
      p.drawingContext.shadowColor = `rgba(${accent.r * 255},${accent.g * 255},${accent.b * 255},0.55)`;
    }

    // Curved panels — thick partial-arc "plates" with gaps between
    // them, rotating as one group. Reuses the same `ring()` primitive
    // Radial's outer ring uses (a stroked arc), just with a much
    // heavier weight so it reads as a solid plate rather than a line.
    p.push();
    p.rotate(sigmaPanelAngle);
    const panelN = Math.round(get('sigmaPanelCount'));
    const panelArc = get('sigmaPanelArc') * (Math.PI / 180);
    const panelWeight = get('sigmaPanelWeight');
    const panelR = radius * 1.02;
    for (let i = 0; i < panelN; i++) {
      const a0 = (i / panelN) * p.TWO_PI;
      const a1 = a0 + panelArc;
      const lit = i % 3 !== 0;
      ring(panelR, a0, a1, panelWeight, lit ? accent : dim);
    }
    p.pop();

    // Small blocks — a ring of tiny filled squares, each rotated to
    // face outward along its own radius, per direct instruction. Built
    // as a manually-rotated quad (four vertex()s from precomputed
    // cos/sin) rather than push()/rotate()/translate()/pop() per block —
    // that's 4 p5 transform-stack calls × up to 40 blocks = 160 calls a
    // frame for what's ultimately just "a small square at this angle."
    // Computing the four corners directly is the same math p5's own
    // rotate+translate would do internally, just without the matrix
    // push/pop overhead repeated per block.
    p.push();
    p.rotate(sigmaBlockAngle);
    const blockN = Math.round(get('sigmaBlockCount'));
    const blockSize = get('sigmaBlockSize');
    const blockR = radius * 0.82;
    const halfB = blockSize / 2;
    p.noStroke();
    for (let i = 0; i < blockN; i++) {
      const a = (i / blockN) * p.TWO_PI;
      const ca = Math.cos(a), sa = Math.sin(a);
      const lit = i % 4 === 0;
      const col = lit ? accent : dim;
      p.fill(col.r, col.g, col.b, col.a);
      // Square centered at (blockR, 0) in the block's own unrotated
      // frame, rotated by `a` about the origin: for a corner offset
      // (ox, oy) from that center, the rotated point is
      // ((blockR+ox)*ca - oy*sa, (blockR+ox)*sa + oy*ca).
      p.beginShape();
      p.vertex((blockR - halfB) * ca - (-halfB) * sa, (blockR - halfB) * sa + (-halfB) * ca);
      p.vertex((blockR + halfB) * ca - (-halfB) * sa, (blockR + halfB) * sa + (-halfB) * ca);
      p.vertex((blockR + halfB) * ca - (halfB) * sa, (blockR + halfB) * sa + (halfB) * ca);
      p.vertex((blockR - halfB) * ca - (halfB) * sa, (blockR - halfB) * sa + (halfB) * ca);
      p.endShape(p.CLOSE);
    }
    p.pop();

    // Dashes — short radial tick marks on their own ring and their own
    // independent rotation speed, per direct instruction.
    p.push();
    p.rotate(sigmaDashAngle);
    const dashN = Math.round(get('sigmaDashCount'));
    const dashLen = get('sigmaDashLength');
    const dashR0 = radius * 0.92, dashR1 = radius * (0.92 + dashLen);
    p.stroke(dim.r, dim.g, dim.b, dim.a);
    p.strokeWeight(1.4);
    for (let i = 0; i < dashN; i++) {
      const a = (i / dashN) * p.TWO_PI;
      p.line(Math.cos(a) * dashR0, Math.sin(a) * dashR0, Math.cos(a) * dashR1, Math.sin(a) * dashR1);
    }
    p.pop();

    // Centre triangular reticle — a triangle outline plus a short
    // outward tick at each corner, the standard targeting-reticle
    // language, per direct instruction ("a reticle that is in a
    // triangular shape in center"). Spin speed defaults to 0 — see
    // the sigmaReticleSpeed hint for why a still reticle is the more
    // typical read, but wired to its own accumulator the same as
    // every other moving element here, so it's a real option, not a
    // fixed decoration.
    p.push();
    p.rotate(sigmaReticleAngle);
    const retR = radius * get('sigmaReticleSize');
    const retW = get('sigmaReticleWeight');
    p.noFill();
    p.stroke(accent.r, accent.g, accent.b, accent.a);
    p.strokeWeight(retW);
    p.beginShape();
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * p.TWO_PI - p.HALF_PI;
      p.vertex(Math.cos(a) * retR, Math.sin(a) * retR);
    }
    p.endShape(p.CLOSE);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * p.TWO_PI - p.HALF_PI;
      const x0 = Math.cos(a) * retR, y0 = Math.sin(a) * retR;
      const x1 = Math.cos(a) * (retR * 1.35), y1 = Math.sin(a) * (retR * 1.35);
      p.line(x0, y0, x1, y1);
    }
    p.pop();

    p.drawingContext.shadowBlur = 0;
    p.pop();
  }

  p.setup = () => {
    p.createCanvas(p.windowWidth, p.windowHeight);
    p.canvas.style.touchAction = 'none';
    p.colorMode(p.RGB, 1, 1, 1, 1);
    p.textFont('monospace');
    layout();
  };

  p.windowResized = () => { p.resizeCanvas(p.windowWidth, p.windowHeight); layout(); };

  p.draw = () => {
    layout();
    const dt = Math.min(p.deltaTime, 100) / 1000;

    outerAngle += get('outerRingSpeed') * (Math.PI / 180) * dt;
    segmentAngle += get('segmentRingSpeed') * (Math.PI / 180) * dt;
    tickAngle += get('tickRingSpeed') * (Math.PI / 180) * dt;
    scanDotAngle += get('scanDotSpeed') * (Math.PI / 180) * dt;
    chasePhase += get('dataBandSpeed') * dt;
    radialPulsePhase += get('radialZoomPulseSpeed') * dt;
    radialBandAAngle += get('radialBandSpeedA') * (Math.PI / 180) * dt;
    radialBandBAngle += get('radialBandSpeedB') * (Math.PI / 180) * dt;
    panelPhase += get('panelDriftSpeed') * dt;
    scanlinePhase += get('scanlineSpeed') * dt;
    horizonPhase += get('horizonBobSpeed') * dt;
    reticlePhase += get('reticlePulseSpeed') * dt;
    tickerPhase += get('tickerSpeed') * dt;
    deltaRingAngle += get('outerRingSpeedDelta') * (Math.PI / 180) * dt;
    deltaBandAAngle += get('deltaBandSpeedA') * (Math.PI / 180) * dt;
    deltaBandBAngle += get('deltaBandSpeedB') * (Math.PI / 180) * dt;
    sigmaPanelAngle += get('sigmaPanelSpeed') * (Math.PI / 180) * dt;
    sigmaBlockAngle += get('sigmaBlockSpeed') * (Math.PI / 180) * dt;
    sigmaDashAngle += get('sigmaDashSpeed') * (Math.PI / 180) * dt;
    sigmaReticleAngle += get('sigmaReticleSpeed') * (Math.PI / 180) * dt;

    const bg = get('bgColor');
    p.background(bg.r, bg.g, bg.b);

    const accent = get('accentColor');
    const dim = get('dimColor');
    const glowAmt = get('glow');
    const offset = parallaxOffset();

    p.push();
    p.translate(offset.x, offset.y);

    const mode = get('hudMode');
    if (mode === 'alpha') drawAlpha(accent, dim, glowAmt);
    else if (mode === 'delta') drawDelta(accent, dim, glowAmt);
    else if (mode === 'sigma') drawSigma(accent, dim, glowAmt);
    else drawRadial(accent, dim);

    p.pop();
    p.drawingContext.shadowBlur = 0;

    // Radial's Glow, as a single post-process bloom pass rather than
    // per-shape shadowBlur — see applyRadialGlow's doc for why. Alpha,
    // Delta, and Sigma keep their existing per-shape shadowBlur
    // approach; not migrated in this pass, since that wasn't what was
    // reported broken, and Radial is by far the most element-dense of
    // the four (the one where per-shape blur cost is worst).
    if (mode === 'radial' && glowAmt > 0) applyRadialGlow(glowAmt, accent);
  };
}
