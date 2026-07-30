/** data-glyphs — a stream of values rendered as characters, where the data
    itself determines the shape the text forms. Type becomes the plotting
    medium: the list is the image. */

export const params = {
  source: { kind: 'select', label: 'Data source', default: 'wave', options: [
    { value: 'wave', label: 'Waveform' },
    { value: 'series', label: 'Time series' },
    { value: 'spiral', label: 'Spiral index' },
    { value: 'bars', label: 'Histogram' },
    { value: 'scatter', label: 'Scatter' },
  ] },
  samples: { kind: 'slider', label: 'Samples', min: 40, max: 3000, step: 10, default: 700, scale: 'log' },
  charset: { kind: 'text', label: 'Glyph set', default: '0123456789ABCDEF', maxLength: 64, monospace: true, hint: 'Characters are chosen by each sample\u2019s value.' },
  mapMode: { kind: 'select', label: 'Glyph mapping', default: 'value', options: [
    { value: 'value', label: 'By value' },
    { value: 'index', label: 'By index' },
    { value: 'speed', label: 'By slope' },
  ] },
  textSize: { kind: 'slider', label: 'Text size', min: 4, max: 40, step: 0.5, default: 12 },
  amplitude: { kind: 'slider', label: 'Amplitude', min: 0.02, max: 0.9, step: 0.01, default: 0.32, modulatable: true },
  frequency: { kind: 'slider', label: 'Frequency', min: 0.2, max: 12, step: 0.05, default: 2.4, modulatable: true },
  harmonics: { kind: 'stepper', label: 'Harmonics', min: 1, max: 6, step: 1, default: 3 },
  speed: { kind: 'slider', label: 'Scroll speed', min: 0, max: 4, step: 0.01, default: 0.7 },
  spread: { kind: 'slider', label: 'Spread', min: 0.1, max: 1, step: 0.01, default: 0.9 },
  jitter: { kind: 'slider', label: 'Jitter', min: 0, max: 30, step: 0.5, default: 0 },
  low: { kind: 'color', label: 'Low value', default: { r: 0.2, g: 0.22, b: 0.3, a: 1 } },
  high: { kind: 'color', label: 'High value', default: { r: 0, g: 0.83, b: 1, a: 1 } },
  showAxis: { kind: 'toggle', label: 'Show baseline', default: false, advanced: true },
};

export default function sketch(p, get) {
  p.setup = () => {
    p.createCanvas(p.windowWidth, p.windowHeight);
    p.colorMode(p.RGB, 1, 1, 1, 1);
    p.textFont('monospace');
    p.textAlign(p.CENTER, p.CENTER);
    p.noStroke();
  };

  p.windowResized = () => p.resizeCanvas(p.windowWidth, p.windowHeight);

  /** The data series. Every layout reads from this one function. */
  function valueAt(i, n, t) {
    const x = i / n;
    const mode = get('source');
    const freq = get('frequency');
    const harm = Math.floor(get('harmonics'));

    if (mode === 'series') {
      let v = 0;
      for (let h = 1; h <= harm; h++) v += p.noise(x * freq * h * 2, t * 0.2 + h) / h;
      return v / harm;
    }
    if (mode === 'bars') {
      return p.noise(Math.floor(x * 40) * 0.3, t * 0.15);
    }
    if (mode === 'scatter') {
      return p.noise(i * 0.07, t * 0.25);
    }
    // Waveform / spiral share a harmonic sum.
    let v = 0;
    for (let h = 1; h <= harm; h++) {
      v += Math.sin((x * freq * h + t) * p.TWO_PI) / h;
    }
    return 0.5 + 0.5 * (v / harm);
  }

  p.draw = () => {
    p.background(0);

    const n = Math.floor(get('samples'));
    const t = p.millis() * 0.001 * get('speed');
    const chars = (get('charset') || '#').split('');
    const mode = get('source');
    const map = get('mapMode');
    const amp = get('amplitude');
    const low = get('low');
    const high = get('high');
    const spread = get('spread');
    const jit = get('jitter');

    p.textSize(get('textSize'));

    if (get('showAxis')) {
      p.fill(0.15, 0.15, 0.18, 1);
      p.rect(0, p.height / 2, p.width, 1);
    }

    for (let i = 0; i < n; i++) {
      const v = valueAt(i, n, t);
      const prev = valueAt(i - 1, n, t);
      const slope = Math.abs(v - prev) * 12;

      let x, y;
      if (mode === 'spiral') {
        const a = (i / n) * p.TWO_PI * 8 + t;
        const r = (i / n) * Math.min(p.width, p.height) * 0.45 * spread;
        x = p.width / 2 + Math.cos(a) * r * (0.7 + v * 0.6);
        y = p.height / 2 + Math.sin(a) * r * (0.7 + v * 0.6);
      } else if (mode === 'bars') {
        x = ((i / n) * p.width * spread) + p.width * (1 - spread) / 2;
        y = p.height - v * p.height * amp * 2 - 10;
      } else if (mode === 'scatter') {
        x = p.noise(i * 0.13, 1) * p.width;
        y = p.height / 2 + (v - 0.5) * p.height * amp * 2;
      } else {
        x = ((i / n) * p.width * spread) + p.width * (1 - spread) / 2;
        y = p.height / 2 + (v - 0.5) * p.height * amp * 2;
      }

      if (jit > 0) { x += (p.noise(i, t) - 0.5) * jit; y += (p.noise(i + 99, t) - 0.5) * jit; }

      // The glyph itself encodes the datum — that is the whole idea.
      let pick;
      if (map === 'index') pick = i % chars.length;
      else if (map === 'speed') pick = Math.min(Math.floor(slope * chars.length), chars.length - 1);
      else pick = Math.min(Math.floor(v * chars.length), chars.length - 1);

      p.fill(p.lerp(low.r, high.r, v), p.lerp(low.g, high.g, v), p.lerp(low.b, high.b, v),
             p.lerp(low.a, high.a, v));
      p.text(chars[Math.max(pick, 0)], x, y);
    }
  };
}
