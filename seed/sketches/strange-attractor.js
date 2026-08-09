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
 * ("Constant A/B/C") across all four systems. That meant Thomas and
 * Halvorsen received A/B silently rescaled by arbitrary factors the person
 * never saw, and Aizawa — the most organic-looking of the four — ignored
 * every one of them and used hardcoded constants instead. Moving those
 * sliders while Aizawa was selected did nothing at all, which is exactly
 * the "sliders don't meaningfully change the visual" complaint. Each system
 * now owns its real constants, shown only when that system is selected.
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

export const params = {
  system: { kind: 'select', label: 'System', default: 'lorenz', options: [
    { value: 'lorenz', label: 'Lorenz' },
    { value: 'thomas', label: 'Thomas' },
    { value: 'halvorsen', label: 'Halvorsen' },
    { value: 'aizawa', label: 'Aizawa' },
  ] },

  lorenzSigma: { kind: 'slider', label: 'Sigma', min: 1, max: 30, step: 0.1, default: 5.8, modulatable: true, showIf: { equals: ['system', 'lorenz'] } },
  lorenzRho: { kind: 'slider', label: 'Rho', min: 1, max: 50, step: 0.1, default: 36.4, modulatable: true, showIf: { equals: ['system', 'lorenz'] } },
  lorenzBeta: { kind: 'slider', label: 'Beta', min: 0.5, max: 8, step: 0.05, default: 5.25, showIf: { equals: ['system', 'lorenz'] } },

  thomasB: { kind: 'slider', label: 'Damping', min: 0.05, max: 1, step: 0.005, default: 0.19, modulatable: true, hint: 'Below ~0.32 the system is chaotic; above it, motion settles.', showIf: { equals: ['system', 'thomas'] } },

  halvorsenA: { kind: 'slider', label: 'Coupling', min: 1, max: 3, step: 0.01, default: 1.4, modulatable: true, showIf: { equals: ['system', 'halvorsen'] } },

  aizawaA: { kind: 'slider', label: 'A', min: 0.3, max: 1.6, step: 0.01, default: 0.95, modulatable: true, showIf: { equals: ['system', 'aizawa'] } },
  aizawaB: { kind: 'slider', label: 'B', min: 0.2, max: 1.4, step: 0.01, default: 0.7, modulatable: true, showIf: { equals: ['system', 'aizawa'] } },
  aizawaC: { kind: 'slider', label: 'C', min: 0.1, max: 1.2, step: 0.01, default: 0.6, showIf: { equals: ['system', 'aizawa'] } },
  aizawaD: { kind: 'slider', label: 'D', min: 1.5, max: 5.5, step: 0.05, default: 3.5, modulatable: true, showIf: { equals: ['system', 'aizawa'] } },

  steps: { kind: 'slider', label: 'Points per frame', min: 200, max: 12000, step: 100, default: 7400, scale: 'log' },
  dt: { kind: 'slider', label: 'Step size', min: 0.0005, max: 0.02, step: 0.0005, default: 0.0145, hint: 'Smaller is smoother but advances more slowly.' },
  zoom: { kind: 'slider', label: 'Zoom', min: 0.5, max: 30, step: 0.1, default: 8.7, scale: 'log' },
  spin: { kind: 'slider', label: 'Auto spin', min: -1, max: 1, step: 0.005, default: -0.44 },
  tilt: { kind: 'slider', label: 'Tilt', min: -90, max: 90, step: 1, default: -68, unit: 'deg' },
  fade: { kind: 'slider', label: 'Fade', min: 0, max: 0.3, step: 0.002, default: 0.016, hint: 'Zero accumulates forever into a dense solid.' },
  pointSize: { kind: 'slider', label: 'Point size', min: 0.5, max: 6, step: 0.1, default: 1.1 },
  alpha: { kind: 'slider', label: 'Point alpha', min: 0.02, max: 1, step: 0.01, default: 0.79 },
  glow: { kind: 'slider', label: 'Glow', min: 0, max: 1, step: 0.01, default: 0.23, hint: 'Additive halo — the previous version had none, which read as flat next to Particle Cube.' },
  colorMode: { kind: 'select', label: 'Colour by', default: 'depth', options: [
    { value: 'depth', label: 'Depth' },
    { value: 'velocity', label: 'Velocity' },
    { value: 'time', label: 'Age' },
  ] },
  near: { kind: 'color', label: 'Near', default: { r: 0, g: 0.831, b: 1, a: 1 } },
  far: { kind: 'color', label: 'Far', default: { r: 0.349, g: 0.059, b: 0.549, a: 1 } },
  interactive: { kind: 'toggle', label: 'Drag to orbit', default: true },
  reseed: { kind: 'trigger', label: 'Reseed', default: null, event: 'reseed' },
};

export default function sketch(p, get) {
  let state = { x: 0.1, y: 0, z: 0 };
  let age = 0;

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

    if (sys === 'thomas') {
      const b = get('thomasB');
      return {
        dx: Math.sin(s.y) - b * s.x,
        dy: Math.sin(s.z) - b * s.y,
        dz: Math.sin(s.x) - b * s.z,
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
    if (sys === 'aizawa') {
      const A = get('aizawaA');
      const B = get('aizawaB');
      const C = get('aizawaC');
      const D = get('aizawaD');
      const E = 0.25;
      const F = 0.1;
      return {
        dx: (s.z - B) * s.x - D * s.y,
        dy: D * s.x + (s.z - B) * s.y,
        dz: C + A * s.z - (s.z ** 3) / 3 - (s.x * s.x + s.y * s.y) * (1 + E * s.z) + F * s.z * (s.x ** 3),
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
  };

  p.windowResized = () => { p.resizeCanvas(p.windowWidth, p.windowHeight); p.background(0); };
  p.onEvent = (name) => { if (name === 'reseed') { reseed(); p.background(0); } };

  p.draw = () => {
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

    for (let i = 0; i < COLOR_BUCKETS; i++) buckets[i].length = 0;

    // Integration pass. This loop now only advances the system and sorts
    // each resulting point into a colour bucket — no GPU work at all
    // happens in here, which is what makes 7400 steps affordable.
    for (let i = 0; i < steps; i++) {
      const d = derivative(state);
      state.x += d.dx * dt;
      state.y += d.dy * dt;
      state.z += d.dz * dt;
      age += dt;

      if (!isFinite(state.x) || Math.abs(state.x) > 1e4) { reseed(); break; }

      let f;
      if (mode === 'velocity') {
        f = Math.min(Math.hypot(d.dx, d.dy, d.dz) / 60, 1);
      } else if (mode === 'time') {
        f = (age * 0.05) % 1;
      } else {
        f = p.constrain((state.z * zoom * 0.02) + 0.5, 0, 1);
      }

      let bucket = Math.floor(f * COLOR_BUCKETS);
      if (bucket < 0) bucket = 0;
      else if (bucket >= COLOR_BUCKETS) bucket = COLOR_BUCKETS - 1;

      const arr = buckets[bucket];
      arr.push(state.x * zoom, state.y * zoom, (state.z - 25) * zoom * 0.6);
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
