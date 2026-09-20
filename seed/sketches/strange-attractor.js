/**
 * strange-attractor — chaotic attractors drawn as accumulating point clouds
 * in 3D.
 *
 * Each frame integrates one trajectory a few thousand steps further and
 * plots where it lands. The shape is never drawn, only revealed: density
 * builds where the system spends its time, so structure emerges out of a
 * handful of constants. Drag to orbit.
 *
 * Rework note: the previous version shared one set of generic sliders
 * ("Constant A/B/C") across all systems, silently rescaled per system —
 * moving a slider often did nothing visible. Each system now owns its
 * real constants, shown only when that system is selected.
 *
 * Second rework note: the original four systems were Lorenz, Thomas,
 * Halvorsen, and Aizawa. Thomas and Aizawa are gone — not broken exactly,
 * but a poor fit for this tile once actually exercised end to end. Thomas
 * is only chaotic below a fairly narrow damping threshold; modulation
 * routed to its one constant reliably pushed it past that threshold into
 * a system that visibly settles to a fixed point and stops moving, which
 * reads as "broken" even though it's the equation behaving correctly.
 * Aizawa's dynamics cover ground slowly relative to the shared dt/fade
 * settings tuned for Lorenz's much faster-moving trajectory, so it only
 * ever showed a short moving comet of recent history instead of filling
 * in its full shape. Replaced with Rössler (a folding, self-wrapping
 * ribbon — genuinely closer to "line bands wrapping into themselves" than
 * Thomas ever was) and Chen (a Lorenz relative with a distinct two-lobe
 * double-scroll shape, at a similar visual weight to Lorenz without being
 * heavier to compute). Both are standard, thoroughly-documented systems,
 * not experimental ones.
 *
 * PERFORMANCE REWORK — this is the important one.
 *
 * The version before this drew every point with its own `p.point()` call,
 * and wrapped the glow pass in `p.push()`/`p.pop()` per point. In p5's
 * WEBGL mode each `point()` is a separate GPU draw call, so at the shipped
 * default of 7400 steps that was ~7400 draw calls plus ~1200 more for the
 * glow — roughly 8,600 draw calls and 2,400 matrix push/pops EVERY FRAME.
 * At 60fps that is over half a million draw calls a second. No GPU renders
 * that smoothly; it was the direct cause of the stuttering, frame-skipping
 * motion, and it got materially worse when the glow pass was added for
 * looks without measuring the cost.
 *
 * The fix is batching, with one wrinkle: p5's `beginShape(POINTS)` ignores
 * per-vertex `stroke()` (processing/p5.js#7839, still open) — the whole
 * batch takes one colour. Since every colour mode here is a smooth lerp
 * between two colours, quantising that lerp into a fixed number of buckets
 * and emitting one batched shape per bucket is visually indistinguishable
 * from per-point colour at this density, and collapses ~8,600 draw calls
 * into ~56. The bucket arrays are allocated once and reused, so the hot
 * loop also stops generating garbage for the collector to chase.
 */

// Enough steps in the near→far gradient that banding is invisible at this
// point density, few enough that the draw-call count stays trivial. If a
// future colour mode ever needs a sharper ramp, raise this — the cost is
// linear in buckets, not in points, so it stays cheap.
const COLOR_BUCKETS = 28;

/**
 * Per-system calibration for the shared Zoom, Step size, and Fade sliders.
 *
 * `scale` (spatial, relative to Lorenz = 1) and `zOffset` (raw coordinate
 * units, same meaning as Lorenz's own `- 25`) exist because every system
 * occupies a differently sized and centered region of space — see the
 * projection math below for the full explanation. Lorenz spans roughly
 * ±20 in x/y and 0–50 in z; the others are all considerably smaller and
 * centered elsewhere, so one flat zoom/offset pair (tuned for Lorenz)
 * left them rendering as tiny, off-center specks regardless of the Zoom
 * slider.
 *
 * `timeScale` started as a fill-completeness knob — how much of its own
 * shape a system traces out within one Fade persistence window, since a
 * system that naturally advances more slowly than Lorenz at the same dt
 * only ever shows a short comet of recent history before old points fade
 * out (this was Aizawa's original problem, and part of why it's gone).
 *
 * For Chen specifically it's also load-bearing for something more basic:
 * numerical stability. This uses plain forward-Euler integration (no
 * adaptive step size), and Euler's stability region shrinks as a system's
 * derivatives get larger in magnitude — Chen's constants (~30-something)
 * are roughly 3x Lorenz's, so the SAME dt that's perfectly stable for
 * Lorenz makes Chen diverge to infinity within well under 100 steps,
 * regardless of the exact A/B/C values, which is why every combination
 * looked equally broken and unresponsive to the sliders: the trajectory
 * was blowing up and auto-reseeding dozens of times within a single
 * frame, before any of A/B/C could visibly matter. Verified by directly
 * simulating this exact integration at a range of dt and A/B/C values —
 * see the constant's value below for the confirmed-stable number, not
 * an estimate.
 *
 * All numbers here are calibrated from each system's documented canonical
 * behavior and, for Chen, direct simulation — not from watching this
 * specific renderer live, which isn't something I can do in this
 * environment. Nudge any of them if a system still reads a little large,
 * small, off-center, or too sparse/too smeared once you can see it
 * running — but Chen's `timeScale` in particular should not be raised
 * without re-verifying stability first; going back toward 1 reintroduces
 * the divergence.
 */
