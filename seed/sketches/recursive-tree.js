/** recursive-tree — branching L-system with per-branch jitter and wind. */

export const params = {
  depth: { kind: 'stepper', label: 'Depth', min: 3, max: 13, step: 1, default: 10 },
  branches: { kind: 'stepper', label: 'Branches', min: 2, max: 4, step: 1, default: 2 },
  angle: { kind: 'slider', label: 'Branch angle', min: 5, max: 75, step: 0.5, default: 26, unit: 'deg', modulatable: true },
  shrink: { kind: 'slider', label: 'Length ratio', min: 0.5, max: 0.9, step: 0.005, default: 0.72 },
  trunk: { kind: 'slider', label: 'Trunk length', min: 0.05, max: 0.45, step: 0.005, default: 0.22 },
  jitter: { kind: 'slider', label: 'Jitter', min: 0, max: 1, step: 0.01, default: 0.18 },
  wind: { kind: 'slider', label: 'Wind', min: 0, max: 1, step: 0.01, default: 0.15, modulatable: true },
  windRate: { kind: 'slider', label: 'Wind rate', min: 0.05, max: 3, step: 0.05, default: 0.5, showIf: { truthy: 'wind' } },
  weight: { kind: 'slider', label: 'Base weight', min: 0.5, max: 12, step: 0.1, default: 5 },
  taper: { kind: 'slider', label: 'Taper', min: 0.5, max: 1, step: 0.01, default: 0.72, advanced: true },
  trunkColor: { kind: 'color', label: 'Trunk', default: { r: 0.27, g: 0.27, b: 0.3, a: 1 } },
  tipColor: { kind: 'color', label: 'Tips', default: { r: 0, g: 0.83, b: 1, a: 1 } },
  reseed: { kind: 'trigger', label: 'Reseed', default: null, event: 'reseed', advanced: true, midi: false },
};

export default function sketch(p, get) {
  let seed = 1234;

  p.setup = () => {
    p.createCanvas(p.windowWidth, p.windowHeight);
    p.colorMode(p.RGB, 1, 1, 1, 1);
  };

  p.windowResized = () => p.resizeCanvas(p.windowWidth, p.windowHeight);

  p.onEvent = (name) => {
    if (name === 'reseed') seed = Math.floor(Math.random() * 100000);
  };

  function branch(len, depth, maxDepth, weight) {
    if (depth > maxDepth || len < 0.5) return;

    const t = depth / maxDepth;
    const a = get('trunkColor');
    const b = get('tipColor');

    p.stroke(
      p.lerp(a.r, b.r, t),
      p.lerp(a.g, b.g, t),
      p.lerp(a.b, b.b, t),
      p.lerp(a.a, b.a, t),
    );
    p.strokeWeight(Math.max(weight, 0.3));
    p.line(0, 0, 0, -len);
    p.translate(0, -len);

    const n = get('branches');
    const spread = get('angle');
    const jitter = get('jitter');
    const wind = get('wind') * Math.sin(p.millis() * 0.001 * get('windRate') + depth * 0.6) * 12;

    for (let i = 0; i < n; i++) {
      // Even fan for n>2, simple mirror for n===2
      const base = n === 2 ? (i === 0 ? -spread : spread) : p.map(i, 0, n - 1, -spread, spread);
      const noise = (p.noise(seed + depth * 10 + i * 3.7) - 0.5) * spread * 2 * jitter;

      p.push();
      p.rotate(p.radians(base + noise + wind));
      branch(len * get('shrink'), depth + 1, maxDepth, weight * get('taper'));
      p.pop();
    }
  }

  p.draw = () => {
    p.background(0);
    p.push();
    p.translate(p.width / 2, p.height * 0.96);
    branch(p.height * get('trunk'), 0, Math.floor(get('depth')), get('weight'));
    p.pop();
  };
}
