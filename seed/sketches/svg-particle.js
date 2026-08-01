/**
 * svg-particle — particles that assemble into a vector shape, scatter from
 * the pointer, and reassemble.
 *
 * Ported from a supplied component that sampled pixel data from a
 * user-supplied image to decide where particles live. That version needed a
 * linked image; this one generates its source shapes procedurally instead,
 * which means it works standalone with nothing to configure — the same
 * reasoning behind ASCII Mosaic and Chromatic Glitch shipping with built-in
 * fallback patterns rather than requiring a linked source.
 *
 * The sampling approach is unchanged in spirit: draw a shape, walk it on a
 * grid, and keep a particle wherever the shape is solid. Here the "is this
 * solid" test is analytic (a signed-distance check per shape) rather than
 * an alpha lookup into an image buffer, which is both faster and lets the
 * shape change live without re-sampling a bitmap.
 *
 * Live image sources for p5 sketches are deliberately not wired yet — the
 * texture picker currently resolves images for GLSL shaders only, and
 * carrying decoded pixel data across the sandbox's postMessage boundary is
 * a real protocol extension rather than a small addition.
 */

export const params = {
  shape: { kind: 'select', label: 'Shape', default: 'ring', options: [
    { value: 'ring', label: 'Ring' },
    { value: 'grid', label: 'Grid' },
    { value: 'cross', label: 'Cross' },
    { value: 'wave', label: 'Wave' },
    { value: 'burst', label: 'Burst' },
  ] },
  density: { kind: 'slider', label: 'Density', min: 4, max: 40, step: 1, default: 16, hint: 'Sampling resolution. Higher means more, smaller particles.' },
  particleSize: { kind: 'slider', label: 'Particle size', min: 1, max: 14, step: 0.5, default: 4, modulatable: true },
  particleShape: { kind: 'select', label: 'Particle shape', default: 'circle', options: [
    { value: 'circle', label: 'Circle' },
    { value: 'square', label: 'Square' },
  ] },
  scale: { kind: 'slider', label: 'Shape scale', min: 0.2, max: 1.2, step: 0.02, default: 0.62, modulatable: true },

  repelRadius: { kind: 'slider', label: 'Repel radius', min: 20, max: 320, step: 5, default: 120, unit: 'px' },
  repelForce: { kind: 'slider', label: 'Repel force', min: 0, max: 6, step: 0.1, default: 2.2, modulatable: true },
  returnSpeed: { kind: 'slider', label: 'Return speed', min: 0.005, max: 0.2, step: 0.005, default: 0.045, hint: 'How quickly particles find their way home.' },
  damping: { kind: 'slider', label: 'Damping', min: 0.7, max: 0.99, step: 0.01, default: 0.9 },

  drift: { kind: 'slider', label: 'Idle drift', min: 0, max: 2, step: 0.02, default: 0.25, modulatable: true, hint: 'Motion when the pointer is away, so the shape is never fully static.' },
  driftScale: { kind: 'slider', label: 'Drift scale', min: 0.2, max: 5, step: 0.05, default: 1.4, scale: 'log' },
  spin: { kind: 'slider', label: 'Spin', min: -1.5, max: 1.5, step: 0.01, default: 0.08, modulatable: true },

  colorMode: { kind: 'select', label: 'Colour by', default: 'radius', options: [
    { value: 'solid', label: 'Solid' },
    { value: 'radius', label: 'Distance from centre' },
    { value: 'displacement', label: 'Displacement' },
  ] },
  colorA: { kind: 'color', label: 'Colour A', default: { r: 0, g: 0.83, b: 1, a: 1 } },
  colorB: { kind: 'color', label: 'Colour B', default: { r: 0.75, g: 0.15, b: 0.85, a: 1 } },
  alpha: { kind: 'slider', label: 'Opacity', min: 0.1, max: 1, step: 0.02, default: 0.9 },
  trail: { kind: 'slider', label: 'Trail', min: 0, max: 0.95, step: 0.01, default: 0 },
  reseed: { kind: 'trigger', label: 'Rebuild', default: null, event: 'reseed' },
};

