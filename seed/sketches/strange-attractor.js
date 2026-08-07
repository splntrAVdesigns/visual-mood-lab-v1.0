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
 */

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

    p.blendMode(p.ADD);
    p.strokeWeight(size);

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

      const cr = p.lerp(near.r, far.r, f);
      const cg = p.lerp(near.g, far.g, f);
      const cb = p.lerp(near.b, far.b, f);
      const px = state.x * zoom;
      const py = state.y * zoom;
      const pz = (state.z - 25) * zoom * 0.6;

      // point() is a single GPU point sprite — orders of magnitude cheaper
      // than circle(), which matters at up to 12,000 calls a frame. Additive
      // blending alone already builds real brightness where the trajectory
      // revisits the same region often, which is most of what "vibrant"
      // needs. A sparse, larger, low-alpha second pass over every 6th point
      // adds a soft halo without doubling the draw-call count.
      p.stroke(cr, cg, cb, alpha);
      p.point(px, py, pz);

      if (glow > 0 && i % 6 === 0) {
        p.push();
        p.strokeWeight(size * 4);
        p.stroke(cr, cg, cb, alpha * glow * 0.25);
        p.point(px, py, pz);
        p.pop();
      }
    }

    p.blendMode(p.BLEND);
  };
}
