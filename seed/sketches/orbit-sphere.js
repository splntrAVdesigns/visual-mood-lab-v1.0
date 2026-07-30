/** orbit-sphere — WEBGL sphere with orbitControl(). Drag to rotate, scroll to zoom. */

export const params = {
  detail: { kind: 'stepper', label: 'Mesh detail', min: 3, max: 48, step: 1, default: 22 },
  radius: { kind: 'slider', label: 'Radius', min: 0.1, max: 0.6, step: 0.005, default: 0.28, hint: 'Fraction of the shorter viewport edge.' },
  displace: { kind: 'slider', label: 'Displacement', min: 0, max: 0.5, step: 0.005, default: 0.1, modulatable: true },
  noiseScale: { kind: 'slider', label: 'Noise scale', min: 0.2, max: 8, step: 0.05, default: 1.6, scale: 'log' },
  evolve: { kind: 'slider', label: 'Evolve', min: 0, max: 2, step: 0.01, default: 0.35 },
  spin: { kind: 'slider', label: 'Auto spin', min: -1, max: 1, step: 0.005, default: 0.12 },
  render: { kind: 'select', label: 'Render', default: 'wire', options: [
    { value: 'wire', label: 'Wireframe' },
    { value: 'solid', label: 'Solid' },
    { value: 'points', label: 'Points' },
  ] },
  weight: { kind: 'slider', label: 'Stroke weight', min: 0.25, max: 4, step: 0.05, default: 0.8 },
  stroke: { kind: 'color', label: 'Stroke', default: { r: 0, g: 0.83, b: 1, a: 1 } },
  fillColor: { kind: 'color', label: 'Fill', default: { r: 0.06, g: 0.06, b: 0.09, a: 1 }, showIf: { equals: ['render', 'solid'] } },
  lightAngle: { kind: 'slider', label: 'Light angle', min: -180, max: 180, step: 1, default: 45, unit: 'deg', showIf: { equals: ['render', 'solid'] } },
};

export default function sketch(p, get) {
  p.setup = () => {
    p.createCanvas(p.windowWidth, p.windowHeight, p.WEBGL);
    p.colorMode(p.RGB, 1, 1, 1, 1);
  };

  p.windowResized = () => p.resizeCanvas(p.windowWidth, p.windowHeight);

  p.draw = () => {
    p.background(0);
    p.orbitControl(1, 1, 0.1);
    p.rotateY(p.millis() * 0.0005 * get('spin') * 6.28);

    const mode = get('render');
    const st = get('stroke');
    const r = Math.min(p.width, p.height) * get('radius');
    const detail = Math.floor(get('detail'));
    const disp = get('displace');
    const ns = get('noiseScale');
    const t = p.millis() * 0.0005 * get('evolve');

    if (mode === 'solid') {
      const f = get('fillColor');
      p.fill(f.r, f.g, f.b, f.a);
      p.noStroke();
      const a = p.radians(get('lightAngle'));
      p.ambientLight(0.12);
      p.directionalLight(st.r, st.g, st.b, Math.cos(a), Math.sin(a), -0.6);
    } else {
      p.noFill();
      p.stroke(st.r, st.g, st.b, st.a);
      p.strokeWeight(get('weight'));
    }

    // Build the sphere by hand rather than using sphere(), so vertices can be
    // displaced by noise — the whole point of the sketch.
    for (let i = 0; i < detail; i++) {
      const lat0 = p.map(i, 0, detail, 0, Math.PI);
      const lat1 = p.map(i + 1, 0, detail, 0, Math.PI);

      p.beginShape(mode === 'points' ? p.POINTS : p.TRIANGLE_STRIP);
      for (let j = 0; j <= detail * 2; j++) {
        const lon = p.map(j, 0, detail * 2, 0, Math.PI * 2);
        vertexAt(lat0, lon);
        if (mode !== 'points') vertexAt(lat1, lon);
      }
      p.endShape();
    }

    function vertexAt(lat, lon) {
      const x = Math.sin(lat) * Math.cos(lon);
      const y = Math.cos(lat);
      const z = Math.sin(lat) * Math.sin(lon);
      const n = p.noise(x * ns + 10, y * ns + 20, z * ns + t);
      const rr = r * (1 + (n - 0.5) * disp * 2);
      p.vertex(x * rr, y * rr, z * rr);
    }
  };
}
