/** koch-snowflake — iterated fractal edge, computed once per parameter change. */

export const params = {
  iterations: { kind: 'stepper', label: 'Iterations', min: 0, max: 6, step: 1, default: 4 },
  sides: { kind: 'stepper', label: 'Base sides', min: 3, max: 12, step: 1, default: 3 },
  bump: { kind: 'slider', label: 'Bump height', min: -1, max: 1.5, step: 0.01, default: 0.577, hint: 'Negative inverts the spikes inward.', modulatable: true },
  scale: { kind: 'slider', label: 'Scale', min: 0.2, max: 1.1, step: 0.005, default: 0.62 },
  rotation: { kind: 'slider', label: 'Rotation', min: -180, max: 180, step: 0.5, default: 0, unit: 'deg', modulatable: true },
  spin: { kind: 'slider', label: 'Spin', min: -1, max: 1, step: 0.005, default: 0.03 },
  weight: { kind: 'slider', label: 'Stroke weight', min: 0.25, max: 6, step: 0.05, default: 1.2 },
  stroke: { kind: 'color', label: 'Stroke', default: { r: 0, g: 0.83, b: 1, a: 1 } },
  fill: { kind: 'color', label: 'Fill', default: { r: 0, g: 0, b: 0, a: 0 } },
  showPoints: { kind: 'toggle', label: 'Show vertices', default: false, advanced: true },
};

export default function sketch(p, get) {
  let cache = null;
  let cacheKey = '';

  function build(iterations, sides, bump) {
    let pts = [];
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2 - Math.PI / 2;
      pts.push({ x: Math.cos(a), y: Math.sin(a) });
    }

    for (let it = 0; it < iterations; it++) {
      const next = [];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        const dx = b.x - a.x;
        const dy = b.y - a.y;

        const p1 = { x: a.x + dx / 3, y: a.y + dy / 3 };
        const p2 = { x: a.x + (dx * 2) / 3, y: a.y + (dy * 2) / 3 };
        // Apex is the midpoint of p1..p2 pushed along the edge normal.
        const mx = (p1.x + p2.x) / 2;
        const my = (p1.y + p2.y) / 2;
        const apex = { x: mx + (-dy / 3) * bump, y: my + (dx / 3) * bump };

        next.push(a, p1, apex, p2);
      }
      pts = next;
      if (pts.length > 200000) break;
    }
    return pts;
  }

  p.setup = () => {
    p.createCanvas(p.windowWidth, p.windowHeight);
    p.colorMode(p.RGB, 1, 1, 1, 1);
  };

  p.windowResized = () => p.resizeCanvas(p.windowWidth, p.windowHeight);

  p.draw = () => {
    p.background(0);

    const it = Math.floor(get('iterations'));
    const sides = Math.floor(get('sides'));
    const bump = get('bump');

    // Rebuilding 4^n points every frame is wasteful; only recompute on change.
    const key = `${it}:${sides}:${bump.toFixed(3)}`;
    if (key !== cacheKey) {
      cache = build(it, sides, bump);
      cacheKey = key;
    }

    const r = (Math.min(p.width, p.height) / 2) * get('scale');
    const st = get('stroke');
    const fl = get('fill');

    p.push();
    p.translate(p.width / 2, p.height / 2);
    p.rotate(p.radians(get('rotation')) + p.millis() * 0.001 * get('spin'));

    p.stroke(st.r, st.g, st.b, st.a);
    p.strokeWeight(get('weight'));
    fl.a > 0 ? p.fill(fl.r, fl.g, fl.b, fl.a) : p.noFill();

    p.beginShape();
    for (const q of cache) p.vertex(q.x * r, q.y * r);
    p.endShape(p.CLOSE);

    if (get('showPoints') && cache.length < 4000) {
      p.noStroke();
      p.fill(st.r, st.g, st.b, 0.8);
      for (const q of cache) p.circle(q.x * r, q.y * r, 2.5);
    }

    p.pop();
  };
}
