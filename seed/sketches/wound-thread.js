/** wound-thread — a single continuous thread, physically simulated, that
    traces a chosen silhouette (or nothing, in Free Weave). Click and drag
    anywhere on the canvas to push the thread; it eases back into shape
    once released. Every preset is one unbroken path, same as real thread
    can't jump between disconnected pieces — these read as stylized
    single-line-art silhouettes, not literal illustrations. */

export const params = {
  shape:            { kind: 'select', label: 'Shape', options: [
                        { label: 'Face', value: 'FACE' },
                        { label: 'Rat', value: 'RAT' },
                        { label: 'Brain', value: 'BRAIN' },
                        { label: 'Gift Box', value: 'BOX' },
                        { label: 'Free Weave', value: 'FREE' },
                      ], default: 'FACE' },
  pointCount:       { kind: 'stepper', label: 'Thread Points', min: 60, max: 180, step: 10, default: 120 },
  shapeStrength:    { kind: 'slider', label: 'Shape Memory', min: 0.02, max: 1, step: 0.01, default: 0.35, modulatable: true, hint: 'How strongly the thread pulls back into the chosen shape.' },
  neighborStiffness: { kind: 'slider', label: 'Thread Stiffness', min: 0, max: 1, step: 0.01, default: 0.5, hint: 'How much a push pulls neighboring points along with it.' },
  pushStrength:     { kind: 'slider', label: 'Push Strength', min: 0, max: 10, step: 0.1, default: 4 },
  pushRadius:       { kind: 'slider', label: 'Push Radius', min: 20, max: 300, step: 5, default: 120 },
  damping:          { kind: 'slider', label: 'Damping', min: 0.7, max: 0.98, step: 0.005, default: 0.9 },
  pulseRate:        { kind: 'slider', label: 'Pulse Rate', min: 0, max: 2, step: 0.01, default: 0.5, hint: 'Slow heartbeat-like thickness pulse.' },
  threadColor:      { kind: 'color', label: 'Thread Color', default: { r: 0.75, g: 0.15, b: 0.2, a: 1 } },
};

// ---- Catmull-Rom spline through a waypoint list, resampled to even arc-length spacing ----

function catmullRom(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  const x = 0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t
    + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2
    + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3);
  const y = 0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t
    + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2
    + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);
  return [x, y];
}

function sampleSpline(waypoints, samplesPerSegment) {
  const wp = waypoints;
  const dense = [];
  for (let i = 0; i < wp.length - 1; i++) {
    const p0 = wp[Math.max(i - 1, 0)];
    const p1 = wp[i];
    const p2 = wp[i + 1];
    const p3 = wp[Math.min(i + 2, wp.length - 1)];
    for (let s = 0; s < samplesPerSegment; s++) {
      dense.push(catmullRom(p0, p1, p2, p3, s / samplesPerSegment));
    }
  }
  dense.push(wp[wp.length - 1]);
  return dense;
}

// Resamples a dense polyline to N points evenly spaced by arc length, so
// the thread's points distribute uniformly along the path regardless of
// how unevenly the original waypoints were spaced.
function resampleEven(dense, n) {
  const lengths = [0];
  for (let i = 1; i < dense.length; i++) {
    const dx = dense[i][0] - dense[i - 1][0];
    const dy = dense[i][1] - dense[i - 1][1];
    lengths.push(lengths[i - 1] + Math.hypot(dx, dy));
  }
  const total = lengths[lengths.length - 1] || 1;
  const out = [];
  let seg = 1;
  for (let k = 0; k < n; k++) {
    const target = (k / (n - 1)) * total;
    while (seg < lengths.length - 1 && lengths[seg] < target) seg++;
    const segStart = lengths[seg - 1], segEnd = lengths[seg];
    const segT = segEnd > segStart ? (target - segStart) / (segEnd - segStart) : 0;
    const a = dense[seg - 1], b = dense[seg];
    out.push([a[0] + (b[0] - a[0]) * segT, a[1] + (b[1] - a[1]) * segT]);
  }
  return out;
}

// ---- Shape waypoints, normalized roughly to [-1, 1] ----

