/**
 * strange-attractor — chaotic attractors drawn as accumulating point clouds
 * in 3D.
 *
 * Each frame integrates one trajectory a few thousand steps further and
 * plots where it lands. The shape is never drawn, only revealed: density
 * builds where the system spends its time, so structure emerges out of a
 * handful of constants. Drag to orbit.
 */

export const params = {
  system: { kind: 'select', label: 'System', default: 'lorenz', options: [
    { value: 'lorenz', label: 'Lorenz' },
    { value: 'thomas', label: 'Thomas' },
    { value: 'halvorsen', label: 'Halvorsen' },
    { value: 'aizawa', label: 'Aizawa' },
  ] },
  steps: { kind: 'slider', label: 'Points per frame', min: 200, max: 12000, step: 100, default: 3000, scale: 'log' },
  dt: { kind: 'slider', label: 'Step size', min: 0.0005, max: 0.02, step: 0.0005, default: 0.006, hint: 'Smaller is smoother but advances more slowly.' },
  paramA: { kind: 'slider', label: 'Constant A', min: 0.05, max: 20, step: 0.01, default: 10, modulatable: true },
  paramB: { kind: 'slider', label: 'Constant B', min: 0.05, max: 40, step: 0.01, default: 28, modulatable: true },
  paramC: { kind: 'slider', label: 'Constant C', min: 0.05, max: 10, step: 0.01, default: 2.667 },
  zoom: { kind: 'slider', label: 'Zoom', min: 0.5, max: 30, step: 0.1, default: 9, scale: 'log' },
  spin: { kind: 'slider', label: 'Auto spin', min: -1, max: 1, step: 0.005, default: 0.07 },
  tilt: { kind: 'slider', label: 'Tilt', min: -90, max: 90, step: 1, default: -18, unit: 'deg' },
  fade: { kind: 'slider', label: 'Fade', min: 0, max: 0.3, step: 0.002, default: 0.045, hint: 'Zero accumulates forever into a dense solid.' },
  pointSize: { kind: 'slider', label: 'Point size', min: 0.5, max: 6, step: 0.1, default: 1.3 },
  alpha: { kind: 'slider', label: 'Point alpha', min: 0.02, max: 1, step: 0.01, default: 0.32 },
  colorMode: { kind: 'select', label: 'Colour by', default: 'depth', options: [
    { value: 'depth', label: 'Depth' },
    { value: 'velocity', label: 'Velocity' },
    { value: 'time', label: 'Age' },
  ] },
  near: { kind: 'color', label: 'Near', default: { r: 0, g: 0.83, b: 1, a: 1 } },
  far: { kind: 'color', label: 'Far', default: { r: 0.35, g: 0.06, b: 0.55, a: 1 } },
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

  /** One integration step. Returns the derivative for the active system. */
  function derivative(s) {
    const a = get('paramA');
    const b = get('paramB');
    const c = get('paramC');
    const sys = get('system');

    if (sys === 'thomas') {
      const t = a * 0.018; // usable range for this system is far smaller
      return {
        dx: Math.sin(s.y) - t * s.x,
        dy: Math.sin(s.z) - t * s.y,
        dz: Math.sin(s.x) - t * s.z,
      };
    }
    if (sys === 'halvorsen') {
      const h = 1.4 + a * 0.02;
      return {
        dx: -h * s.x - 4 * s.y - 4 * s.z - s.y * s.y,
        dy: -h * s.y - 4 * s.z - 4 * s.x - s.z * s.z,
        dz: -h * s.z - 4 * s.x - 4 * s.y - s.x * s.x,
      };
    }
    if (sys === 'aizawa') {
      const A = 0.95, B = 0.7, C = 0.6, D = 3.5, E = 0.25, F = 0.1;
      return {
        dx: (s.z - B) * s.x - D * s.y,
        dy: D * s.x + (s.z - B) * s.y,
        dz: C + A * s.z - (s.z ** 3) / 3 - (s.x * s.x + s.y * s.y) * (1 + E * s.z) + F * s.z * (s.x ** 3),
      };
    }
    // Lorenz
    return {
      dx: a * (s.y - s.x),
      dy: s.x * (b - s.z) - s.y,
      dz: s.x * s.y - c * s.z,
    };
  }

  p.setup = () => {
    p.createCanvas(p.windowWidth, p.windowHeight, p.WEBGL);
    p.colorMode(p.RGB, 1, 1, 1, 1);
    p.background(0);
    reseed();
  };

  p.windowResized = () => { p.resizeCanvas(p.windowWidth, p.windowHeight); p.background(0); };
  p.onEvent = (name) => { if (name === 'reseed') { reseed(); p.background(0); } };

  p.draw = () => {
    const fade = get('fade');
    if (fade > 0) {
      // Fading in WEBGL means drawing a translucent full-screen quad in
      // screen space, before any camera transform is applied.
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

    p.strokeWeight(size);

    for (let i = 0; i < steps; i++) {
      const d = derivative(state);
      state.x += d.dx * dt;
      state.y += d.dy * dt;
      state.z += d.dz * dt;
      age += dt;

      // Chaotic systems diverge if a constant is pushed out of range; catch
      // it rather than letting NaN silently blank the canvas.
      if (!isFinite(state.x) || Math.abs(state.x) > 1e4) { reseed(); break; }

      let f;
      if (mode === 'velocity') {
        f = Math.min(Math.hypot(d.dx, d.dy, d.dz) / 60, 1);
      } else if (mode === 'time') {
        f = (age * 0.05) % 1;
      } else {
        f = p.constrain((state.z * zoom * 0.02) + 0.5, 0, 1);
      }

      p.stroke(p.lerp(near.r, far.r, f), p.lerp(near.g, far.g, f), p.lerp(near.b, far.b, f), alpha);
      p.point(state.x * zoom, state.y * zoom, (state.z - 25) * zoom * 0.6);
    }
  };
}
