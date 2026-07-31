/**
 * flocking — classic boids: separation, alignment, cohesion.
 *
 * Reynolds' three rules, unchanged since 1986, because nothing simpler
 * produces this behaviour and nothing more complex is needed. The only
 * detail worth flagging is the spatial hash: naive boids are O(n squared),
 * which caps you at a few hundred agents before the frame budget dies.
 * Binning by grid cell and only checking neighbouring bins keeps it near
 * linear, which is what makes the high end of the Boids slider usable
 * rather than decorative.
 */

export const params = {
  count: { kind: 'slider', label: 'Boids', min: 20, max: 900, step: 10, default: 260, scale: 'log' },
  maxSpeed: { kind: 'slider', label: 'Max speed', min: 0.5, max: 8, step: 0.1, default: 3, modulatable: true },
  maxForce: { kind: 'slider', label: 'Turn force', min: 0.01, max: 0.5, step: 0.01, default: 0.09 },
  perception: { kind: 'slider', label: 'Perception', min: 10, max: 160, step: 5, default: 55, unit: 'px' },
  separation: { kind: 'slider', label: 'Separation', min: 0, max: 3, step: 0.05, default: 1.4, modulatable: true },
  alignment: { kind: 'slider', label: 'Alignment', min: 0, max: 3, step: 0.05, default: 1, modulatable: true },
  cohesion: { kind: 'slider', label: 'Cohesion', min: 0, max: 3, step: 0.05, default: 0.85, modulatable: true },
  wander: { kind: 'slider', label: 'Wander', min: 0, max: 1, step: 0.02, default: 0.06 },
  avoidPointer: { kind: 'slider', label: 'Avoid pointer', min: 0, max: 3, step: 0.05, default: 1.2, hint: 'Boids scatter from the cursor while it is over the canvas.' },
  render: { kind: 'select', label: 'Render', default: 'arrow', options: [
    { value: 'arrow', label: 'Arrows' },
    { value: 'dot', label: 'Dots' },
    { value: 'trail', label: 'Trails' },
  ] },
  size: { kind: 'slider', label: 'Size', min: 1, max: 12, step: 0.25, default: 4 },
  trail: { kind: 'slider', label: 'Trail', min: 0, max: 0.95, step: 0.01, default: 0.82 },
  colorMode: { kind: 'select', label: 'Colour by', default: 'speed', options: [
    { value: 'solid', label: 'Solid' },
    { value: 'speed', label: 'Speed' },
    { value: 'heading', label: 'Heading' },
  ] },
  colorA: { kind: 'color', label: 'Colour A', default: { r: 0, g: 0.83, b: 1, a: 1 } },
  colorB: { kind: 'color', label: 'Colour B', default: { r: 0.7, g: 0.15, b: 0.85, a: 1 } },
  reseed: { kind: 'trigger', label: 'Reseed', default: null, event: 'reseed' },
};

