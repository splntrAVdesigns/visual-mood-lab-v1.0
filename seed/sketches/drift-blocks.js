/**
 * drift-blocks — flat shapes at varied depth easing between grid positions.
 *
 * Ports the visual logic from the board's own hero background into a real,
 * independently tunable asset. The hero decoration itself is deliberately
 * left untouched: it lives outside the renderer pool so it never competes
 * for the live-renderer budget (1–3 slots depending on device), and wiring
 * it into the shared pipeline would spend one of those slots on chrome
 * rather than on an asset the person actually chose to watch. This is a
 * sibling with the same DNA, not a rehoming.
 *
 * The easing is what makes this read as intentional rather than random: a
 * cubic ease in and out on each shape's journey, with per-shape durations,
 * so nothing ever travels at a constant mechanical rate and the field never
 * pulses in unison.
 */

export const params = {
  count: { kind: 'slider', label: 'Shapes', min: 4, max: 160, step: 2, default: 26, scale: 'log' },
  shape: { kind: 'select', label: 'Shape', default: 'square', options: [
    { value: 'square', label: 'Square' },
    { value: 'circle', label: 'Circle' },
    { value: 'triangle', label: 'Triangle' },
    { value: 'hexagon', label: 'Hexagon' },
    { value: 'octagon', label: 'Octagon' },
  ] },
  grid: { kind: 'stepper', label: 'Grid divisions', min: 2, max: 24, step: 1, default: 8, hint: 'Shapes ease between positions on this grid.' },
  sizeMin: { kind: 'slider', label: 'Min size', min: 0.05, max: 1.2, step: 0.01, default: 0.35, modulatable: true },
  sizeMax: { kind: 'slider', label: 'Max size', min: 0.1, max: 2.5, step: 0.01, default: 0.85, modulatable: true },
  speed: { kind: 'slider', label: 'Drift speed', min: 0.1, max: 4, step: 0.05, default: 1, modulatable: true, hint: 'Multiplies each shape\u2019s own travel duration.' },
  depthRange: { kind: 'slider', label: 'Depth spread', min: 0, max: 1, step: 0.02, default: 0.7, hint: 'How much size and opacity vary with a shape\u2019s depth.' },
  opacityBase: { kind: 'slider', label: 'Base opacity', min: 0.02, max: 1, step: 0.02, default: 0.25, modulatable: true },
  opacityDepth: { kind: 'slider', label: 'Depth opacity', min: 0, max: 1, step: 0.02, default: 0.5 },
  rotation: { kind: 'slider', label: 'Rotation', min: -180, max: 180, step: 1, default: 0, unit: 'deg' },
  spin: { kind: 'slider', label: 'Spin', min: -2, max: 2, step: 0.01, default: 0, modulatable: true },
  jitter: { kind: 'slider', label: 'Position jitter', min: 0, max: 1, step: 0.02, default: 0, hint: 'Random offset from the exact grid cell.' },
  accentEvery: { kind: 'stepper', label: 'Accent every', min: 0, max: 30, step: 1, default: 14, hint: 'Every Nth shape uses the accent colour. Zero disables it.' },
  toneA: { kind: 'color', label: 'Tone A', default: { r: 0.086, g: 0.086, b: 0.102, a: 1 } },
  toneB: { kind: 'color', label: 'Tone B', default: { r: 0.208, g: 0.208, b: 0.227, a: 1 } },
  accent: { kind: 'color', label: 'Accent', default: { r: 0, g: 0.83, b: 1, a: 1 } },
  bg: { kind: 'color', label: 'Background', default: { r: 0, g: 0, b: 0, a: 1 } },
  trail: { kind: 'slider', label: 'Trail', min: 0, max: 0.95, step: 0.01, default: 0 },
  reseed: { kind: 'trigger', label: 'Reseed', default: null, event: 'reseed', advanced: true, midi: false },
};

