/**
 * particle-detractor — particles orbiting attractors that can be flipped to
 * repel, tearing the field apart and letting it re-form.
 *
 * The interesting behaviour lives at the boundary: with mixed attract and
 * repel points, particles get caught between competing wells and trace out
 * the separatrix — the dividing line where the forces balance. That is the
 * structure this is really drawing, and why a slow trail matters more here
 * than in most particle sketches: individual frames show dots, but the
 * accumulation shows the field itself.
 */

export const params = {
  count: { kind: 'slider', label: 'Particles', min: 100, max: 6000, step: 100, default: 1600, scale: 'log' },
  nodes: { kind: 'stepper', label: 'Attractor nodes', min: 1, max: 10, step: 1, default: 4 },
  polarity: { kind: 'select', label: 'Polarity', default: 'mixed', options: [
    { value: 'attract', label: 'All attract' },
    { value: 'repel', label: 'All repel' },
    { value: 'mixed', label: 'Alternating' },
  ] },
  strength: { kind: 'slider', label: 'Field strength', min: 0.1, max: 12, step: 0.1, default: 3.2, modulatable: true },
  falloff: { kind: 'slider', label: 'Falloff', min: 0.5, max: 3, step: 0.05, default: 1.5, hint: 'Exponent on distance. 2 is true inverse-square; lower reaches further.' },
  minDistance: { kind: 'slider', label: 'Core radius', min: 2, max: 80, step: 1, default: 22, unit: 'px', hint: 'Prevents infinite force at the exact node position.' },
  orbit: { kind: 'slider', label: 'Orbital force', min: -2, max: 2, step: 0.02, default: 0.6, modulatable: true, hint: 'Perpendicular force. Turns collapse into orbit.' },
  drag: { kind: 'slider', label: 'Drag', min: 0.8, max: 1, step: 0.002, default: 0.976 },
  nodeMotion: { kind: 'slider', label: 'Node motion', min: 0, max: 1.5, step: 0.02, default: 0.25 },
  nodeSpread: { kind: 'slider', label: 'Node spread', min: 0.1, max: 0.9, step: 0.02, default: 0.42 },
  maxSpeed: { kind: 'slider', label: 'Max speed', min: 1, max: 20, step: 0.5, default: 7 },
  size: { kind: 'slider', label: 'Particle size', min: 0.5, max: 6, step: 0.25, default: 1.4 },
  trail: { kind: 'slider', label: 'Trail', min: 0, max: 0.98, step: 0.01, default: 0.93 },
  showNodes: { kind: 'toggle', label: 'Show nodes', default: false },
  colorMode: { kind: 'select', label: 'Colour by', default: 'speed', options: [
    { value: 'solid', label: 'Solid' },
    { value: 'speed', label: 'Speed' },
    { value: 'nearest', label: 'Nearest node' },
  ] },
  colorA: { kind: 'color', label: 'Colour A', default: { r: 0, g: 0.83, b: 1, a: 1 } },
  colorB: { kind: 'color', label: 'Colour B', default: { r: 0.95, g: 0.25, b: 0.55, a: 1 } },
  reseed: { kind: 'trigger', label: 'Reseed', default: null, event: 'reseed', advanced: true, midi: false },
};