const FACE_WP = [
  [-0.55, 0.65], [-0.75, 0.35], [-0.8, -0.05], [-0.65, -0.5], [-0.3, -0.8],
  [0, -0.88], [0.3, -0.8], [0.65, -0.5], [0.8, -0.05], [0.75, 0.35],
  [0.55, 0.65], [0.2, 0.78], [0, 0.7],
  [-0.15, 0.62], [0, 0.68], [0.15, 0.62], [0, 0.58],
  [0.04, 0.3], [-0.04, 0.05], [0.04, -0.05],
  [0.28, -0.15], [0.4, -0.22], [0.28, -0.3], [0.16, -0.22], [0.28, -0.15],
  [-0.28, -0.15], [-0.4, -0.22], [-0.28, -0.3], [-0.16, -0.22], [-0.28, -0.15],
  [0, -0.4],
];

const RAT_WP = [
  [0.55, 0.28], [0.5, -0.05], [0.25, -0.32], [-0.1, -0.4], [-0.35, -0.3],
  [-0.35, -0.45], [-0.45, -0.6], [-0.28, -0.62], [-0.22, -0.48], [-0.35, -0.42],
  [-0.55, -0.28], [-0.68, -0.05], [-0.7, 0.05], [-0.6, 0.18], [-0.4, 0.22],
  [-0.28, 0.36], [-0.05, 0.46], [0.25, 0.44], [0.48, 0.34], [0.55, 0.28],
  [0.8, 0.22], [1.0, 0.02], [1.02, -0.22], [0.85, -0.34], [0.68, -0.26],
  [0.6, -0.1], [0.68, 0.05], [0.82, 0.02],
];

const BOX_WP = [
  [-0.5, 0.6], [0.5, 0.6], [0.5, -0.1], [-0.5, -0.1], [-0.5, 0.6],
  [-0.06, 0.6], [-0.06, -0.1], [-0.06, -0.35],
  [-0.55, -0.35], [0.55, -0.35], [0.55, -0.1],
  [0.06, -0.1], [0.06, -0.35], [0.06, -0.42],
  [0.3, -0.6], [0.15, -0.75], [0.02, -0.6], [0.06, -0.42],
  [-0.06, -0.42], [-0.18, -0.6], [-0.32, -0.72], [-0.1, -0.6], [0, -0.42],
];

// Procedural boustrophedon (back-and-forth rows) clipped to an ellipse —
// reads as brain folds without needing hand-authored coordinates.
function buildBrainWaypoints() {
  const wp = [];
  const rows = 9;
  for (let r = 0; r < rows; r++) {
    const y = -0.75 + (r / (rows - 1)) * 1.5;
    const maxX = Math.sqrt(Math.max(0, 1 - (y / 0.85) * (y / 0.85))) * 0.85;
    if (maxX < 0.05) continue;
    const wiggles = 3;
    const leftToRight = r % 2 === 0;
    for (let w = 0; w <= wiggles * 2; w++) {
      const tx = w / (wiggles * 2);
      const x = (leftToRight ? -maxX + tx * 2 * maxX : maxX - tx * 2 * maxX);
      const yy = y + Math.sin(tx * Math.PI * wiggles) * 0.06;
      wp.push([x, yy]);
    }
  }
  return wp;
}

const SHAPE_WAYPOINTS = {
  FACE: FACE_WP,
  RAT: RAT_WP,
  BOX: BOX_WP,
  BRAIN: null, // built on demand, see buildBrainWaypoints()
};

