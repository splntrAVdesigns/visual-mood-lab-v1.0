/**
 * particle-cube — a floating cube built entirely from particles.
 *
 * Adapted from a three.js reference that used EffectComposer + UnrealBloom.
 * Rewritten for p5 WEBGL so it runs inside the existing sketch sandbox with
 * no extra runtime dependency, and so every aspect is exposed as a real
 * inspector control rather than hard-coded constants.
 *
 * Camera-facing points retain a legible core throughout a full rotation.
 * p5 cannot vary stroke() inside a POINTS batch, so 28 reused gradient
 * buckets follow Strange Attractor's proven batching pattern. At most 56
 * shape submissions replace thousands of individual flat circles.
 */

const COLOR_BUCKETS = 28;

export const params = {
  count: { kind: 'slider', label: 'Particles', min: 200, max: 12000, step: 100, default: 3500, scale: 'log', modulatable: true },
  distribution: { kind: 'select', label: 'Distribution', default: 'edges', options: [
    { value: 'edges', label: 'Edges' },
    { value: 'faces', label: 'Faces' },
    { value: 'volume', label: 'Volume' },
    { value: 'lattice', label: 'Lattice' },
    { value: 'corners', label: 'Corners' },
  ] },
  size: { kind: 'slider', label: 'Cube size', min: 0.05, max: 0.7, step: 0.005, default: 0.3, modulatable: true },
  particleSize: { kind: 'slider', label: 'Particle size', min: 0.5, max: 12, step: 0.1, default: 2.6 },
  jitter: { kind: 'slider', label: 'Jitter', min: 0, max: 0.3, step: 0.002, default: 0.012, hint: 'Random offset from the ideal cube position.' },

  /* ---- motion ---- */
  spinX: { kind: 'slider', label: 'Spin X', min: -2, max: 2, step: 0.01, default: 0.12, modulatable: true },
  spinY: { kind: 'slider', label: 'Spin Y', min: -2, max: 2, step: 0.01, default: 0.26, modulatable: true },
  spinZ: { kind: 'slider', label: 'Spin Z', min: -2, max: 2, step: 0.01, default: 0 },
  turbulence: { kind: 'slider', label: 'Turbulence', min: 0, max: 1, step: 0.005, default: 0.16, hint: 'Noise-driven drift of each particle.', modulatable: true },
  turbulenceScale: { kind: 'slider', label: 'Turbulence scale', min: 0.2, max: 8, step: 0.05, default: 1.8, scale: 'log' },
  flowSpeed: { kind: 'slider', label: 'Flow speed', min: 0, max: 3, step: 0.01, default: 0.5 },
  breathe: { kind: 'slider', label: 'Breathe', min: 0, max: 1, step: 0.01, default: 0.12, modulatable: true },
  breatheRate: { kind: 'slider', label: 'Breathe rate', min: 0.05, max: 3, step: 0.05, default: 0.45, showIf: { truthy: 'breathe' } },
  explode: { kind: 'slider', label: 'Explode', min: 0, max: 2, step: 0.01, default: 0, hint: 'Pushes particles outward along their own normal.', modulatable: true },

  /* ---- look ---- */
  glow: { kind: 'slider', label: 'Glow', min: 0, max: 1, step: 0.01, default: 0.55, hint: 'Layered additive halo around each particle.' },
  colorMode: { kind: 'select', label: 'Colour by', default: 'depth', options: [
    { value: 'solid', label: 'Solid' },
    { value: 'depth', label: 'Depth' },
    { value: 'axis', label: 'Axis' },
    { value: 'speed', label: 'Turbulence' },
  ] },
  colorA: { kind: 'color', label: 'Near', default: { r: 0, g: 0.83, b: 1, a: 1 } },
  colorB: { kind: 'color', label: 'Far', default: { r: 0.3, g: 0.08, b: 0.6, a: 1 } },
  alpha: { kind: 'slider', label: 'Opacity', min: 0.05, max: 1, step: 0.01, default: 0.75 },
  trail: { kind: 'slider', label: 'Trail', min: 0, max: 0.6, step: 0.005, default: 0, hint: 'Zero clears each frame; higher values smear motion.' },
  showEdges: { kind: 'toggle', label: 'Wire cage', default: false, advanced: true },

  /* ---- camera ---- */
  zoom: { kind: 'slider', label: 'Zoom', min: 0.3, max: 3, step: 0.01, default: 1, scale: 'log' },
  tilt: { kind: 'slider', label: 'Tilt', min: -90, max: 90, step: 1, default: -12, unit: 'deg' },
  interactive: { kind: 'toggle', label: 'Drag to orbit', default: true },
  reseed: { kind: 'trigger', label: 'Reseed', default: null, event: 'reseed', advanced: true, midi: false },
};

