/** type-grid — typographic lattice with per-cell weight and jitter.
    Carries the only @text control in the seed set. */

export const params = {
  text: { kind: 'text', label: 'Text', default: 'VISUAL MOOD LAB', maxLength: 64, monospace: true, hint: 'Characters are laid out cell by cell and repeat to fill the grid.' },
  font: { kind: 'font', label: 'Font', default: 'jetbrains-mono' },
  cols: { kind: 'stepper', label: 'Columns', min: 2, max: 40, step: 1, default: 12 },
  rows: { kind: 'stepper', label: 'Rows', min: 1, max: 40, step: 1, default: 8 },
  sizeRatio: { kind: 'slider', label: 'Size ratio', min: 0.2, max: 1.6, step: 0.01, default: 0.82, hint: 'Glyph size relative to its cell.' },
  tracking: { kind: 'slider', label: 'Tracking', min: -0.3, max: 0.6, step: 0.005, default: 0 },
  jitter: { kind: 'slider', label: 'Jitter', min: 0, max: 1, step: 0.01, default: 0.12, modulatable: true },
  jitterRate: { kind: 'slider', label: 'Jitter rate', min: 0, max: 3, step: 0.02, default: 0.4, showIf: { truthy: 'jitter' } },
  wave: { kind: 'slider', label: 'Wave', min: 0, max: 1, step: 0.01, default: 0.25, modulatable: true },
  baseColor: { kind: 'color', label: 'Base', default: { r: 0.27, g: 0.27, b: 0.3, a: 1 } },
  accentColor: { kind: 'color', label: 'Accent', default: { r: 0, g: 0.83, b: 1, a: 1 } },
  accentEvery: { kind: 'stepper', label: 'Accent every', min: 1, max: 24, step: 1, default: 7 },
  align: { kind: 'select', label: 'Baseline', default: 'center', options: [
    { value: 'top', label: 'Top' },
    { value: 'center', label: 'Center' },
    { value: 'baseline', label: 'Baseline' },
  ] },
  showGrid: { kind: 'toggle', label: 'Show grid', default: false, advanced: true },
};

export default function sketch(p, get) {
  p.setup = () => {
    p.createCanvas(p.windowWidth, p.windowHeight);
    p.colorMode(p.RGB, 1, 1, 1, 1);
    p.textAlign(p.CENTER, p.CENTER);
  };

  p.windowResized = () => p.resizeCanvas(p.windowWidth, p.windowHeight);

  p.draw = () => {
    p.background(0);

    const cols = Math.floor(get('cols'));
    const rows = Math.floor(get('rows'));
    const cw = p.width / cols;
    const ch = p.height / rows;
    const chars = (get('text') || ' ').split('');
    const base = get('baseColor');
    const accent = get('accentColor');
    const every = Math.max(1, Math.floor(get('accentEvery')));
    const jitter = get('jitter');
    const t = p.millis() * 0.001 * get('jitterRate');
    const wave = get('wave');

    const alignMap = { top: p.TOP, center: p.CENTER, baseline: p.BASELINE };
    p.textAlign(p.CENTER, alignMap[get('align')] ?? p.CENTER);
    p.textSize(Math.min(cw, ch) * get('sizeRatio'));
    // See type-wave.js's identical guard doc — falls back to the plain
    // 'monospace' family (this tile's original hardcoded default) rather
    // than the browser's serif/sans default, since the grid's whole
    // identity depends on a fixed-width look while nothing's loaded yet.
    const embeddedFont = typeof p.getEmbeddedFont === 'function' ? p.getEmbeddedFont(get('font')) : null;
    p.textFont(embeddedFont || 'monospace');
    p.noStroke();

    let i = 0;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++, i++) {
        const c = chars[i % chars.length];

        const jx = (p.noise(x * 0.3, y * 0.3, t) - 0.5) * cw * jitter;
        const jy = (p.noise(x * 0.3 + 50, y * 0.3 + 50, t) - 0.5) * ch * jitter;
        const wy = Math.sin(x * 0.5 + t * 2) * ch * wave * 0.3;

        const col = i % every === 0 ? accent : base;
        p.fill(col.r, col.g, col.b, col.a);

        const px = x * cw + cw / 2 + jx + x * cw * get('tracking') * 0.1;
        p.text(c, px, y * ch + ch / 2 + jy + wy);
      }
    }

    if (get('showGrid')) {
      p.stroke(0.15, 0.15, 0.17, 1);
      p.strokeWeight(1);
      for (let x = 1; x < cols; x++) p.line(x * cw, 0, x * cw, p.height);
      for (let y = 1; y < rows; y++) p.line(0, y * ch, p.width, y * ch);
    }
  };
}
