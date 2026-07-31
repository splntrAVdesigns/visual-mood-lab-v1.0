/**
 * murmuration — the second flocking variant: a dense starling cloud that
 * wheels around a moving roost rather than dispersing across the frame.
 *
 * Deliberately not the same sketch with different defaults. Real
 * murmurations behave differently from textbook boids in two specific
 * ways, both modelled here: birds track a fixed number of NEAREST
 * neighbours regardless of distance (topological, not metric — this is
 * what lets density change without the flock falling apart), and the whole
 * cloud is bound to a roost point, which is why murmurations swirl in place
 * instead of wandering off. The classic Boids sketch next to this one is the
 * metric, unbounded version.
 */

export const params = {
  count: { kind: 'slider', label: 'Birds', min: 50, max: 1200, step: 25, default: 420, scale: 'log' },
  neighbours: { kind: 'stepper', label: 'Tracked neighbours', min: 2, max: 12, step: 1, default: 7, hint: 'Real starlings track roughly seven nearest birds, whatever the density.' },
  maxSpeed: { kind: 'slider', label: 'Max speed', min: 0.5, max: 8, step: 0.1, default: 3.4, modulatable: true },
  agility: { kind: 'slider', label: 'Agility', min: 0.01, max: 0.4, step: 0.01, default: 0.12 },
  separation: { kind: 'slider', label: 'Separation', min: 0, max: 4, step: 0.05, default: 1.9, modulatable: true },
  alignment: { kind: 'slider', label: 'Alignment', min: 0, max: 3, step: 0.05, default: 1.3, modulatable: true },
  cohesion: { kind: 'slider', label: 'Cohesion', min: 0, max: 3, step: 0.05, default: 1, modulatable: true },
  roostPull: { kind: 'slider', label: 'Roost pull', min: 0, max: 2, step: 0.02, default: 0.5, modulatable: true, hint: 'Binds the cloud to a drifting centre. Zero lets it wander freely.' },
  roostDrift: { kind: 'slider', label: 'Roost drift', min: 0, max: 1.5, step: 0.02, default: 0.28 },
  roostRadius: { kind: 'slider', label: 'Roost radius', min: 0.05, max: 0.6, step: 0.01, default: 0.3 },
  turbulence: { kind: 'slider', label: 'Turbulence', min: 0, max: 1.5, step: 0.02, default: 0.25, modulatable: true },
  size: { kind: 'slider', label: 'Bird size', min: 0.5, max: 8, step: 0.25, default: 2 },
  trail: { kind: 'slider', label: 'Trail', min: 0, max: 0.97, step: 0.01, default: 0.9 },
  densityShade: { kind: 'slider', label: 'Density shading', min: 0, max: 1, step: 0.02, default: 0.6, hint: 'Darkens birds in crowded regions, which is what gives a real murmuration its depth.' },
  colorA: { kind: 'color', label: 'Sparse', default: { r: 0, g: 0.83, b: 1, a: 1 } },
  colorB: { kind: 'color', label: 'Dense', default: { r: 0.15, g: 0.05, b: 0.35, a: 1 } },
  reseed: { kind: 'trigger', label: 'Reseed', default: null, event: 'reseed' },
};

