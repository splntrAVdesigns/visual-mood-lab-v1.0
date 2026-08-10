/**
 * transform-shape — five 3D primitives (cube, sphere, torus, cone,
 * cylinder) with orbit controls, arrangement, and a motion echo trail.
 *
 * Rework note: this was "Cube Transform" — one shape, breathing on by
 * default even when the person just wanted a still reference, and no trail
 * option despite Particle Cube next to it in the library proving the trail
 * technique works well here. Renamed in spirit if not in file: same slug,
 * so existing param tuning on this asset carries forward rather than
 * orphaning a row.
 */

export const params = {
  shape: { kind: 'select', label: 'Shape', default: 'cube', options: [
    { value: 'cube', label: 'Cube' },
    { value: 'sphere', label: 'Sphere' },
    { value: 'torus', label: 'Torus' },
    { value: 'cone', label: 'Cone' },
    { value: 'cylinder', label: 'Cylinder' },
  ] },
  count: { kind: 'stepper', label: 'Count', min: 1, max: 64, step: 1, default: 1 },
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
  stagger: { kind: 'slider', label: 'Spin stagger', min: 0, max: 1, step: 0.01, default: 0.25, hint: 'Offsets each shape\u2019s rotation phase.' },
  breathe: { kind: 'slider', label: 'Breathe', min: 0, max: 1, step: 0.01, default: 0, modulatable: true, hint: 'Zero by default — a still shape is often what you actually want a reference form to be.' },
  breatheRate: { kind: 'slider', label: 'Breathe rate', min: 0.05, max: 3, step: 0.05, default: 0.6, showIf: { truthy: 'breathe' } },
  trail: { kind: 'slider', label: 'Motion trail', min: 0, max: 0.95, step: 0.01, default: 0, hint: 'Echoes past frames instead of clearing — most visible with spin or breathe active.' },
  render: { kind: 'select', label: 'Render', default: 'wire', options: [
    { value: 'wire', label: 'Wireframe' },
    { value: 'solid', label: 'Solid' },
    { value: 'both', label: 'Solid + edges' },
  ] },
  weight: { kind: 'slider', label: 'Edge weight', min: 0.25, max: 5, step: 0.05, default: 1 },
  detail: { kind: 'stepper', label: 'Detail', min: 3, max: 48, step: 1, default: 24, hint: 'Segments for sphere / torus / cone / cylinder. No effect on cube.', showIf: { notEquals: ['shape', 'cube'] } },
  stroke: { kind: 'color', label: 'Edges', default: { r: 0, g: 0.83, b: 1, a: 1 } },
  // Was near-black (0.04, 0.05, 0.08) with only 0.15 ambient light — against
  // this app's pure-black canvas background, that rendered Solid mode
  // effectively invisible rather than broken. A dim slate blue (0.12, 0.15,
  // 0.22) fixed the visibility problem but still read as flat and safe next
  // to the cyan wireframe default — switching to Solid barely registered as
  // a different mode. Coral sits opposite cyan on the wheel, so the two
  // render modes now read as genuinely distinct looks rather than one dim
  // variant of the other.
  fillColor: { kind: 'color', label: 'Faces', default: { r: 1, g: 0.5, b: 0.31, a: 1 } },
  lightAngle: { kind: 'slider', label: 'Light angle', min: -180, max: 180, step: 1, default: 40, unit: 'deg' },
  interactive: { kind: 'toggle', label: 'Drag to orbit', default: true },
  reset: { kind: 'trigger', label: 'Reset view', default: null, event: 'reset' },
};

export default function sketch(p, get) {
  let resetAt = 0;

  p.setup = () => {
    p.createCanvas(p.windowWidth, p.windowHeight, p.WEBGL);
    p.colorMode(p.RGB, 1, 1, 1, 1);
    p.background(0);
  };

  p.windowResized = () => { p.resizeCanvas(p.windowWidth, p.windowHeight); p.background(0); };
  p.onEvent = (name) => { if (name === 'reset') { resetAt = p.millis(); p.background(0); } };

  function drawShape(shape, size, detail) {
    if (shape === 'sphere') return p.sphere(size / 2, detail, detail);
    if (shape === 'torus') return p.torus(size * 0.4, size * 0.18, detail, Math.max(6, Math.floor(detail / 2)));
    if (shape === 'cone') return p.cone(size / 2, size, detail, 1);
    if (shape === 'cylinder') return p.cylinder(size / 2, size, detail, 1);
    return p.box(size);
  }

  p.draw = () => {
    const trail = get('trail');

    if (trail > 0) {
      // Trail in WEBGL mode: draw a translucent screen-space quad BEFORE the
      // camera transform, same technique Particle Cube already uses. This is
      // what makes motion echo rather than repaint from a blank frame.
      p.push();
      p.resetMatrix();
      p.noStroke();
      p.fill(0, 0, 0, 1 - trail);
      p.translate(0, 0, -1);
      p.plane(p.width * 2, p.height * 2);
      p.pop();
    } else {
      p.background(0);
    }

    if (get('interactive')) p.orbitControl(1, 1, 0.1);

    const t = (p.millis() - resetAt) * 0.001;
    const n = Math.floor(get('count'));
    const mode = get('render');
    const shape = get('shape');
    const detail = Math.floor(get('detail'));
    const st = get('stroke');
    const fl = get('fillColor');
    const base = Math.min(p.width, p.height);
    const R = base * get('radius');
    const breathe = 1 + Math.sin(t * get('breatheRate') * 6.28) * get('breathe');
    // Safety margin against the rotated silhouette exceeding the frame.
    // `size` bounds the shape only in its own rest orientation — a
    // cylinder or cone has real extent along its height axis, and once
    // spinX/spinY carries that axis toward the camera-facing plane, the
    // shape's on-screen silhouette is measurably larger than `size`
    // itself. 0.82 keeps the worst-case rotated diagonal inside frame at
    // the slider's default and through most of its range without visibly
    // shrinking the shape at rest.
    const size = base * get('size') * breathe * 0.82;
    const stagger = get('stagger');

    if (mode !== 'wire') {
      const a = p.radians(get('lightAngle'));
      // Raised from 0.15 — paired with the darker original fill default,
      // ambient this dim left faces reading as flat black regardless of
      // fill colour.
      p.ambientLight(0.28);
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

      drawShape(shape, size, detail);
      p.pop();
    }
  };
}
