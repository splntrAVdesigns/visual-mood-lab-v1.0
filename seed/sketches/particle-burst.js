/**
 * particle-burst — Visual Mood Lab seed asset 11
 *
 * Reference implementation for the p5 sketch authoring convention.
 *
 * Two exports, both required:
 *   `params`  — a plain object matching the Control type. The sandbox reads
 *               this at boot and posts it back to the host as a schema. It is
 *               real JS, so it type-checks against Control with no second
 *               parser to maintain.
 *   `default` — an instance-mode sketch factory receiving (p, get), where
 *               `get(id)` reads the current value of a control. Never read
 *               params by closing over a mutable variable; always call get(),
 *               so modulation and inspector edits land on the next frame.
 */

export const params = {
  count: {
    kind: 'slider',
    label: 'Particles',
    group: 'params',
    min: 50,
    max: 4000,
    step: 1,
    default: 1200,
    modulatable: true,
  },
  burstRate: {
    kind: 'slider',
    label: 'Burst rate',
    min: 0,
    max: 4,
    step: 0.01,
    default: 0.8,
    unit: 'hz',
    modulatable: true,
    hint: 'Bursts per second. Zero emits a single burst on reset.',
  },
  spread: {
    kind: 'slider',
    label: 'Spread',
    min: 0,
    max: 1,
    step: 0.01,
    default: 0.65,
    modulatable: true,
  },
  gravity: {
    kind: 'slider',
    label: 'Gravity',
    min: -1,
    max: 1,
    step: 0.005,
    default: 0.12,
    modulatable: true,
  },
  drag: {
    kind: 'slider',
    label: 'Drag',
    min: 0.8,
    max: 1,
    step: 0.001,
    default: 0.982,
    advanced: true,
  },
  size: {
    kind: 'slider',
    label: 'Particle size',
    min: 0.5,
    max: 8,
    step: 0.1,
    default: 1.8,
  },
  tint: {
    kind: 'color',
    label: 'Tint',
    default: { r: 0, g: 0.83, b: 1, a: 1 },
  },
  tintSpread: {
    kind: 'slider',
    label: 'Tint spread',
    min: 0,
    max: 1,
    step: 0.01,
    default: 0.3,
    hint: 'Per-particle hue deviation from the tint.',
  },
  blend: {
    kind: 'select',
    label: 'Blend',
    default: 'add',
    options: [
      { value: 'add', label: 'Add' },
      { value: 'blend', label: 'Normal' },
      { value: 'screen', label: 'Screen' },
    ],
  },
  trails: {
    kind: 'toggle',
    label: 'Trails',
    default: true,
  },
  trailFade: {
    kind: 'slider',
    label: 'Trail fade',
    min: 0.01,
    max: 0.5,
    step: 0.005,
    default: 0.08,
    showIf: { truthy: 'trails' },
  },
  reseed: {
    kind: 'trigger',
    label: 'Reseed',
    default: null,
    event: 'reseed',
  },
};

export default function sketch(p, get) {
  let particles = [];
  let lastBurst = 0;

  const BLEND = { add: 'ADD', blend: 'BLEND', screen: 'SCREEN' };

  function spawn() {
    const n = Math.floor(get('count'));
    const spread = get('spread');
    particles = new Array(n);

    for (let i = 0; i < n; i++) {
      const angle = p.random(p.TWO_PI);
      // sqrt keeps the disc uniformly filled instead of clustering at centre
      const speed = p.sqrt(p.random()) * (0.4 + spread * 6);
      particles[i] = {
        x: 0,
        y: 0,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: p.random(0.6, 1),
        hueShift: p.random(-1, 1),
      };
    }
  }

  p.setup = () => {
    p.createCanvas(p.windowWidth, p.windowHeight);
    p.colorMode(p.HSB, 360, 100, 100, 1);
    p.noStroke();
    spawn();
  };

  p.windowResized = () => {
    p.resizeCanvas(p.windowWidth, p.windowHeight);
  };

  // Called by the host when a trigger control fires.
  p.onEvent = (name) => {
    if (name === 'reseed') spawn();
  };

  p.draw = () => {
    const trails = get('trails');

    if (trails) {
      p.push();
      p.blendMode(p.BLEND);
      p.fill(0, 0, 0, get('trailFade'));
      p.rect(0, 0, p.width, p.height);
      p.pop();
    } else {
      p.background(0, 0, 0);
    }

    const rate = get('burstRate');
    if (rate > 0 && p.millis() - lastBurst > 1000 / rate) {
      spawn();
      lastBurst = p.millis();
    }

    if (particles.length !== Math.floor(get('count'))) spawn();

    const g = get('gravity') * 0.12;
    const drag = get('drag');
    const size = get('size');
    const tint = get('tint');
    const tintSpread = get('tintSpread');

    // p5 HSB hue is 0..360; the tint arrives as normalised RGBA.
    const base = rgbToHue(tint.r, tint.g, tint.b);

    p.blendMode(p[BLEND[get('blend')] ?? 'ADD']);
    p.translate(p.width / 2, p.height / 2);

    for (let i = 0; i < particles.length; i++) {
      const q = particles[i];
      q.vy += g;
      q.vx *= drag;
      q.vy *= drag;
      q.x += q.vx;
      q.y += q.vy;
      q.life *= 0.995;

      const hue = (base + q.hueShift * tintSpread * 90 + 360) % 360;
      p.fill(hue, 70, 100, q.life * tint.a);
      p.circle(q.x, q.y, size * q.life);
    }
  };
}

function rgbToHue(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return 0;
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}
