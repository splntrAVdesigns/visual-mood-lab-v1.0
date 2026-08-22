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
    kind: 'select', label: 'HUD mode', default: 'radial',
    options: [
      { value: 'radial', label: '3D Radial' },
      { value: 'alpha', label: 'Alpha' },
      { value: 'delta', label: 'Delta' },
    ],
  },

  scale: { kind: 'slider', label: 'Scale', min: 0.5, max: 1.4, step: 0.01, default: 1.0 },
  pointerParallax: { kind: 'toggle', label: 'Pointer parallax', default: true, hint: 'The whole HUD subtly tracks the pointer, like a targeting system.' },
  glow: { kind: 'slider', label: 'Glow', min: 0, max: 2, step: 0.01, default: 0.8 },
  accentColor: { kind: 'color', label: 'Accent', default: { r: 0.6, g: 0.95, b: 1.0, a: 1 } },
  dimColor: { kind: 'color', label: 'Dim elements', default: { r: 0.6, g: 0.95, b: 1.0, a: 0.35 } },
  bgColor: { kind: 'color', label: 'Background', default: { r: 0.02, g: 0.03, b: 0.05, a: 1 } },

  // --- Radial mode ---
  // Grouped by which ring/element each control affects, not by when it
  // was added — rotation speeds first (the original set), then each
  // ring's own shape controls together, shared/general controls last.
  outerRingSpeed: { kind: 'slider', label: 'Outer ring speed', min: -60, max: 60, step: 1, default: 8, unit: 'deg/s', modulatable: true, showIf: { equals: ['hudMode', 'radial'] } },
  segmentRingSpeed: { kind: 'slider', label: 'Segment arc speed', min: -60, max: 60, step: 1, default: -14, unit: 'deg/s', modulatable: true, showIf: { equals: ['hudMode', 'radial'] } },
  tickRingSpeed: { kind: 'slider', label: 'Outer dot ring speed', min: -90, max: 90, step: 1, default: 22, unit: 'deg/s', modulatable: true, showIf: { equals: ['hudMode', 'radial'] } },
  scanDotSpeed: { kind: 'slider', label: 'Scan dot speed', min: -180, max: 180, step: 1, default: -60, unit: 'deg/s', modulatable: true, showIf: { equals: ['hudMode', 'radial'] } },
  dataBandSpeed: { kind: 'slider', label: 'Dot ring pulse speed', min: 0, max: 4, step: 0.01, default: 1.2, modulatable: true, showIf: { equals: ['hudMode', 'radial'] } },

  segmentCount: { kind: 'stepper', label: 'Segment count', min: 8, max: 32, step: 1, default: 18, showIf: { equals: ['hudMode', 'radial'] } },
  segmentRoundness: { kind: 'slider', label: 'Segment roundness', min: 0, max: 1, step: 0.02, default: 0.5, showIf: { equals: ['hudMode', 'radial'] }, hint: '0 = flat-ended blocks, 1 = fully rounded pills.' },

  tickerCount: { kind: 'stepper', label: 'Outer ticker count', min: 4, max: 40, step: 1, default: 16, showIf: { equals: ['hudMode', 'radial'] } },
  tickerHeight: { kind: 'slider', label: 'Outer ticker height', min: 0.02, max: 0.25, step: 0.005, default: 0.10, showIf: { equals: ['hudMode', 'radial'] } },
  tickerThickness: { kind: 'slider', label: 'Outer ticker thickness', min: 0.5, max: 4, step: 0.1, default: 2, showIf: { equals: ['hudMode', 'radial'] } },

  dotSize: { kind: 'slider', label: 'Dot size', min: 0.5, max: 3, step: 0.05, default: 1.0, showIf: { equals: ['hudMode', 'radial'] }, hint: 'Scales both the scan-dot ring and the outer dot ring together.' },
  lineThickness: { kind: 'slider', label: 'Line thickness', min: 0.5, max: 3, step: 0.05, default: 1.0, showIf: { equals: ['hudMode', 'radial'] }, hint: 'Scales the outer ring line and its tick marks.' },

  // --- Alpha mode ---
  panelCount: { kind: 'stepper', label: 'Panel count', min: 2, max: 6, step: 1, default: 4, showIf: { equals: ['hudMode', 'alpha'] } },
  panelDriftSpeed: { kind: 'slider', label: 'Panel drift speed', min: 0, max: 2, step: 0.01, default: 0.4, modulatable: true, showIf: { equals: ['hudMode', 'alpha'] } },
  scanlineSpeed: { kind: 'slider', label: 'Scanline speed', min: 0, max: 3, step: 0.01, default: 0.8, unit: 'px/s×100', modulatable: true, showIf: { equals: ['hudMode', 'alpha'] } },
  panelOpacity: { kind: 'slider', label: 'Panel opacity', min: 0.1, max: 0.9, step: 0.01, default: 0.4, showIf: { equals: ['hudMode', 'alpha'] } },
  panelBorderWeight: { kind: 'slider', label: 'Panel border weight', min: 0.5, max: 4, step: 0.1, default: 1, showIf: { equals: ['hudMode', 'alpha'] } },
  scanlineWeight: { kind: 'slider', label: 'Scanline weight', min: 0.5, max: 4, step: 0.1, default: 1.5, showIf: { equals: ['hudMode', 'alpha'] } },
  panelGridDensity: { kind: 'stepper', label: 'Panel grid density', min: 2, max: 14, step: 1, default: 6, showIf: { equals: ['hudMode', 'alpha'] } },
  microIconGap: { kind: 'slider', label: 'Micro-icon spacing', min: 16, max: 40, step: 1, default: 24, unit: 'px', showIf: { equals: ['hudMode', 'alpha'] }, hint: 'Spacing between the knob / color block / bars icons in each corner cluster.' },

  // --- Delta mode ---
  horizonBobSpeed: { kind: 'slider', label: 'Horizon bob speed', min: 0, max: 2, step: 0.01, default: 0.35, modulatable: true, showIf: { equals: ['hudMode', 'delta'] } },
  horizonBobAmount: { kind: 'slider', label: 'Horizon bob amount', min: 0, max: 15, step: 0.5, default: 4, unit: 'deg', showIf: { equals: ['hudMode', 'delta'] } },
  reticlePulseSpeed: { kind: 'slider', label: 'Reticle pulse speed', min: 0, max: 4, step: 0.01, default: 1.4, modulatable: true, showIf: { equals: ['hudMode', 'delta'] } },
  tickerSpeed: { kind: 'slider', label: 'Readout ticker speed', min: 0, max: 5, step: 0.01, default: 1.0, modulatable: true, showIf: { equals: ['hudMode', 'delta'] } },
  ladderCount: { kind: 'stepper', label: 'Pitch ladder count', min: 1, max: 8, step: 1, default: 4, showIf: { equals: ['hudMode', 'delta'] } },
  ladderSpacing: { kind: 'slider', label: 'Pitch ladder spacing', min: 10, max: 40, step: 1, default: 22, unit: 'px', showIf: { equals: ['hudMode', 'delta'] } },
  bracketLength: { kind: 'slider', label: 'Corner bracket length', min: 8, max: 32, step: 1, default: 16, unit: 'px', showIf: { equals: ['hudMode', 'delta'] } },
  bracketWeight: { kind: 'slider', label: 'Corner bracket weight', min: 1, max: 4, step: 0.1, default: 2, showIf: { equals: ['hudMode', 'delta'] } },
  outerRingSpeedDelta: { kind: 'slider', label: 'Outer ring speed', min: -60, max: 60, step: 1, default: 5, unit: 'deg/s', modulatable: true, showIf: { equals: ['hudMode', 'delta'] } },
  outerRingColor: { kind: 'color', label: 'Outer ring color', default: { r: 0.6, g: 0.95, b: 1.0, a: 0.45 }, showIf: { equals: ['hudMode', 'delta'] } },
  outerRingOpacity: { kind: 'slider', label: 'Outer ring opacity', min: 0, max: 1, step: 0.02, default: 1, showIf: { equals: ['hudMode', 'delta'] }, hint: '0 hides it entirely.' },

  // Two independently-rotating arc bands just inside the outer ring —
  // "signature bands." Each has its own speed/direction (set apart in
  // the defaults below) so they continually pass each other instead of
  // staying locked together; deltaBandArc controls how much of the ring
  // each one covers, from a quarter-circle up to a full half-circle.
  deltaBandArc: { kind: 'slider', label: 'Signature band arc', min: 60, max: 180, step: 1, default: 130, unit: 'deg', showIf: { equals: ['hudMode', 'delta'] }, hint: 'Angular length of each rotating band — 90 is a quarter circle, 180 is a half circle.' },
  deltaBandInset: { kind: 'slider', label: 'Signature band inset', min: 2, max: 30, step: 1, default: 10, unit: 'px', showIf: { equals: ['hudMode', 'delta'] }, hint: 'Gap between the bands and the outer ring, so they read as a distinct inner layer.' },
  deltaBandWeight: { kind: 'slider', label: 'Signature band weight', min: 0.5, max: 4, step: 0.1, default: 1.6, showIf: { equals: ['hudMode', 'delta'] } },
  deltaBandSpeedA: { kind: 'slider', label: 'Band A speed', min: -90, max: 90, step: 1, default: 16, unit: 'deg/s', modulatable: true, showIf: { equals: ['hudMode', 'delta'] } },
  deltaBandSpeedB: { kind: 'slider', label: 'Band B speed', min: -90, max: 90, step: 1, default: -11, unit: 'deg/s', modulatable: true, showIf: { equals: ['hudMode', 'delta'] } },
  deltaBandColor: { kind: 'color', label: 'Signature band color', default: { r: 1.0, g: 0.35, b: 0.25, a: 0.85 }, showIf: { equals: ['hudMode', 'delta'] } },
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
  let panelPhase = 0, scanlinePhase = 0;
  let horizonPhase = 0, reticlePhase = 0, tickerPhase = 0;
  let deltaRingAngle = 0;
  // Delta's two signature bands — distinct starting angles baked in so
  // they never begin the loop aligned, and independent speeds (set in
  // their params, defaults pointed in opposite directions) so they keep
  // passing each other rather than staying locked together.
  let deltaBandAAngle = Math.PI * 0.15;
  let deltaBandBAngle = Math.PI * 1.05;
  let cx = 0, cy = 0, radius = 0;
  const rand = hash(0xf00d);
  const panelSeeds = Array.from({ length: 8 }, () => ({ dx: (rand() - 0.5) * 40, dy: (rand() - 0.5) * 40, phase: rand() * 6.283 }));
  // Alpha's bottom-row micro-icon clusters — one hugging the DRIFT
  // readout, one hugging STUTTER, each a fixed [bars, color block,
  // knob] triplet (mirrored on the right) rather than the old
  // random-density scatter. Every instance gets its own fixed phase/
  // speed offset, seeded once here (not per-frame), so duplicated icons
  // of the same type never move in lockstep with each other.
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
    const nx = (p.mouseX / Math.max(1, p.width)) * 2 - 1;
    const ny = (p.mouseY / Math.max(1, p.height)) * 2 - 1;
    return { x: nx * 10, y: ny * 10 };
  }

  function ring(r, a0, a1, weight, col) {
    p.noFill();
    p.stroke(col.r, col.g, col.b, col.a);
    p.strokeWeight(weight);
    p.arc(0, 0, r * 2, r * 2, a0, a1);
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
  function roundedSegment(r, a0, a1, weight, roundness, col) {
    const rOut = r + weight / 2, rIn = r - weight / 2;
    const rad = Math.min(weight / 2, (weight / 2) * roundness);
    const pullOut = rOut > 0 ? rad / rOut : 0;
    const pullIn = rIn > 0 ? rad / rIn : 0;
    const steps = 6;

    p.noStroke();
    p.fill(col.r, col.g, col.b, col.a);
    p.beginShape();

    // Outer arc, a0 -> a1, pulled in at both ends.
    const oa0 = a0 + pullOut, oa1 = a1 - pullOut;
    for (let i = 0; i <= steps; i++) {
      const a = oa0 + (i / steps) * (oa1 - oa0);
      p.vertex(Math.cos(a) * rOut, Math.sin(a) * rOut);
    }

    if (rad > 0.01) {
      // Outer corner at a1: tangent = decreasing-angle arc direction, normal = inward.
      for (const [px, py] of filletPoints(
        Math.cos(a1) * rOut, Math.sin(a1) * rOut,
        Math.sin(a1), -Math.cos(a1), -Math.cos(a1), -Math.sin(a1), rad, steps
      )) p.vertex(px, py);

      // Short straight radial segment at angle a1, from (rOut-rad) to (rIn+rad).
      p.vertex(Math.cos(a1) * (rIn + rad), Math.sin(a1) * (rIn + rad));

      // Inner corner at a1: tangent = decreasing-angle arc direction (same), normal = outward.
      // Need the normal-edge touch point first (continuing from the radial
      // segment above) and the tangent-edge touch point last (continuing
      // into the inner arc below), so the fillet's natural point order
      // (tangent-first) is reversed here.
      const f = filletPoints(
        Math.cos(a1) * rIn, Math.sin(a1) * rIn,
        Math.sin(a1), -Math.cos(a1), Math.cos(a1), Math.sin(a1), rad, steps
      ).reverse();
      for (const [px, py] of f) p.vertex(px, py);
    }

    // Inner arc, a1 -> a0 (reversed), pulled in the same way.
    const ia1 = a1 - pullIn, ia0 = a0 + pullIn;
    for (let i = 0; i <= steps; i++) {
      const a = ia1 - (i / steps) * (ia1 - ia0);
      p.vertex(Math.cos(a) * rIn, Math.sin(a) * rIn);
    }

    if (rad > 0.01) {
      // Inner corner at a0: tangent = increasing-angle arc direction, normal = outward.
      for (const [px, py] of filletPoints(
        Math.cos(a0) * rIn, Math.sin(a0) * rIn,
        -Math.sin(a0), Math.cos(a0), Math.cos(a0), Math.sin(a0), rad, steps
      )) p.vertex(px, py);

      // Short straight radial segment at angle a0, from (rIn+rad) to (rOut-rad).
      p.vertex(Math.cos(a0) * (rOut - rad), Math.sin(a0) * (rOut - rad));

      // Outer corner at a0: tangent = increasing-angle arc direction, normal = inward, normal-first.
      const f = filletPoints(
        Math.cos(a0) * rOut, Math.sin(a0) * rOut,
        -Math.sin(a0), Math.cos(a0), -Math.cos(a0), -Math.sin(a0), rad, steps
      ).reverse();
      for (const [px, py] of f) p.vertex(px, py);
    }

    p.endShape(p.CLOSE);
  }

  // ---------------- Radial mode ----------------
  function drawRadial(accent, dim, glowAmt) {
    p.push();
    p.translate(cx, cy);
    p.rotate(0);

    // Outer thin ring with floating tick marks. Labels that used to sit
    // outside these ticks are gone entirely now — removed per direct
    // instruction, not just pulled inward like the previous pass did.
    p.push();
    p.rotate(outerAngle);
    const lineThick = get('lineThickness');
    ring(radius * 1.18, 0, p.TWO_PI, 1.5 * lineThick, dim);
    const outerTicks = Math.round(get('tickerCount'));
    const tickHeight = get('tickerHeight');
    const tickWeight = get('tickerThickness');
    for (let i = 0; i < outerTicks; i++) {
      const a = (i / outerTicks) * p.TWO_PI;
      const r0 = radius * 1.18, r1 = radius * (1.18 + tickHeight);
      const x0 = Math.cos(a) * r0, y0 = Math.sin(a) * r0;
      const x1 = Math.cos(a) * r1, y1 = Math.sin(a) * r1;
      p.stroke(accent.r, accent.g, accent.b, accent.a * 0.8);
      p.strokeWeight(tickWeight);
      p.line(x0, y0, x1, y1);
    }
    p.pop();

    // Segmented chunky arc ring — discrete rectangular blocks around a
    // circle, rotating at its own independent speed.
    p.push();
    p.rotate(segmentAngle);
    const segN = Math.round(get('segmentCount'));
    const segGap = 0.35;
    const segRoundness = get('segmentRoundness');
    for (let i = 0; i < segN; i++) {
      const a0 = (i / segN) * p.TWO_PI;
      const a1 = a0 + (p.TWO_PI / segN) * (1 - segGap);
      const lit = (Math.floor((i + segmentAngle * 3) / 2) % 5) !== 0;
      const col = lit ? accent : dim;
      roundedSegment(radius, a0, a1, radius * 0.16, segRoundness, col);
    }
    p.pop();

    // Inner dotted scan ring, opposite rotation for visual counter-motion.
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
    // to drive.
    p.push();
    p.rotate(tickAngle);
    const ringDotN = 40;
    const chaseSpeed = get('dataBandSpeed');
    const chasePos = (p.frameCount * 0.05 * chaseSpeed) % ringDotN;
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

    // Centre readout.
    p.noStroke();
    p.fill(accent.r, accent.g, accent.b, accent.a * 0.7);
    p.textAlign(p.CENTER, p.CENTER);
    p.textSize(11);
    const val = (0.3 + 0.5 * (0.5 + 0.5 * Math.sin(p.frameCount * 0.015))).toFixed(2);
    p.text(val, 0, radius * 0.05);

    if (glowAmt > 0) {
      p.drawingContext.shadowBlur = 16 * glowAmt;
      p.drawingContext.shadowColor = `rgba(${accent.r * 255},${accent.g * 255},${accent.b * 255},0.6)`;
    }
    p.pop();
    p.drawingContext.shadowBlur = 0;
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
    // Left cluster hugs DRIFT (left edge), right cluster hugs STUTTER
    // (right edge), each pulled in from its label rather than sitting on
    // top of it — "in center" between the two readouts, not scattered
    // across the whole panel.
    const leftX = cx - baseW * 0.42;
    const rightX = cx + baseW * 0.42 - gap * 2;
    drawMicroCluster(['bars', 'led', 'dial'], microLeft, leftX, rowY, gap, time, accent);
    drawMicroCluster(['dial', 'led', 'bars'], microRight, rightX, rowY, gap, time, accent);
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

  p.setup = () => {
    p.createCanvas(p.windowWidth, p.windowHeight);
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
    panelPhase += get('panelDriftSpeed') * dt;
    scanlinePhase += get('scanlineSpeed') * dt;
    horizonPhase += get('horizonBobSpeed') * dt;
    reticlePhase += get('reticlePulseSpeed') * dt;
    tickerPhase += get('tickerSpeed') * dt;
    deltaRingAngle += get('outerRingSpeedDelta') * (Math.PI / 180) * dt;
    deltaBandAAngle += get('deltaBandSpeedA') * (Math.PI / 180) * dt;
    deltaBandBAngle += get('deltaBandSpeedB') * (Math.PI / 180) * dt;

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
    else drawRadial(accent, dim, glowAmt);

    p.pop();
    p.drawingContext.shadowBlur = 0;
  };
}
