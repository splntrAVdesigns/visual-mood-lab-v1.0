/** repetition-grid — a lattice of identical marks whose phase offsets turn
    repetition into a travelling wave. */

export const params = {
  cols: { kind: 'stepper', label: 'Columns', min: 2, max: 48, step: 1, default: 16 },
  rows: { kind: 'stepper', label: 'Rows', min: 2, max: 48, step: 1, default: 10 },
  shape: { kind: 'select', label: 'Mark', default: 'bar', options: [
    { value: 'bar', label: 'Bar' },
    { value: 'circle', label: 'Circle' },
    { value: 'square', label: 'Square' },
    { value: 'cross', label: 'Cross' },
    { value: 'arc', label: 'Arc' },
  ] },
  scale: { kind: 'slider', label: 'Mark scale', min: 0.05, max: 1.4, step: 0.01, default: 0.62, modulatable: true },
  wave: { kind: 'select', label: 'Wave', default: 'diagonal', options: [
    { value: 'diagonal', label: 'Diagonal' },
    { value: 'radial', label: 'Radial' },
    { value: 'horizontal', label: 'Horizontal' },
    { value: 'noise', label: 'Noise' },
  ] },
  amount: { kind: 'slider', label: 'Wave amount', min: 0, max: 1, step: 0.01, default: 0.75, modulatable: true },
  speed: { kind: 'slider', label: 'Speed', min: 0, max: 4, step: 0.01, default: 0.9 },
  frequency: { kind: 'slider', label: 'Frequency', min: 0.2, max: 8, step: 0.05, default: 1.6 },
  rotate: { kind: 'slider', label: 'Mark rotation', min: -180, max: 180, step: 1, default: 0, unit: 'deg', modulatable: true },
  spinWithWave: { kind: 'toggle', label: 'Rotate with wave', default: true },
  colorA: { kind: 'color', label: 'Low', default: { r: 0.12, g: 0.14, b: 0.2, a: 1 } },
  colorB: { kind: 'color', label: 'High', default: { r: 0, g: 0.83, b: 1, a: 1 } },
  weight: { kind: 'slider', label: 'Stroke weight', min: 0.25, max: 8, step: 0.05, default: 1.5 },
  filled: { kind: 'toggle', label: 'Filled', default: false },
};

export default function sketch(p, get) {
  p.setup = () => {
    p.createCanvas(p.windowWidth, p.windowHeight);
    p.colorMode(p.RGB, 1, 1, 1, 1);
    p.rectMode(p.CENTER);
  };

  p.windowResized = () => p.resizeCanvas(p.windowWidth, p.windowHeight);

  p.draw = () => {
    p.background(0);

    const cols = Math.floor(get('cols'));
    const rows = Math.floor(get('rows'));
    const cw = p.width / cols;
    const ch = p.height / rows;
    const cell = Math.min(cw, ch);
    const t = p.millis() * 0.001 * get('speed');
    const freq = get('frequency');
    const amount = get('amount');
    const a = get('colorA');
    const b = get('colorB');
    const shape = get('shape');
    const mode = get('wave');
    const filled = get('filled');

    p.strokeWeight(get('weight'));

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const nx = cols === 1 ? 0 : x / (cols - 1);
        const ny = rows === 1 ? 0 : y / (rows - 1);

        let phase;
        if (mode === 'radial') {
          phase = Math.hypot(nx - 0.5, ny - 0.5) * 2;
        } else if (mode === 'horizontal') {
          phase = nx;
        } else if (mode === 'noise') {
          phase = p.noise(x * 0.25, y * 0.25, t * 0.3);
        } else {
          phase = (nx + ny) * 0.5;
        }

        // One shared wave read by every mark — repetition plus a phase
        // gradient is what turns a static grid into motion.
        const v = 0.5 + 0.5 * Math.sin((phase * freq - t) * p.TWO_PI);
        const amp = 1 - amount + amount * v;

        p.push();
        p.translate(x * cw + cw / 2, y * ch + ch / 2);
        p.rotate(p.radians(get('rotate')) + (get('spinWithWave') ? v * p.TWO_PI : 0));

        const col = {
          r: p.lerp(a.r, b.r, v), g: p.lerp(a.g, b.g, v),
          b: p.lerp(a.b, b.b, v), a: p.lerp(a.a, b.a, v),
        };
        filled ? (p.fill(col.r, col.g, col.b, col.a), p.noStroke())
               : (p.noFill(), p.stroke(col.r, col.g, col.b, col.a));

        const s = cell * get('scale') * amp;
        if (shape === 'circle') p.circle(0, 0, s);
        else if (shape === 'square') p.rect(0, 0, s, s);
        else if (shape === 'cross') { p.line(-s / 2, 0, s / 2, 0); p.line(0, -s / 2, 0, s / 2); }
        else if (shape === 'arc') p.arc(0, 0, s, s, 0, p.PI * (0.4 + v));
        else p.line(0, -s / 2, 0, s / 2);

        p.pop();
      }
    }
  };
}