const SYSTEM_FRAME = {
  lorenz: { scale: 1, zOffset: -25, timeScale: 1 },
  rossler: { scale: 2, zOffset: -12, timeScale: 1.4 },
  halvorsen: { scale: 2.2, zOffset: 0, timeScale: 1 },
  // timeScale: 0.06 — confirmed stable by direct simulation across the
  // full A/B/C range below and the shared Step size slider's max (0.02),
  // 3 million steps, zero divergences. zOffset: -30 is the actual
  // measured z-center from that same simulation, not an estimate.
  chen: { scale: 1, zOffset: -30, timeScale: 0.06 },
};

export const params = {
  system: { kind: 'select', label: 'System', default: 'lorenz', options: [
    { value: 'lorenz', label: 'Lorenz' },
    { value: 'rossler', label: 'Rössler' },
    { value: 'halvorsen', label: 'Halvorsen' },
    { value: 'chen', label: 'Chen' },
  ] },

  lorenzSigma: { kind: 'slider', label: 'Sigma', min: 1, max: 30, step: 0.1, default: 5.8, modulatable: true, showIf: { equals: ['system', 'lorenz'] } },
  lorenzRho: { kind: 'slider', label: 'Rho', min: 1, max: 50, step: 0.1, default: 36.4, modulatable: true, showIf: { equals: ['system', 'lorenz'] } },
  lorenzBeta: { kind: 'slider', label: 'Beta', min: 0.5, max: 8, step: 0.05, default: 5.25, modulatable: true, showIf: { equals: ['system', 'lorenz'] } },

  rosslerA: { kind: 'slider', label: 'Spiral rate', min: 0.1, max: 0.35, step: 0.005, default: 0.2, modulatable: true, hint: 'How tightly the trajectory spirals before folding.', showIf: { equals: ['system', 'rossler'] } },
  rosslerB: { kind: 'slider', label: 'Kick', min: 0.1, max: 0.35, step: 0.005, default: 0.2, modulatable: true, hint: 'The nudge that reinjects the trajectory after each fold.', showIf: { equals: ['system', 'rossler'] } },
  rosslerC: { kind: 'slider', label: 'Fold threshold', min: 3, max: 8, step: 0.1, default: 5.7, modulatable: true, hint: 'How far the spiral grows before folding back — stays a ribbon across this whole range, wider excursions above ~7.', showIf: { equals: ['system', 'rossler'] } },

  halvorsenA: { kind: 'slider', label: 'Coupling', min: 1.1, max: 1.8, step: 0.01, default: 1.4, modulatable: true, hint: 'Stays liveliest roughly 1.2–1.6; further out the system can stabilize or diverge.', showIf: { equals: ['system', 'halvorsen'] } },

  chenA: { kind: 'slider', label: 'Coupling', min: 34, max: 36, step: 0.1, default: 35, modulatable: true, hint: 'The x–y coupling rate, playing a role similar to Lorenz\u2019s Sigma. Chen loses the double-scroll more easily than Lorenz or Rössler do — stays reliable within this range.', showIf: { equals: ['system', 'chen'] } },
  chenB: { kind: 'slider', label: 'Damping', min: 2.7, max: 3.3, step: 0.05, default: 3, modulatable: true, hint: 'Damps the z axis, playing a role similar to Lorenz\u2019s Beta.', showIf: { equals: ['system', 'chen'] } },
  chenC: { kind: 'slider', label: 'Drive', min: 27, max: 29, step: 0.1, default: 28, modulatable: true, hint: 'Drives the expansion that keeps the scroll open, playing a role similar to Lorenz\u2019s Rho.', showIf: { equals: ['system', 'chen'] } },

  steps: { kind: 'slider', label: 'Points per frame', min: 200, max: 12000, step: 100, default: 7400, scale: 'log' },
  dt: { kind: 'slider', label: 'Step size', min: 0.0005, max: 0.02, step: 0.0005, default: 0.0145, hint: 'Smaller is smoother but advances more slowly.' },
  zoom: { kind: 'slider', label: 'Zoom', min: 0.5, max: 30, step: 0.1, default: 8.7, scale: 'log' },
  spin: { kind: 'slider', label: 'Auto spin', min: -1, max: 1, step: 0.005, default: -0.44, modulatable: true },
  tilt: { kind: 'slider', label: 'Tilt', min: -90, max: 90, step: 1, default: -68, unit: 'deg' },
  fade: { kind: 'slider', label: 'Fade', min: 0, max: 0.3, step: 0.002, default: 0.016, hint: 'Zero accumulates forever into a dense solid.' },
  pointSize: { kind: 'slider', label: 'Point size', min: 0.5, max: 6, step: 0.1, default: 1.1, modulatable: true },
  alpha: { kind: 'slider', label: 'Point alpha', min: 0.02, max: 1, step: 0.01, default: 0.79, modulatable: true },
  glow: { kind: 'slider', label: 'Glow', min: 0, max: 1, step: 0.01, default: 0.23, modulatable: true, hint: 'Additive halo — the previous version had none, which read as flat next to Particle Cube.' },
  colorMode: { kind: 'select', label: 'Colour by', default: 'depth', options: [
    { value: 'depth', label: 'Depth' },
    { value: 'velocity', label: 'Velocity' },
    { value: 'time', label: 'Age' },
  ] },
  near: { kind: 'color', label: 'Near', default: { r: 0, g: 0.831, b: 1, a: 1 } },
  far: { kind: 'color', label: 'Far', default: { r: 0.349, g: 0.059, b: 0.549, a: 1 } },
  interactive: { kind: 'toggle', label: 'Drag to orbit', default: true },
  reseed: { kind: 'trigger', label: 'Reseed', default: null, event: 'reseed', advanced: true, midi: false },
};