export default function sketch(p, get) {
  let points = [];
  let targets = [];
  let currentShape = '';
  let currentCount = 0;
  let lastW = 0;
  let lastH = 0;
  // Trigger tracking for the sound bridge — REPLACED the earlier
  // physics-velocity-derived "energy" signal entirely, after several
  // rounds of trying to calibrate it against real usage. The velocity
  // approach was fundamentally indirect: shape-memory actively opposes
  // an active push the whole time you're dragging, so the actual
  // velocity a light or moderate push produces was smaller and far more
  // variable than expected, and every recalibration attempt was still a
  // guess at a number rather than a fix to the underlying mismatch.
  //
  // This uses the exact same p.pluck() bridge Field Lines, Cursor
  // Ripple, SVG Particle, and Grid Snake's eat-trigger already use
  // successfully — proven, reliable infrastructure — instead of a
  // bespoke physics-derived signal. A fresh press fires immediately (a
  // tap should always produce sound, not require it to already be
  // moving), and continued dragging fires again every TRIGGER_STEP_PX of
  // actual cursor movement — directly tied to how far the cursor has
  // moved, not to how fast the simulated thread happens to be reacting.
  let wasDragging = false;
  let dragAccumX = null;
  let dragAccumY = null;
  let dragDistanceSinceTrigger = 0;
  const TRIGGER_STEP_PX = 30;

  function buildTargets(shape, count, w, h) {
    if (shape === 'FREE') return null;
    const wp = shape === 'BRAIN' ? buildBrainWaypoints() : SHAPE_WAYPOINTS[shape];
    const dense = sampleSpline(wp, 12);
    const even = resampleEven(dense, count);
    const scale = Math.min(w, h) * 0.42;
    const cx = w / 2, cy = h / 2;
    return even.map(([x, y]) => ({ x: cx + x * scale, y: cy + y * scale }));
  }

  function buildPoints(count, targetArr, w, h) {
    const arr = [];
    for (let i = 0; i < count; i++) {
      const home = targetArr ? targetArr[i] : {
        x: w / 2 + Math.cos((i / count) * Math.PI * 2) * Math.min(w, h) * 0.3,
        y: h / 2 + Math.sin((i / count) * Math.PI * 2) * Math.min(w, h) * 0.3,
      };
      arr.push({ x: home.x, y: home.y, vx: 0, vy: 0, homeX: home.x, homeY: home.y });
    }
    return arr;
  }

  p.setup = () => {
    p.createCanvas(p.windowWidth, p.windowHeight);
    p.noFill();
    currentShape = get('shape');
    currentCount = Math.round(get('pointCount'));
    lastW = p.width;
    lastH = p.height;
    targets = buildTargets(currentShape, currentCount, p.width, p.height);
    points = buildPoints(currentCount, targets, p.width, p.height);
  };

  // Kept as a fast-path for genuine browser window resizes — see the
  // per-frame check in draw() for why it can't be the only trigger
  // (Fullscreen apparently resizes this canvas through a path that
  // doesn't fire this callback; see glyph-swarm.js for the fuller
  // writeup of the same bug).
  p.windowResized = () => {
    p.resizeCanvas(p.windowWidth, p.windowHeight);
  };

  p.draw = () => {
    if (p.width !== lastW || p.height !== lastH) {
      lastW = p.width;
      lastH = p.height;
      targets = buildTargets(currentShape, currentCount, p.width, p.height);
      points = buildPoints(currentCount, targets, p.width, p.height);
    }

    const shape = get('shape');
    const wantCount = Math.round(get('pointCount'));

    if (shape !== currentShape || wantCount !== currentCount) {
      currentShape = shape;
      currentCount = wantCount;
      targets = buildTargets(currentShape, currentCount, p.width, p.height);
      points = buildPoints(currentCount, targets, p.width, p.height);
    }

    const shapeStrength = shape === 'FREE' ? get('shapeStrength') * 0.08 : get('shapeStrength');
    const neighborStiffness = get('neighborStiffness');
    const pushStrength = get('pushStrength');
    const pushRadius = get('pushRadius');
    const damping = get('damping');
    const pulseRate = get('pulseRate');
    const threadColor = get('threadColor');

    p.background(0);

    // p.mouseIsPressed is a document-GLOBAL flag in p5 (any mousedown
    // anywhere in the page, not just on this canvas), not scoped to this
    // sketch at all — dragging a slider in the Sound panel, or anything
    // else on the page, reads as "the user is pushing the thread" without
    // this bounds check, which is exactly what made the physics (and, via
    // the energy signal below, the sound) engage while the actual cursor
    // was nowhere near this tile. Requiring the pointer to genuinely be
    // over the canvas is the fix; p.touches already reports actual touch
    // points on this canvas specifically, so it doesn't need the same
    // check.
    const overCanvas = p.mouseX >= 0 && p.mouseX <= p.width && p.mouseY >= 0 && p.mouseY <= p.height;
    const dragging = (p.mouseIsPressed && overCanvas) || p.touches.length > 0;
    const px = p.touches.length ? p.touches[0].x : p.mouseX;
    const py = p.touches.length ? p.touches[0].y : p.mouseY;

    // Physics pass.
    for (let i = 0; i < points.length; i++) {
      const pt = points[i];

      if (currentShape !== 'FREE' && targets[i]) {
        pt.vx += (targets[i].x - pt.x) * shapeStrength * 0.04;
        pt.vy += (targets[i].y - pt.y) * shapeStrength * 0.04;
      } else if (currentShape === 'FREE') {
        // Very weak pull back to its own resting spot — this is the "falls
        // back into place" behavior for Free Weave, just with no imposed
        // shape, so dragging still feels genuinely free-form in between.
        pt.vx += (pt.homeX - pt.x) * shapeStrength * 0.04;
        pt.vy += (pt.homeY - pt.y) * shapeStrength * 0.04;
      }

      // Neighbor spring — what makes a push drag nearby points along,
      // rather than each point acting like an independent dot.
      if (neighborStiffness > 0) {
        const prev = points[(i - 1 + points.length) % points.length];
        const next = points[(i + 1) % points.length];
        const avgX = (prev.x + next.x) / 2;
        const avgY = (prev.y + next.y) / 2;
        pt.vx += (avgX - pt.x) * neighborStiffness * 0.15;
        pt.vy += (avgY - pt.y) * neighborStiffness * 0.15;
      }

      if (dragging) {
        const dx = pt.x - px;
        const dy = pt.y - py;
        const dist = Math.hypot(dx, dy);
        if (dist < pushRadius && dist > 0.01) {
          const force = pushStrength * (1 - dist / pushRadius);
          pt.vx += (dx / dist) * force;
          pt.vy += (dy / dist) * force;
        }
      }

      pt.vx *= damping;
      pt.vy *= damping;
      pt.x += pt.vx;
      pt.y += pt.vy;
    }

    // Sound trigger: a fresh press fires immediately, continued dragging
    // fires again every TRIGGER_STEP_PX of actual cursor movement. See
    // this closure's own top-of-function comment for why this replaced
    // the earlier velocity-derived signal.
    if (dragging && !wasDragging) {
      dragDistanceSinceTrigger = 0;
      if (typeof p.pluck === 'function') p.pluck(px / p.width);
    } else if (dragging && dragAccumX !== null) {
      dragDistanceSinceTrigger += Math.hypot(px - dragAccumX, py - dragAccumY);
      if (dragDistanceSinceTrigger >= TRIGGER_STEP_PX) {
        dragDistanceSinceTrigger = 0;
        if (typeof p.pluck === 'function') p.pluck(px / p.width);
      }
    }
    dragAccumX = dragging ? px : null;
    dragAccumY = dragging ? py : null;
    wasDragging = dragging;

    // Render as one continuous thread.
    const pulse = 0.6 + 0.4 * Math.pow(0.5 + 0.5 * Math.sin(p.millis() * 0.001 * pulseRate * 6.283), 3);
    p.stroke(threadColor.r * 255, threadColor.g * 255, threadColor.b * 255, 255);
    p.strokeWeight(2 * pulse);
    p.beginShape();
    p.curveVertex(points[0].x, points[0].y);
    for (const pt of points) p.curveVertex(pt.x, pt.y);
    p.curveVertex(points[points.length - 1].x, points[points.length - 1].y);
    p.endShape();

    // Faint glow pass for the "alive" feel.
    p.stroke(threadColor.r * 255, threadColor.g * 255, threadColor.b * 255, 40);
    p.strokeWeight(6 * pulse);
    p.beginShape();
    p.curveVertex(points[0].x, points[0].y);
    for (const pt of points) p.curveVertex(pt.x, pt.y);
    p.curveVertex(points[points.length - 1].x, points[points.length - 1].y);
    p.endShape();
  };
}
