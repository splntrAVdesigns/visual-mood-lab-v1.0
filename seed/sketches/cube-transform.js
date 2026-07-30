/** cube-transform — 3D cube with orbit controls, live transforms and
    full animation control. Drag to orbit, scroll to zoom. */

export const params = {
  count: { kind: 'stepper', label: 'Cubes', min: 1, max: 64, step: 1, default: 1 },
  size: { kind: 'slider', label: 'Size', min: 0.05, max: 0.6, step: 0.005, default: 0.22, modulatable: true },
  arrangement: { kind: 'select', label: 'Arrangement', default: 'single', options: [
    { value: 'single', label: 'Single' },
    { value: 'ring', label: 'Ring' },
    { value: 'grid', label: 'Grid' },
    { value: 'helix', label: 'Helix' },
  ] },
  radius: { kind: 'slider', label: 'Spread radius', min: 0, max: 1, step: 0.01, default: 0.4, showIf: { notEquals: ['arrangement', 'single'] } },
  spinX: { kind: 'slider', label: 'Spin X', min: -2, max: 2, step: 0.01, default: 0.18, modulatable: true },
  spinY: { kind: 'slider', label: 'Spin Y', min: -2, max: 2, step: 0.01, default: 0.3, modulatable: true },
  spinZ: { kind: 'slider', label: 'Spin Z', min: -2, max: 2, step: 0.01, default: 0 },
  stagger: { kind: 'slider', label: 'Spin stagger', min: 0, max: 1, step: 0.01, default: 0.25, hint: 'Offsets each cube\u2019s rotation phase.' },
  breathe: { kind: 'slider', label: 'Breathe', min: 0, max: 1, step: 0.01, default: 0.15, modulatable: true },
  breatheRate: { kind: 'slider', label: 'Breathe rate', min: 0.05, max: 3, step: 0.05, default: 0.6, showIf: { truthy: 'breathe' } },
  render: { kind: 'select', label: 'Render', default: 'wire', options: [
    { value: 'wire', label: 'Wireframe' },
    { value: 'solid', label: 'Solid' },
    { value: 'both', label: 'Solid + edges' },
  ] },
  weight: { kind: 'slider', label: 'Edge weight', min: 0.25, max: 5, step: 0.05, default: 1 },
  stroke: { kind: 'color', label: 'Edges', default: { r: 0, g: 0.83, b: 1, a: 1 } },
  fillColor: { kind: 'color', label: 'Faces', default: { r: 0.04, g: 0.05, b: 0.08, a: 1 } },
  lightAngle: { kind: 'slider', label: 'Light angle', min: -180, max: 180, step: 1, default: 40, unit: 'deg' },
  interactive: { kind: 'toggle', label: 'Drag to orbit', default: true },
  reset: { kind: 'trigger', label: 'Reset view', default: null, event: 'reset' },
};

export default function sketch(p, get) {
  let resetAt = 0;

  p.setup = () => {
    p.createCanvas(p.windowWidth, p.windowHeight, p.WEBGL);
    p.colorMode(p.RGB, 1, 1, 1, 1);
  };

  p.windowResized = () => p.resizeCanvas(p.windowWidth, p.windowHeight);
  p.onEvent = (name) => { if (name === 'reset') resetAt = p.millis(); };

  p.draw = () => {
    p.background(0);
    if (get('interactive')) p.orbitControl(1, 1, 0.1);

    const t = (p.millis() - resetAt) * 0.001;
    const n = Math.floor(get('count'));
    const mode = get('render');
    const st = get('stroke');
    const fl = get('fillColor');
    const base = Math.min(p.width, p.height);
    const R = base * get('radius');
    const breathe = 1 + Math.sin(t * get('breatheRate') * 6.28) * get('breathe');
    const size = base * get('size') * breathe;
    const stagger = get('stagger');

    if (mode !== 'wire') {
      const a = p.radians(get('lightAngle'));
      p.ambientLight(0.15);
      p.directionalLight(st.r, st.g, st.b, Math.cos(a), Math.sin(a), -0.7);
    }

    for (let i = 0; i < n; i++) {
      const f = n === 1 ? 0 : i / n;
      p.push();

      const arr = get('arrangement');
      if (arr === 'ring') {
        p.translate(Math.cos(f * p.TWO_PI) * R, Math.sin(f * p.TWO_PI) * R, 0);
      } else if (arr === 'grid') {
        const side = Math.ceil(Math.sqrt(n));
        const gx = (i % side) - (side - 1) / 2;
        const gy = Math.floor(i / side) - (side - 1) / 2;
        p.translate(gx * R * 0.9, gy * R * 0.9, 0);
      } else if (arr === 'helix') {
        p.translate(Math.cos(f * p.TWO_PI * 2) * R, (f - 0.5) * R * 2.4, Math.sin(f * p.TWO_PI * 2) * R);
      }

      const phase = f * stagger * p.TWO_PI;
      p.rotateX(t * get('spinX') + phase);
      p.rotateY(t * get('spinY') + phase);
      p.rotateZ(t * get('spinZ') + phase);

      if (mode === 'solid' || mode === 'both') {
        p.fill(fl.r, fl.g, fl.b, fl.a);
        mode === 'both' ? p.stroke(st.r, st.g, st.b, st.a) : p.noStroke();
        if (mode === 'both') p.strokeWeight(get('weight'));
      } else {
        p.noFill();
        p.stroke(st.r, st.g, st.b, st.a);
        p.strokeWeight(get('weight'));
      }

      p.box(size);
      p.pop();
    }
  };
}