export default function sketch(p, get) {
  let parts = [];
  let builtFor = '';

  /** Analytic "is this point inside the shape" test, in -1..1 space. */
  function inside(shape, x, y) {
    const r = Math.hypot(x, y);
    if (shape === 'grid') {
      const gx = Math.abs((x * 4) % 1) < 0.22;
      const gy = Math.abs((y * 4) % 1) < 0.22;
      return (gx || gy) && r < 1;
    }
    if (shape === 'cross') {
      return (Math.abs(x) < 0.22 || Math.abs(y) < 0.22) && r < 1;
    }
    if (shape === 'wave') {
      return Math.abs(y - Math.sin(x * 3.2) * 0.42) < 0.16;
    }
    if (shape === 'burst') {
      const a = Math.atan2(y, x);
      const spokes = 0.35 + 0.5 * Math.abs(Math.cos(a * 6));
      return r < spokes;
    }
    // ring
    return r < 1 && r > 0.55;
  }

  function build() {
    const shape = get('shape');
    const density = Math.floor(get('density'));
    const base = Math.min(p.width, p.height) * get('scale');
    const step = 2 / (density * 2);

    parts = [];
    for (let y = -1; y <= 1; y += step) {
      for (let x = -1; x <= 1; x += step) {
        if (!inside(shape, x, y)) continue;
        const hx = p.width / 2 + x * base;
        const hy = p.height / 2 + y * base;
        parts.push({
          hx, hy,
          x: hx, y: hy,
          vx: 0, vy: 0,
          r: Math.hypot(x, y),
          seed: Math.random() * 1000,
        });
      }
    }
  }

  p.setup = () => {
    p.createCanvas(p.windowWidth, p.windowHeight);
    p.colorMode(p.RGB, 1, 1, 1, 1);
    p.noStroke();
    build();
    builtFor = `${get('shape')}:${get('density')}:${get('scale')}`;
  };

  p.windowResized = () => { p.resizeCanvas(p.windowWidth, p.windowHeight); build(); };
  p.onEvent = (name) => { if (name === 'reseed') build(); };

  p.draw = () => {
    const key = `${get('shape')}:${get('density')}:${get('scale')}`;
    if (key !== builtFor) { build(); builtFor = key; }

    const trail = get('trail');
    if (trail > 0) {
      p.fill(0, 0, 0, 1 - trail);
      p.rect(0, 0, p.width, p.height);
    } else {
      p.background(0);
    }

    const t = p.millis() * 0.001;
    const spin = get('spin');
    const drift = get('drift');
    const driftScale = get('driftScale');
    const repelR = get('repelRadius');
    const repelF = get('repelForce');
    const ret = get('returnSpeed');
    const damp = get('damping');
    const size = get('particleSize');
    const pShape = get('particleShape');
    const cMode = get('colorMode');
    const cA = get('colorA');
    const cB = get('colorB');
    const alpha = get('alpha');

    const inside2 = p.mouseX > 0 && p.mouseX < p.width && p.mouseY > 0 && p.mouseY < p.height;
    const repelR2 = repelR * repelR;
    const cx = p.width / 2, cy = p.height / 2;

    for (const q of parts) {
      // Home position, optionally rotated about the centre.
      let hx = q.hx, hy = q.hy;
      if (spin !== 0) {
        const dx = q.hx - cx, dy = q.hy - cy;
        const a = t * spin;
        hx = cx + dx * Math.cos(a) - dy * Math.sin(a);
        hy = cy + dx * Math.sin(a) + dy * Math.cos(a);
      }

      if (drift > 0) {
        const n = p.noise(q.seed * 0.01, t * 0.2) - 0.5;
        const n2 = p.noise(q.seed * 0.01 + 40, t * 0.2) - 0.5;
        hx += n * drift * 30 * driftScale;
        hy += n2 * drift * 30 * driftScale;
      }

      if (inside2 && repelF > 0) {
        const dx = q.x - p.mouseX, dy = q.y - p.mouseY;
        const d2 = dx * dx + dy * dy;
        if (d2 < repelR2 && d2 > 1e-4) {
          const d = Math.sqrt(d2);
          const f = (1 - d / repelR) * repelF;
          q.vx += (dx / d) * f;
          q.vy += (dy / d) * f;
        }
      }

      q.vx += (hx - q.x) * ret;
      q.vy += (hy - q.y) * ret;
      q.vx *= damp;
      q.vy *= damp;
      q.x += q.vx;
      q.y += q.vy;

      let f = 0;
      if (cMode === 'radius') f = Math.min(q.r, 1);
      else if (cMode === 'displacement') f = Math.min(Math.hypot(q.x - hx, q.y - hy) / 60, 1);

      p.fill(p.lerp(cA.r, cB.r, f), p.lerp(cA.g, cB.g, f), p.lerp(cA.b, cB.b, f), alpha);
      if (pShape === 'square') p.rect(q.x - size / 2, q.y - size / 2, size, size);
      else p.circle(q.x, q.y, size);
    }
  };
}