export default function sketch(p, get) {
  let particles = [];
  let builtFor = '';
  let maxPointSize = 16;
  const buckets = Array.from({ length: COLOR_BUCKETS }, () => []);

  /** Position a particle on the cube according to the chosen distribution. */
  function place(i, n, mode) {
    const r = () => p.random(-0.5, 0.5);

    if (mode === 'volume') {
      return { x: r(), y: r(), z: r() };
    }

    if (mode === 'corners') {
      // Cluster tightly around the eight corners.
      const cx = p.random() < 0.5 ? -0.5 : 0.5;
      const cy = p.random() < 0.5 ? -0.5 : 0.5;
      const cz = p.random() < 0.5 ? -0.5 : 0.5;
      const s = 0.12;
      return { x: cx + p.random(-s, s), y: cy + p.random(-s, s), z: cz + p.random(-s, s) };
    }

    if (mode === 'lattice') {
      const side = Math.max(2, Math.round(Math.cbrt(n)));
      const gx = i % side;
      const gy = Math.floor(i / side) % side;
      const gz = Math.floor(i / (side * side)) % side;
      const f = (v) => v / (side - 1) - 0.5;
      return { x: f(gx), y: f(gy), z: f(gz) };
    }

    if (mode === 'faces') {
      // Pick a face, then a random point on it.
      const axis = Math.floor(p.random(3));
      const sign = p.random() < 0.5 ? -0.5 : 0.5;
      const a = r();
      const b = r();
      if (axis === 0) return { x: sign, y: a, z: b };
      if (axis === 1) return { x: a, y: sign, z: b };
      return { x: a, y: b, z: sign };
    }

    // Edges: pick one of the 12 edges, then a point along it.
    const edge = Math.floor(p.random(12));
    const t = p.random(-0.5, 0.5);
    const s1 = p.random() < 0.5 ? -0.5 : 0.5;
    const s2 = p.random() < 0.5 ? -0.5 : 0.5;
    if (edge < 4) return { x: t, y: s1, z: s2 };
    if (edge < 8) return { x: s1, y: t, z: s2 };
    return { x: s1, y: s2, z: t };
  }

  function build() {
    const n = Math.floor(get('count'));
    const mode = get('distribution');
    particles = new Array(n);

    for (let i = 0; i < n; i++) {
      const base = place(i, n, mode);
      const len = Math.hypot(base.x, base.y, base.z) || 1;
      particles[i] = {
        bx: base.x,
        by: base.y,
        bz: base.z,
        // Outward direction, used by Explode so particles scatter away from
        // the centre rather than in a uniform direction.
        nx: base.x / len,
        ny: base.y / len,
        nz: base.z / len,
        // Jitter never changes unless Reseed runs, so sample it at build
        // time rather than running three extra noise calls per particle/frame.
        jitterX: 0, jitterY: 0, jitterZ: 0,
      };
      const seed = p.random(1000);
      particles[i].jitterX = p.noise(seed) - 0.5;
      particles[i].jitterY = p.noise(seed + 7) - 0.5;
      particles[i].jitterZ = p.noise(seed + 13) - 0.5;
    }

    builtFor = `${n}:${mode}`;
  }

  p.setup = () => {
    p.createCanvas(p.windowWidth, p.windowHeight, p.WEBGL);
    p.colorMode(p.RGB, 1, 1, 1, 1);
    p.noStroke();
    const gl = p._renderer && p._renderer.GL;
    if (gl) {
      const range = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE);
      if (range && Number.isFinite(range[1])) maxPointSize = range[1];
    }
    build();
  };

  p.windowResized = () => p.resizeCanvas(p.windowWidth, p.windowHeight);
  p.onEvent = (name) => { if (name === 'reseed') build(); };

  p.draw = () => {
    const trail = get('trail');

    if (trail > 0) {
      // Fading in WEBGL means a translucent screen-space quad drawn before
      // any camera transform is applied.
      p.push();
      p.resetMatrix();
      p.noStroke();
      p.fill(0, 0, 0, 1 - trail);
      p.translate(0, 0, -1);
      p.plane(p.width * 2, p.height * 2);
      p.pop();
    } else {
      p.background(0);
    }

    const key = `${Math.floor(get('count'))}:${get('distribution')}`;
    if (key !== builtFor) build();

    const t = p.millis() * 0.001;
    const base = Math.min(p.width, p.height) * get('size') * get('zoom');
    const breathe = 1 + Math.sin(t * get('breatheRate') * 6.28) * get('breathe');
    const scale = base * breathe;

    const turb = get('turbulence');
    const tScale = get('turbulenceScale');
    const flow = t * get('flowSpeed');
    const explode = get('explode');
    const psize = get('particleSize');
    const glow = get('glow');
    const alpha = get('alpha');
    const mode = get('colorMode');
    const ca = get('colorA');
    const cb = get('colorB');

    if (get('interactive')) p.orbitControl(1, 1, 0.1);
    p.rotateX(p.radians(get('tilt')));
    p.rotateX(t * get('spinX'));
    p.rotateY(t * get('spinY'));
    p.rotateZ(t * get('spinZ'));
    // The rotated model-view matrix makes near/far colors follow what the
    // viewer sees. Local z did not change when the cube spun, leaving a
    // nearby face with the dark "far" color throughout part of the orbit.
    const view = p._renderer && p._renderer.uMVMatrix && p._renderer.uMVMatrix.mat4;

    if (get('showEdges')) {
      p.push();
      p.noFill();
      p.stroke(ca.r, ca.g, ca.b, 0.18);
      p.strokeWeight(1);
      p.box(scale);
      p.pop();
    }

    // Additive blending is what sells the glow — overlapping halos
    // accumulate into brightness instead of occluding one another.
    p.blendMode(p.ADD);
    p.noFill();

    const jitter = get('jitter');
    for (let b = 0; b < COLOR_BUCKETS; b++) buckets[b].length = 0;

    for (let i = 0; i < particles.length; i++) {
      const q = particles[i];

      const moving = turb > 0 || mode === 'speed';
      const nx = moving ? p.noise(q.bx * tScale + 10, q.by * tScale, q.bz * tScale + flow) - 0.5 : 0;
      const ny = moving ? p.noise(q.bx * tScale, q.by * tScale + 20, q.bz * tScale + flow) - 0.5 : 0;
      const nz = moving ? p.noise(q.bx * tScale, q.by * tScale, q.bz * tScale + 30 + flow) - 0.5 : 0;

      const push = explode * 0.5;
      const jx = q.jitterX * jitter;
      const jy = q.jitterY * jitter;
      const jz = q.jitterZ * jitter;

      const x = (q.bx + nx * turb + q.nx * push + jx) * scale;
      const y = (q.by + ny * turb + q.ny * push + jy) * scale;
      const z = (q.bz + nz * turb + q.nz * push + jz) * scale;

      let f;
      if (mode === 'axis') f = q.bx + 0.5;
      else if (mode === 'speed') f = Math.min(Math.hypot(nx, ny, nz) * 2.2, 1);
      else if (mode === 'solid') f = 0;
      else {
        const depth = view ? view[2] * x + view[6] * y + view[10] * z : z;
        f = p.constrain(0.5 - depth / (scale * 1.3), 0, 1);
      }

      const bucket = Math.min(COLOR_BUCKETS - 1, Math.max(0, Math.floor(f * COLOR_BUCKETS)));
      buckets[bucket].push(x, y, z);
    }

    for (let b = 0; b < COLOR_BUCKETS; b++) {
      const arr = buckets[b];
      if (arr.length === 0) continue;
      const f = (b + 0.5) / COLOR_BUCKETS;
      const cr = p.lerp(ca.r, cb.r, f);
      const cg = p.lerp(ca.g, cb.g, f);
      const cbv = p.lerp(ca.b, cb.b, f);

      if (glow > 0) {
        // Sparse halos avoid filling the silhouette into a solid tube.
        p.stroke(cr, cg, cbv, alpha * glow * 0.25);
        p.strokeWeight(Math.min(maxPointSize, psize * 2.7));
        p.beginShape(p.POINTS);
        for (let j = 0; j < arr.length; j += 12) p.vertex(arr[j], arr[j + 1], arr[j + 2]);
        p.endShape();
      }

      // The small luminous core keeps both near and far faces visible.
      // Opacity still controls the actual alpha of the core and halo.
      p.stroke(p.lerp(cr, 1, 0.35), p.lerp(cg, 1, 0.35), p.lerp(cbv, 1, 0.35), alpha);
      p.strokeWeight(Math.min(maxPointSize, Math.max(1.5, psize * 0.75)));
      p.beginShape(p.POINTS);
      for (let j = 0; j < arr.length; j += 3) p.vertex(arr[j], arr[j + 1], arr[j + 2]);
      p.endShape();
    }

    p.blendMode(p.BLEND);
  };
}