export default function sketch(p, get) {
  let blocks = [];
  let builtFor = '';

  function cellPos(gx, gy, divisions) {
    return { x: (gx / divisions) * p.width, y: (gy / divisions) * p.height };
  }

  function retarget(b, divisions, initial) {
    const divs = Math.max(2, divisions);
    const gx = Math.floor(Math.random() * divs);
    const gy = Math.floor(Math.random() * divs);
    const pos = cellPos(gx, gy, divs);

    if (initial) { b.x = pos.x; b.y = pos.y; }
    else { b.x = b.targetX; b.y = b.targetY; }

    b.targetX = pos.x;
    b.targetY = pos.y;
    b.progress = initial ? 1 : 0;
    b.duration = 4000 + Math.random() * 6000;
  }

  function build() {
    const n = Math.floor(get('count'));
    const divs = Math.floor(get('grid'));
    blocks = new Array(n).fill(null).map((_, i) => {
      const b = {
        x: 0, y: 0, targetX: 0, targetY: 0,
        progress: 1,
        duration: 4000,
        depth: 0.3 + Math.random() * 0.7,
        tone: Math.random(),
        jx: Math.random() - 0.5,
        jy: Math.random() - 0.5,
        index: i,
      };
      retarget(b, divs, true);
      // Stagger initial progress so they don't all arrive together.
      b.progress = Math.random();
      return b;
    });
  }

  function drawShape(kind, x, y, size) {
    if (kind === 'circle') { p.circle(x, y, size); return; }
    if (kind === 'triangle') {
      const h = size * 0.866;
      p.triangle(x, y - h / 2, x - size / 2, y + h / 2, x + size / 2, y + h / 2);
      return;
    }
    if (kind === 'hexagon' || kind === 'octagon') {
      const sides = kind === 'hexagon' ? 6 : 8;
      const r = size / 2;
      p.beginShape();
      for (let i = 0; i < sides; i++) {
        const a = (i / sides) * p.TWO_PI - p.HALF_PI;
        p.vertex(x + Math.cos(a) * r, y + Math.sin(a) * r);
      }
      p.endShape(p.CLOSE);
      return;
    }
    p.rect(x - size / 2, y - size / 2, size, size);
  }

  p.setup = () => {
    p.createCanvas(p.windowWidth, p.windowHeight);
    p.colorMode(p.RGB, 1, 1, 1, 1);
    p.noStroke();
    build();
    builtFor = `${get('count')}:${get('grid')}`;
  };

  p.windowResized = () => { p.resizeCanvas(p.windowWidth, p.windowHeight); build(); };
  p.onEvent = (name) => { if (name === 'reseed') build(); };

  p.draw = () => {
    const key = `${get('count')}:${get('grid')}`;
    if (key !== builtFor) { build(); builtFor = key; }

    const bg = get('bg');
    const trail = get('trail');
    if (trail > 0) { p.fill(bg.r, bg.g, bg.b, 1 - trail); p.rect(0, 0, p.width, p.height); }
    else p.background(bg.r, bg.g, bg.b, bg.a);

    const dt = Math.min(p.deltaTime || 16, 60);
    const divs = Math.floor(get('grid'));
    const kind = get('shape');
    const sizeMin = get('sizeMin');
    const sizeMax = get('sizeMax');
    const speed = get('speed');
    const depthRange = get('depthRange');
    const opBase = get('opacityBase');
    const opDepth = get('opacityDepth');
    const rot = p.radians(get('rotation'));
    const spin = get('spin');
    const jitter = get('jitter');
    const accentEvery = Math.floor(get('accentEvery'));
    const toneA = get('toneA');
    const toneB = get('toneB');
    const accent = get('accent');

    const cellSize = p.width / Math.max(2, divs);
    const t = p.millis() * 0.001;

    for (const b of blocks) {
      b.progress = Math.min(1, b.progress + (dt / b.duration) * speed);

      // Cubic ease in/out — the reason drift reads as considered rather
      // than mechanical.
      const e = b.progress < 0.5
        ? 2 * b.progress * b.progress
        : 1 - Math.pow(-2 * b.progress + 2, 2) / 2;

      let x = b.x + (b.targetX - b.x) * e;
      let y = b.y + (b.targetY - b.y) * e;

      if (jitter > 0) {
        x += b.jx * jitter * cellSize;
        y += b.jy * jitter * cellSize;
      }

      const depthMix = 1 - depthRange + depthRange * b.depth;
      const size = cellSize * (sizeMin + (sizeMax - sizeMin) * depthMix);
      const alpha = Math.min(1, opBase + opDepth * b.depth);

      const useAccent = accentEvery > 0 && b.index % accentEvery === 0;
      const col = useAccent ? accent : { r: p.lerp(toneA.r, toneB.r, b.tone), g: p.lerp(toneA.g, toneB.g, b.tone), b: p.lerp(toneA.b, toneB.b, b.tone) };

      p.fill(col.r, col.g, col.b, alpha);

      if (rot !== 0 || spin !== 0) {
        p.push();
        p.translate(x, y);
        p.rotate(rot + t * spin);
        drawShape(kind, 0, 0, size);
        p.pop();
      } else {
        drawShape(kind, x, y, size);
      }

      if (b.progress >= 1) retarget(b, divs, false);
    }
  };
}
