/** harmonograph — damped Lissajous plotter. Four pendulums, two axes. */

export const params = {
  samples: { kind: 'slider', label: 'Samples', min: 500, max: 40000, step: 100, default: 12000, scale: 'log' },
  freqX1: { kind: 'slider', label: 'Freq X1', min: 0.5, max: 8, step: 0.001, default: 2, modulatable: true },
  freqY1: { kind: 'slider', label: 'Freq Y1', min: 0.5, max: 8, step: 0.001, default: 3, modulatable: true },
  freqX2: { kind: 'slider', label: 'Freq X2', min: 0.5, max: 8, step: 0.001, default: 2.005, advanced: true },
  freqY2: { kind: 'slider', label: 'Freq Y2', min: 0.5, max: 8, step: 0.001, default: 3.003, advanced: true },
  phase: { kind: 'slider', label: 'Phase', min: 0, max: 6.283, step: 0.001, default: 1.57, modulatable: true },
  damping: { kind: 'slider', label: 'Damping', min: 0, max: 0.01, step: 0.00005, default: 0.0022 },
  amplitude: { kind: 'slider', label: 'Amplitude', min: 0.1, max: 0.9, step: 0.005, default: 0.4 },
  drift: { kind: 'slider', label: 'Drift', min: 0, max: 0.5, step: 0.001, default: 0.02, hint: 'Slowly detunes the second pendulum pair.' },
  weight: { kind: 'slider', label: 'Stroke weight', min: 0.2, max: 3, step: 0.05, default: 0.6 },
  alpha: { kind: 'slider', label: 'Alpha', min: 0.02, max: 1, step: 0.01, default: 0.35 },
  stroke: { kind: 'color', label: 'Stroke', default: { r: 0, g: 0.83, b: 1, a: 1 } },
};

export default function sketch(p, get) {
  p.setup = () => {
    p.createCanvas(p.windowWidth, p.windowHeight);
    p.colorMode(p.RGB, 1, 1, 1, 1);
  };

  p.windowResized = () => p.resizeCanvas(p.windowWidth, p.windowHeight);

  p.draw = () => {
    p.background(0);

    const n = Math.floor(get('samples'));
    const d = get('damping');
    const amp = Math.min(p.width, p.height) * get('amplitude');
    const ph = get('phase');
    const drift = get('drift') * p.millis() * 0.0002;

    const fx1 = get('freqX1');
    const fy1 = get('freqY1');
    const fx2 = get('freqX2') + drift;
    const fy2 = get('freqY2') + drift;

    const c = get('stroke');
    p.stroke(c.r, c.g, c.b, c.a * get('alpha'));
    p.strokeWeight(get('weight'));
    p.noFill();

    p.push();
    p.translate(p.width / 2, p.height / 2);
    p.beginShape();
    for (let i = 0; i < n; i++) {
      const t = i * 0.01;
      const decay1 = Math.exp(-d * i);
      const decay2 = Math.exp(-d * 0.8 * i);
      const x = amp * (Math.sin(t * fx1 + ph) * decay1 + Math.sin(t * fx2) * decay2) * 0.5;
      const y = amp * (Math.sin(t * fy1) * decay1 + Math.sin(t * fy2 + ph) * decay2) * 0.5;
      p.vertex(x, y);
    }
    p.endShape();
    p.pop();
  };
}