export default function sketch(p, get) {
  let parts = [];

  function spawn(n) {
    parts = new Array(n).fill(null).map(() => ({
      x: Math.random() * p.width,
      y: Math.random() * p.height,
      vx: 0, vy: 0, near: 0,
    }));
  }

  p.setup = () => {
    p.createCanvas(p.windowWidth, p.windowHeight);
    p.colorMode(p.RGB, 1, 1, 1, 1);
    p.background(0);
    p.noStroke();
    spawn(Math.floor(get('count')));
  };

  p.windowResized = () => { p.resizeCanvas(p.windowWidth, p.windowHeight); p.background(0); };
  p.onEvent = (name) => { if (name === 'reseed') { spawn(Math.floor(get('count'))); p.background(0); } };

  p.draw = () => {
    const n = Math.floor(get('count'));
    if (parts.length !== n) spawn(n);

    const trail = get('trail');
    p.noStroke();
    if (trail > 0) { p.fill(0, 0, 0, 1 - trail); p.rect(0, 0, p.width, p.height); }
    else p.background(0);

    const nodeCount = Math.floor(get('nodes'));
    const polarity = get('polarity');
    const strength = get('strength');
    const falloff = get('falloff');
    const minD = get('minDistance');
    const orbit = get('orbit');
    const drag = get('drag');
    const maxSpeed = get('maxSpeed');
    const size = get('size');
    const cMode = get('colorMode');
    const cA = get('colorA');
    const cB = get('colorB');

    const t = p.millis() * 0.001;
    const motion = get('nodeMotion');
    const spread = get('nodeSpread');

    const nodes = [];
    for (let i = 0; i < nodeCount; i++) {
      const f = nodeCount === 1 ? 0 : i / nodeCount;
      const a = f * Math.PI * 2 + t * motion;
      nodes.push({
        x: p.width * (0.5 + Math.cos(a) * spread),
        y: p.height * (0.5 + Math.sin(a * 1.13) * spread),
        sign: polarity === 'attract' ? 1 : polarity === 'repel' ? -1 : (i % 2 === 0 ? 1 : -1),
      });
    }

    const minD2 = minD * minD;

    for (const q of parts) {
      let ax = 0, ay = 0;
      let nearest = 0, nearestD2 = Infinity;

      for (let i = 0; i < nodes.length; i++) {
        const nd = nodes[i];
        const dx = nd.x - q.x, dy = nd.y - q.y;
        const d2 = Math.max(dx * dx + dy * dy, minD2);
        if (d2 < nearestD2) { nearestD2 = d2; nearest = i; }

        const d = Math.sqrt(d2);
        // Generalised inverse-power falloff; falloff=2 is inverse-square.
        const f = (strength * 1000 * nd.sign) / Math.pow(d, falloff * 2);
        ax += (dx / d) * f;
        ay += (dy / d) * f;

        if (orbit !== 0) {
          // Perpendicular component turns straight collapse into orbit.
          ax += (-dy / d) * f * orbit;
          ay += (dx / d) * f * orbit;
        }
      }

      q.near = nodes.length > 1 ? nearest / (nodes.length - 1) : 0;

      q.vx = (q.vx + ax) * drag;
      q.vy = (q.vy + ay) * drag;

      const sp = Math.hypot(q.vx, q.vy);
      if (sp > maxSpeed) { q.vx = (q.vx / sp) * maxSpeed; q.vy = (q.vy / sp) * maxSpeed; }

      q.x += q.vx;
      q.y += q.vy;

      if (q.x < -50 || q.x > p.width + 50 || q.y < -50 || q.y > p.height + 50) {
        q.x = Math.random() * p.width;
        q.y = Math.random() * p.height;
        q.vx = 0; q.vy = 0;
      }

      let f = 0;
      if (cMode === 'speed') f = Math.min(sp / maxSpeed, 1);
      else if (cMode === 'nearest') f = q.near;

      p.fill(p.lerp(cA.r, cB.r, f), p.lerp(cA.g, cB.g, f), p.lerp(cA.b, cB.b, f), 0.85);
      p.circle(q.x, q.y, size);
    }

    if (get('showNodes')) {
      for (const nd of nodes) {
        p.noFill();
        p.stroke(nd.sign > 0 ? cA.r : cB.r, nd.sign > 0 ? cA.g : cB.g, nd.sign > 0 ? cA.b : cB.b, 0.6);
        p.strokeWeight(1);
        p.circle(nd.x, nd.y, minD * 2);
      }
      p.noStroke();
    }
  };
}