export default function sketch(p, get) {
  let boids = [];

  function spawn(n) {
    boids = new Array(n).fill(null).map(() => ({
      x: Math.random() * p.width,
      y: Math.random() * p.height,
      vx: (Math.random() - 0.5) * 2,
      vy: (Math.random() - 0.5) * 2,
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
    if (boids.length !== n) spawn(n);

    const trail = get('trail');
    if (trail > 0) {
      p.noStroke();
      p.fill(0, 0, 0, 1 - trail);
      p.rect(0, 0, p.width, p.height);
    } else {
      p.background(0);
    }

    const perception = get('perception');
    const maxSpeed = get('maxSpeed');
    const maxForce = get('maxForce');
    const sepW = get('separation');
    const aliW = get('alignment');
    const cohW = get('cohesion');
    const wander = get('wander');
    const avoid = get('avoidPointer');
    const mode = get('render');
    const size = get('size');
    const cMode = get('colorMode');
    const cA = get('colorA');
    const cB = get('colorB');

    // Spatial hash — the reason the high end of the Boids slider is usable.
    const cell = Math.max(perception, 10);
    const cols = Math.max(1, Math.ceil(p.width / cell));
    const rows = Math.max(1, Math.ceil(p.height / cell));
    const bins = new Map();
    for (let i = 0; i < boids.length; i++) {
      const b = boids[i];
      const cx = Math.min(cols - 1, Math.max(0, Math.floor(b.x / cell)));
      const cy = Math.min(rows - 1, Math.max(0, Math.floor(b.y / cell)));
      const key = cy * cols + cx;
      let bucket = bins.get(key);
      if (!bucket) { bucket = []; bins.set(key, bucket); }
      bucket.push(i);
    }

    const pointerInside = p.mouseX > 0 && p.mouseX < p.width && p.mouseY > 0 && p.mouseY < p.height;
    const p2 = perception * perception;

    for (let i = 0; i < boids.length; i++) {
      const b = boids[i];
      let sepX = 0, sepY = 0, aliX = 0, aliY = 0, cohX = 0, cohY = 0, count = 0;

      const cx = Math.min(cols - 1, Math.max(0, Math.floor(b.x / cell)));
      const cy = Math.min(rows - 1, Math.max(0, Math.floor(b.y / cell)));

      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const nx = cx + ox, ny = cy + oy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const bucket = bins.get(ny * cols + nx);
          if (!bucket) continue;

          for (const j of bucket) {
            if (j === i) continue;
            const o = boids[j];
            const dx = o.x - b.x, dy = o.y - b.y;
            const d2 = dx * dx + dy * dy;
            if (d2 > p2 || d2 === 0) continue;

            aliX += o.vx; aliY += o.vy;
            cohX += o.x; cohY += o.y;
            const inv = 1 / Math.max(d2, 1);
            sepX -= dx * inv; sepY -= dy * inv;
            count++;
          }
        }
      }

      let ax = 0, ay = 0;
      if (count > 0) {
        aliX /= count; aliY /= count;
        cohX = cohX / count - b.x; cohY = cohY / count - b.y;

        const steer = (vx, vy, w) => {
          const m = Math.hypot(vx, vy);
          if (m < 1e-6) return [0, 0];
          const sx = (vx / m) * maxSpeed - b.vx;
          const sy = (vy / m) * maxSpeed - b.vy;
          const sm = Math.hypot(sx, sy);
          const lim = sm > maxForce ? maxForce / sm : 1;
          return [sx * lim * w, sy * lim * w];
        };

        const [sx, sy] = steer(sepX, sepY, sepW);
        const [alx, aly] = steer(aliX, aliY, aliW);
        const [ccx, ccy] = steer(cohX, cohY, cohW);
        ax += sx + alx + ccx;
        ay += sy + aly + ccy;
      }

      if (wander > 0) {
        ax += (Math.random() - 0.5) * wander * 0.5;
        ay += (Math.random() - 0.5) * wander * 0.5;
      }

      if (pointerInside && avoid > 0) {
        const dx = b.x - p.mouseX, dy = b.y - p.mouseY;
        const d = Math.hypot(dx, dy);
        if (d < perception * 1.6 && d > 1e-4) {
          const f = (1 - d / (perception * 1.6)) * avoid * 0.5;
          ax += (dx / d) * f;
          ay += (dy / d) * f;
        }
      }

      b.vx += ax;
      b.vy += ay;
      const sp = Math.hypot(b.vx, b.vy);
      if (sp > maxSpeed) { b.vx = (b.vx / sp) * maxSpeed; b.vy = (b.vy / sp) * maxSpeed; }

      b.x += b.vx;
      b.y += b.vy;

      // Wrap rather than bounce — a flock that never hits a wall reads as
      // continuous rather than trapped in a box.
      if (b.x < 0) b.x += p.width; else if (b.x > p.width) b.x -= p.width;
      if (b.y < 0) b.y += p.height; else if (b.y > p.height) b.y -= p.height;

      let f = 0;
      if (cMode === 'speed') f = Math.min(sp / maxSpeed, 1);
      else if (cMode === 'heading') f = (Math.atan2(b.vy, b.vx) + Math.PI) / (Math.PI * 2);

      const cr = p.lerp(cA.r, cB.r, f);
      const cg = p.lerp(cA.g, cB.g, f);
      const cb = p.lerp(cA.b, cB.b, f);

      if (mode === 'dot') {
        p.noStroke();
        p.fill(cr, cg, cb, 1);
        p.circle(b.x, b.y, size);
      } else if (mode === 'trail') {
        p.stroke(cr, cg, cb, 0.9);
        p.strokeWeight(size * 0.5);
        p.line(b.x, b.y, b.x - b.vx * 3, b.y - b.vy * 3);
      } else {
        p.noStroke();
        p.fill(cr, cg, cb, 1);
        const a = Math.atan2(b.vy, b.vx);
        p.push();
        p.translate(b.x, b.y);
        p.rotate(a);
        p.triangle(size * 1.6, 0, -size * 0.8, size * 0.6, -size * 0.8, -size * 0.6);
        p.pop();
      }
    }
  };
}
