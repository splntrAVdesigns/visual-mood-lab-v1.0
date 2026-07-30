/** repetition-radial — concentric rings of repeated marks, each ring
    rotating at its own rate so the whole forms a slow mechanical bloom. */

export const params = {
  rings: { kind: 'stepper', label: 'Rings', min: 1, max: 24, step: 1, default: 9 },
  perRing: { kind: 'stepper', label: 'Marks per ring', min: 3, max: 60, step: 1, default: 18 },
  growth: { kind: 'slider', label: 'Ring growth', min: 0.2, max: 2, step: 0.01, default: 1, hint: 'Above 1 spaces outer rings further apart.' },
  radius: { kind: 'slider', label: 'Outer radius', min: 0.1, max: 0.65, step: 0.005, default: 0.42 },
  scaleByRing: { kind: 'slider', label: 'Mark falloff', min: -1, max: 1, step: 0.01, default: 0.35, hint: 'Negative grows marks outward.' },
  markScale: { kind: 'slider', label: 'Mark scale', min: 0.05, max: 2, step: 0.01, default: 0.6, modulatable: true },
  shape: { kind: 'select', label: 'Mark', default: 'line', options: [
    { value: 'line', label: 'Line' },
    { value: 'circle', label: 'Circle' },
    { value: 'square', label: 'Square' },
    { value: 'triangle', label: 'Triangle' },
  ] },
  spin: { kind: 'slider', label: 'Base spin', min: -2, max: 2, step: 0.01, default: 0.12, modulatable: true },
  differential: { kind: 'slider', label: 'Ring differential', min: -2, max: 2, step: 0.01, default: 0.55, hint: 'How much faster each ring turns than the last.' },
  pulse: { kind: 'slider', label: 'Pulse', min: 0, max: 1, step: 0.01, default: 0.3, modulatable: true },
  pulseRate: { kind: 'slider', label: 'Pulse rate', min: 0.05, max: 4, step: 0.05, default: 0.7, showIf: { truthy: 'pulse' } },
  faceCenter: { kind: 'toggle', label: 'Marks face centre', default: true },
  inner: { kind: 'color', label: 'Inner', default: { r: 0, g: 0.83, b: 1, a: 1 } },
  outer: { kind: 'color', label: 'Outer', default: { r: 0.3, g: 0.1, b: 0.6, a: 1 } },
  weight: { kind: 'slider', label: 'Stroke weight', min: 0.25, max: 6, step: 0.05, default: 1.2 },
};

export default function sketch(p, get) {
  p.setup = () => {
    p.createCanvas(p.windowWidth, p.windowHeight);
    p.colorMode(p.RGB, 1, 1, 1, 1);
    p.rectMode(p.CENTER);
    p.noFill();
  };

  p.windowResized = () => p.resizeCanvas(p.windowWidth, p.windowHeight);

  p.draw = () => {
    p.background(0);

    const rings = Math.floor(get('rings'));
    const per = Math.floor(get('perRing'));
    const t = p.millis() * 0.001;
    const R = Math.min(p.width, p.height) * get('radius');
    const inner = get('inner');
    const outer = get('outer');
    const shape = get('shape');
    const growth = get('growth');
    const pulse = get('pulse');
    const pulseRate = get('pulseRate');

    p.strokeWeight(get('weight'));
    p.push();
    p.translate(p.width / 2, p.height / 2);

    for (let r = 0; r < rings; r++) {
      const f = rings === 1 ? 0 : r / (rings - 1);
      const ringR = R * Math.pow((r + 1) / rings, growth);

      // Each ring turns at its own rate — the differential is what makes
      // repetition read as a mechanism rather than a static mandala.
      const rot = t * (get('spin') + f * get('differential'));
      const beat = 1 + Math.sin(t * pulseRate * 6.28 - f * 3) * pulse * 0.4;

      const col = {
        r: p.lerp(inner.r, outer.r, f), g: p.lerp(inner.g, outer.g, f),
        b: p.lerp(inner.b, outer.b, f), a: p.lerp(inner.a, outer.a, f),
      };
      p.stroke(col.r, col.g, col.b, col.a);

      const falloff = 1 - get('scaleByRing') * f;
      const s = (R / rings) * get('markScale') * falloff * beat;

      for (let i = 0; i < per; i++) {
        const a = (i / per) * p.TWO_PI + rot;
        p.push();
        p.translate(Math.cos(a) * ringR, Math.sin(a) * ringR);
        if (get('faceCenter')) p.rotate(a + p.HALF_PI);

        if (shape === 'circle') p.circle(0, 0, Math.abs(s));
        else if (shape === 'square') p.rect(0, 0, Math.abs(s), Math.abs(s));
        else if (shape === 'triangle') p.triangle(0, -s / 2, s / 2, s / 2, -s / 2, s / 2);
        else p.line(0, -s / 2, 0, s / 2);

        p.pop();
      }
    }
    p.pop();
  };
}