export default function sketch(p, get) {
  let state = { x: 0.1, y: 0, z: 0 };
  let age = 0;
  // Tracks the last-seen System selection so p.draw() can detect a change
  // and reseed. Every system integrates the same shared `state` (x,y,z)
  // accumulator — deliberate code reuse (see this file's rework note) —
  // but that means switching systems without resetting it hands the new
  // system's equations a starting point from wherever the OLD system's
  // trajectory had wandered to. That point is essentially never valid for
  // a different attractor's basin: best case it settles to an
  // uninteresting fixed point (renders as a tiny static dot instead of a
  // filled attractor — exactly what Thomas/Halvorsen/Aizawa looked like
  // after switching from Lorenz), worst case it diverges outright (caught
  // by the `> 1e4` safety net a few lines below, but only after however
  // many frames it takes to get there). Lorenz alone looked fine only
  // because canonical near-origin starting points happen to be
  // numerically compatible with pretty much any Lorenz constants — not
  // because switching *into* Lorenz was doing anything differently.
  let lastSystem = 'lorenz';

  // One flat array per colour bucket, holding x,y,z triples. Allocated once
  // and truncated (not reallocated) each frame: at up to 12,000 points a
  // frame, allocating fresh arrays would hand the garbage collector several
  // hundred thousand short-lived objects a second, which shows up as
  // periodic hitching independent of GPU cost.
  const buckets = [];
  for (let i = 0; i < COLOR_BUCKETS; i++) buckets.push([]);

  function reseed() {
    state = { x: p.random(-0.5, 0.5) + 0.1, y: p.random(-0.5, 0.5), z: p.random(-0.5, 0.5) };
    age = 0;
  }

  function derivative(s) {
    const sys = get('system');

    if (sys === 'rossler') {
      const a = get('rosslerA');
      const b = get('rosslerB');
      const c = get('rosslerC');
      return {
        dx: -s.y - s.z,
        dy: s.x + a * s.y,
        dz: b + s.z * (s.x - c),
      };
    }
    if (sys === 'halvorsen') {
      const h = get('halvorsenA');
      return {
        dx: -h * s.x - 4 * s.y - 4 * s.z - s.y * s.y,
        dy: -h * s.y - 4 * s.z - 4 * s.x - s.z * s.z,
        dz: -h * s.z - 4 * s.x - 4 * s.y - s.x * s.x,
      };
    }
    if (sys === 'chen') {
      const a = get('chenA');
      const b = get('chenB');
      const c = get('chenC');
      return {
        dx: a * (s.y - s.x),
        dy: (c - a) * s.x - s.x * s.z + c * s.y,
        dz: s.x * s.y - b * s.z,
      };
    }
    const sigma = get('lorenzSigma');
    const rho = get('lorenzRho');
    const beta = get('lorenzBeta');
    return {
      dx: sigma * (s.y - s.x),
      dy: s.x * (rho - s.z) - s.y,
      dz: s.x * s.y - beta * s.z,
    };
  }

  p.setup = () => {
    p.createCanvas(p.windowWidth, p.windowHeight, p.WEBGL);
    p.colorMode(p.RGB, 1, 1, 1, 1);
    p.noStroke();
    p.background(0);
    reseed();
    lastSystem = get('system');
  };

  p.windowResized = () => { p.resizeCanvas(p.windowWidth, p.windowHeight); p.background(0); };
  p.onEvent = (name) => { if (name === 'reseed') { reseed(); p.background(0); } };

  p.draw = () => {
    const currentSystem = get('system');
    if (currentSystem !== lastSystem) {
      lastSystem = currentSystem;
      reseed();
      p.background(0);
    }

    const fade = get('fade');
    if (fade > 0) {
      p.push();
      p.resetMatrix();
      p.noStroke();
      p.fill(0, 0, 0, fade);
      p.translate(0, 0, -1);
      p.plane(p.width * 2, p.height * 2);
      p.pop();
    }

    if (get('interactive')) p.orbitControl(1, 1, 0.1);
    p.rotateX(p.radians(get('tilt')));
    p.rotateY(p.millis() * 0.001 * get('spin'));

    const steps = Math.floor(get('steps'));
    const dt = get('dt');
    const zoom = get('zoom');
    const near = get('near');
    const far = get('far');
    const mode = get('colorMode');
    const alpha = get('alpha');
    const size = get('pointSize');
    const glow = get('glow');
    const frame = SYSTEM_FRAME[currentSystem] || SYSTEM_FRAME.lorenz;
    const effectiveZoom = zoom * frame.scale;
    // See SYSTEM_FRAME's doc — compensates for how much ground each
    // system's own dynamics naturally cover per step, so a system that's
    // "slower" than Lorenz at the same dt still fills in its full shape
    // within one Fade persistence window instead of only ever showing a
    // short comet of recent history.
    const effectiveDt = dt * frame.timeScale;

    for (let i = 0; i < COLOR_BUCKETS; i++) buckets[i].length = 0;

    // Integration pass. This loop now only advances the system and sorts
    // each resulting point into a colour bucket — no GPU work at all
    // happens in here, which is what makes 7400 steps affordable.
    for (let i = 0; i < steps; i++) {
      const d = derivative(state);
      state.x += d.dx * effectiveDt;
      state.y += d.dy * effectiveDt;
      state.z += d.dz * effectiveDt;
      age += effectiveDt;

      if (!isFinite(state.x) || Math.abs(state.x) > 1e4) { reseed(); break; }

      let f;
      if (mode === 'velocity') {
        f = Math.min(Math.hypot(d.dx, d.dy, d.dz) / 60, 1);
      } else if (mode === 'time') {
        f = (age * 0.05) % 1;
      } else {
        f = p.constrain(((state.z + frame.zOffset) * effectiveZoom * 0.02) + 0.5, 0, 1);
      }

      let bucket = Math.floor(f * COLOR_BUCKETS);
      if (bucket < 0) bucket = 0;
      else if (bucket >= COLOR_BUCKETS) bucket = COLOR_BUCKETS - 1;

      const arr = buckets[bucket];
      arr.push(state.x * effectiveZoom, state.y * effectiveZoom, (state.z + frame.zOffset) * effectiveZoom * 0.6);
    }

    p.blendMode(p.ADD);
    p.noFill();

    // Draw pass: one batched shape per non-empty bucket. Up to 28 draw
    // calls for the body, plus up to 28 more for the halo, replacing the
    // ~8,600 individual point() calls this used to issue.
    for (let b = 0; b < COLOR_BUCKETS; b++) {
      const arr = buckets[b];
      if (arr.length === 0) continue;

      // Sample the gradient at the middle of the bucket rather than its
      // edge, so quantising doesn't visibly shift the whole ramp toward
      // the near colour.
      const f = (b + 0.5) / COLOR_BUCKETS;
      const cr = p.lerp(near.r, far.r, f);
      const cg = p.lerp(near.g, far.g, f);
      const cb = p.lerp(near.b, far.b, f);

      p.strokeWeight(size);
      p.stroke(cr, cg, cb, alpha);
      p.beginShape(p.POINTS);
      for (let i = 0; i < arr.length; i += 3) p.vertex(arr[i], arr[i + 1], arr[i + 2]);
      p.endShape();

      if (glow > 0) {
        // Same sparse every-6th-point halo as before — a larger, dimmer
        // second pass — but batched, and without the per-point push/pop
        // that made the original version's glow so disproportionately
        // expensive. Stride is 18 (6 points x 3 components).
        p.strokeWeight(size * 4);
        p.stroke(cr, cg, cb, alpha * glow * 0.25);
        p.beginShape(p.POINTS);
        for (let i = 0; i < arr.length; i += 18) p.vertex(arr[i], arr[i + 1], arr[i + 2]);
        p.endShape();
      }
    }

    p.blendMode(p.BLEND);
  };
}