export default function sketch(p, get) {
  let birds = [];

  function spawn(n) {
    birds = new Array(n).fill(null).map(() => ({
      x: p.width * (0.3 + Math.random() * 0.4),
      y: p.height * (0.3 + Math.random() * 0.4),
      vx: (Math.random() - 0.5) * 2,
      vy: (Math.random() - 0.5) * 2,
      crowd: 0,
    }));
  }

  p.setup = () => {
    p.createCanvas(p.windowWidth, p.windowHeight);
    p.colorMode(p.RGB, 1, 1, 1, 1);
    p.background(0);
    spawn(Math.floor(get('count')));
  };

  p.windowResized = () => { p.resizeCanvas(p.windowWidth, p.windowHeight); p.background(0); };
  p.onEvent = (name) => { if (name === 'reseed') { spawn(Math.floor(get('count'))); p.background(0); } };

  p.draw = () => {
    const n = Math.floor(get('count'));
    if (birds.length !== n) spawn(n);

    const trail = get('trail');
    p.noStroke();
    if (trail > 0) { p.fill(0, 0, 0, 1 - trail); p.rect(0, 0, p.width, p.height); }
    else p.background(0);

    const k = Math.floor(get('neighbours'));
    const maxSpeed = get('maxSpeed');
    const agility = get('agility');
    const sepW = get('separation');
    const aliW = get('alignment');
    const cohW = get('cohesion');
    const roostPull = get('roostPull');
    const turb = get('turbulence');
    const size = get('size');
    const shade = get('densityShade');
    const cA = get('colorA');
    const cB = get('colorB');

    const t = p.millis() * 0.001;
    const drift = get('roostDrift');
    const rr = get('roostRadius');
    const roostX = p.width * (0.5 + Math.cos(t * drift) * rr * 0.6);
    const roostY = p.height * (0.5 + Math.sin(t * drift * 1.27) * rr * 0.6);

    // Spatial bins keep the k-nearest search local instead of O(n squared).
    const cell = Math.max(40, Math.min(p.width, p.height) / 14);
    const cols = Math.max(1, Math.ceil(p.width / cell));
    const rows = Math.max(1, Math.ceil(p.height / cell));
    const bins = new Map();
    for (let i = 0; i < birds.length; i++) {
      const b = birds[i];
      const cx = Math.min(cols - 1, Math.max(0, Math.floor(b.x / cell)));
      const cy = Math.min(rows - 1, Math.max(0, Math.floor(b.y / cell)));
      const key = cy * cols + cx;
      let bucket = bins.get(key);
      if (!bucket) { bucket = []; bins.set(key, bucket); }
      bucket.push(i);
    }

    const cand = [];

    for (let i = 0; i < birds.length; i++) {
      const b = birds[i];
      const cx = Math.min(cols - 1, Math.max(0, Math.floor(b.x / cell)));
      const cy = Math.min(rows - 1, Math.max(0, Math.floor(b.y / cell)));

      cand.length = 0;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const nx = cx + ox, ny = cy + oy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const bucket = bins.get(ny * cols + nx);
          if (!bucket) continue;
          for (const j of bucket) {
            if (j === i) continue;
            const o = birds[j];
            const dx = o.x - b.x, dy = o.y - b.y;
            cand.push({ j, d2: dx * dx + dy * dy });
          }
        }
      }

      // Topological, not metric: take the k nearest whatever their distance.
      cand.sort((m, n2) => m.d2 - n2.d2);
      const take = Math.min(k, cand.length);
      b.crowd = take === 0 ? 0 : Math.min(1, 1 / Math.max(Math.sqrt(cand[Math.max(0, take - 1)].d2), 1) * 60);

      let sepX = 0, sepY = 0, aliX = 0, aliY = 0, cohX = 0, cohY = 0;
      for (let m = 0; m < take; m++) {
        const o = birds[cand[m].j];
        const dx = o.x - b.x, dy = o.y - b.y;
        const d2 = Math.max(cand[m].d2, 1);
        aliX += o.vx; aliY += o.vy;
        cohX += o.x; cohY += o.y;
        sepX -= dx / d2; sepY -= dy / d2;
      }

      let ax = 0, ay = 0;
      if (take > 0) {
        aliX /= take; aliY /= take;
        cohX = cohX / take - b.x; cohY = cohY / take - b.y;
        ax += sepX * sepW * 30 + aliX * aliW * 0.35 + cohX * cohW * 0.004;
        ay += sepY * sepW * 30 + aliY * aliW * 0.35 + cohY * cohW * 0.004;
      }

      if (roostPull > 0) {
        ax += (roostX - b.x) * 0.0008 * roostPull;
        ay += (roostY - b.y) * 0.0008 * roostPull;
      }

      if (turb > 0) {
        const nz = p.noise(b.x * 0.003, b.y * 0.003, t * 0.3) - 0.5;
        ax += Math.cos(nz * 12) * turb * 0.25;
        ay += Math.sin(nz * 12) * turb * 0.25;
      }

      b.vx += ax * agility * 3;
      b.vy += ay * agility * 3;

      const sp = Math.hypot(b.vx, b.vy);
      if (sp > maxSpeed) { b.vx = (b.vx / sp) * maxSpeed; b.vy = (b.vy / sp) * maxSpeed; }

      b.x += b.vx;
      b.y += b.vy;

      if (b.x < 0) b.x += p.width; else if (b.x > p.width) b.x -= p.width;
      if (b.y < 0) b.y += p.height; else if (b.y > p.height) b.y -= p.height;

      const f = b.crowd * shade;
      p.fill(p.lerp(cA.r, cB.r, f), p.lerp(cA.g, cB.g, f), p.lerp(cA.b, cB.b, f), 0.95);
      p.circle(b.x, b.y, size);
    }
  };
}
