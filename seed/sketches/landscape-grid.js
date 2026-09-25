/**
 * landscape-grid — a wireframe terrain that scrolls toward the viewer.
 *
 * Sits deliberately alongside the existing Terrain Wireframe sketch but
 * takes the opposite approach: that one is a p5 WEBGL mesh you orbit around
 * in true 3D. This is a flat 2D canvas doing its own perspective division —
 * every vertex projected by hand — which is what allows the horizon-locked,
 * infinitely-scrolling look that a real 3D camera makes awkward. It is also
 * dramatically cheaper, so the grid can be much denser.
 */

export const params = {
  cols: { kind: 'stepper', label: 'Columns', min: 8, max: 120, step: 2, default: 48 },
  rows: { kind: 'stepper', label: 'Rows', min: 8, max: 80, step: 2, default: 34 },
  speed: { kind: 'slider', label: 'Scroll speed', min: 0, max: 4, step: 0.02, default: 0.5, modulatable: true },
  height: { kind: 'slider', label: 'Height', min: 0, max: 1, step: 0.01, default: 0.5, modulatable: true, hint: 'Moves the entire grid vertically; zero places it near the bottom.' },
  amplitude: { kind: 'slider', label: 'Terrain relief', min: 0, max: 1.5, step: 0.02, default: 0.42, hint: 'Strength of peaks and valleys, independent of Height.' },
  noiseScale: { kind: 'slider', label: 'Terrain scale', min: 0.2, max: 5, step: 0.05, default: 1.3, scale: 'log' },
  octaves: { kind: 'stepper', label: 'Detail', min: 1, max: 6, step: 1, default: 4 },
  ridged: { kind: 'toggle', label: 'Ridged', default: false, hint: 'Sharp peaks instead of rolling hills.' },
  horizon: { kind: 'slider', label: 'Horizon', min: 0.05, max: 0.7, step: 0.01, default: 0.34, hint: 'Vertical position of the vanishing point.' },
  fov: { kind: 'slider', label: 'Perspective', min: 0.3, max: 3, step: 0.02, default: 1.15, scale: 'log' },
  spread: { kind: 'slider', label: 'Width', min: 0.5, max: 4, step: 0.05, default: 1.7 },
  render: { kind: 'select', label: 'Render', default: 'both', options: [
    { value: 'rows', label: 'Rows only' },
    { value: 'cols', label: 'Columns only' },
    { value: 'both', label: 'Full mesh' },
  ] },
  weight: { kind: 'slider', label: 'Line weight', min: 0.25, max: 3, step: 0.05, default: 1 },
  fade: { kind: 'slider', label: 'Distance fade', min: 0, max: 1, step: 0.02, default: 0.75 },
  nearColor: { kind: 'color', label: 'Near', default: { r: 0, g: 0.83, b: 1, a: 1 } },
  farColor: { kind: 'color', label: 'Far', default: { r: 0.25, g: 0.05, b: 0.4, a: 1 } },
  glow: { kind: 'slider', label: 'Glow', min: 0, max: 1, step: 0.02, default: 0.35 },
};

export default function sketch(p, get) {
  let scroll = 0;
  p.setup = () => {
    p.createCanvas(p.windowWidth, p.windowHeight);
    p.colorMode(p.RGB, 1, 1, 1, 1);
    p.noFill();
  };

  p.windowResized = () => p.resizeCanvas(p.windowWidth, p.windowHeight);

  function terrain(x, z, scale, octaves, ridged) {
    let sum = 0, amp = 0.5, freq = 1;
    for (let i = 0; i < octaves; i++) {
      let v = p.noise(x * scale * freq, z * scale * freq);
      if (ridged) v = 1 - Math.abs(v * 2 - 1);
      sum += v * amp;
      freq *= 2.03;
      amp *= 0.5;
    }
    return sum;
  }

  p.draw = () => {
    p.background(0);

    const cols = Math.floor(get('cols'));
    const rows = Math.floor(get('rows'));
    const amp = get('amplitude');
    const scale = get('noiseScale') * 0.05;
    const octaves = Math.floor(get('octaves'));
    const ridged = get('ridged');
    const horizonY = p.height * get('horizon');
    const fov = get('fov');
    const spread = get('spread');
    const mode = get('render');
    const fade = get('fade');
    const near = get('nearColor');
    const far = get('farColor');
    const glow = get('glow');

    scroll += Math.min(Math.max(p.deltaTime || 0, 0), 100) * 0.001 * get('speed');
    const t = scroll;
    const baseH = p.height * amp * 0.5;
    // Screen-space placement never changes relief or the vanishing point.
    // At zero, even the highest peaks remain visible within the lower frame.
    const position = get('height') ?? 0.5;
    const frameOffset = (0.5 - position) * p.height * 0.65;
    const projected = Array.from({ length: rows }, () => new Array(cols + 1));

    // Project a grid vertex to screen. Depth runs 0 (horizon) to 1 (viewer).
    const project = (ix, iz) => {
      const u = cols === 1 ? 0 : ix / cols - 0.5;
      const zNorm = iz / rows;
      // Non-linear depth so rows bunch up toward the horizon, which is what
      // sells the perspective without a real camera matrix.
      const depth = Math.pow(zNorm, fov);
      const y = horizonY + (p.height - horizonY) * depth;
      const widthAt = p.width * spread * depth;
      const h = terrain(ix, iz + t * 10, scale, octaves, ridged) * baseH * depth;
      return { x: p.width / 2 + u * widthAt, y: y - h + frameOffset, d: depth };
    };

    for (let iz = 1; iz <= rows; iz++) {
      for (let ix = 0; ix <= cols; ix++) projected[iz - 1][ix] = project(ix, iz);
    }

    p.strokeCap(p.ROUND);

    const strokeFor = (d) => {
      const f = 1 - d;
      const a = 1 - fade * f;
      p.stroke(p.lerp(far.r, near.r, d), p.lerp(far.g, near.g, d), p.lerp(far.b, near.b, d), Math.max(a, 0.02));
      p.strokeWeight(get('weight') * (0.4 + d * 0.9));
    };

    if (mode === 'rows' || mode === 'both') {
      for (let iz = 1; iz <= rows; iz++) {
        let prev = null;
        for (let ix = 0; ix <= cols; ix++) {
          const q = projected[iz - 1][ix];
          if (prev) { strokeFor(q.d); p.line(prev.x, prev.y, q.x, q.y); }
          prev = q;
        }
      }
    }

    if (mode === 'cols' || mode === 'both') {
      for (let ix = 0; ix <= cols; ix++) {
        let prev = null;
        for (let iz = 1; iz <= rows; iz++) {
          const q = projected[iz - 1][ix];
          if (prev) { strokeFor(q.d); p.line(prev.x, prev.y, q.x, q.y); }
          prev = q;
        }
      }
    }

    if (glow > 0) {
      // Cheap horizon bloom — a few translucent bands rather than a blur.
      p.noStroke();
      for (let i = 0; i < 4; i++) {
        p.fill(near.r, near.g, near.b, glow * 0.05);
        p.rect(0, horizonY + frameOffset - (i + 1) * 6, p.width, (i + 1) * 12);
      }
      p.noFill();
    }
  };
}
