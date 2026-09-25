/**
 * dot-scatter — block-letter typography built from marks that scatter and
 * reassemble under the pointer.
 *
 * Ported from a supplied "Dot Scatter" component that rendered SVG rects
 * driven by framer-motion springs and a per-mark brownian-motion "leash"
 * once scattered. Neither framer-motion nor SVG is available inside this
 * app's sandboxed p5 iframe — only p5 itself is vendored in — so both are
 * replaced with plain per-frame physics: a simple critically-damped spring
 * integrator standing in for framer-motion's animate(), and the same
 * leashed-random-walk idea for the scattered state, hand-rolled instead of
 * riding on useAnimationFrame.
 *
 * The glyph mark data and layout math (generateTextTargets) are pure
 * geometry with no DOM dependency, so those port over almost unchanged.
 * Word-hit-testing needed the pointer position, which turned out to be the
 * easy part here: unlike the shared, board-wide pointer GLSL shaders read,
 * a p5 sketch runs in its own iframe and gets real mouseX/mouseY local to
 * itself, so "is the pointer over this card" is a plain bounds check —
 * no idle-detection problem to work around this time.
 */

const CELL = 13, DOT = 9, GLYPH_H = 132;

const mk = (x, y, w = DOT, h = DOT) => ({ x, y, w, h });
const gl = (marks) => ({ w: Math.max(...marks.map((m) => m.x + m.w), CELL), marks });

const GLYPHS = {
  ' ': { w: CELL * 2, marks: [] },
  a: gl([mk(10,27,28,9),mk(0,41,10,9),mk(38,41,10,9),mk(29,54,18,9),mk(38,67,9,10),mk(10,68,19,9),mk(0,81,10,10),mk(38,81,9,10),mk(9,95,29,9),mk(47,95,10,9)]),
  b: gl([mk(0,0,9,9),mk(0,13,9,10),mk(0,27,9,10),mk(19,27,28,9),mk(0,41,19,9),mk(47,41,10,9),mk(0,54,9,10),mk(47,54,10,10),mk(0,68,9,9),mk(47,68,10,9),mk(0,81,19,10),mk(47,81,10,10),mk(0,95,9,9),mk(19,95,28,9)]),
  c: gl([mk(10,27,28,9),mk(0,41,9,9),mk(38,41,9,9),mk(0,54,9,9),mk(0,68,9,9),mk(0,81,9,10),mk(38,81,9,10),mk(10,95,27,9)]),
  d: gl([mk(48,0,9,9),mk(48,13,9,10),mk(48,27,9,10),mk(10,27,28,9),mk(38,41,19,9),mk(0,41,10,9),mk(48,54,9,10),mk(0,54,10,10),mk(48,68,9,9),mk(0,68,10,9),mk(38,81,19,10),mk(0,81,10,10),mk(48,95,9,9),mk(10,95,28,9)]),
  e: gl([mk(9,27,38,9),mk(0,41,9,9),mk(47,41,10,9),mk(0,54,56,9),mk(0,68,9,9),mk(0,81,9,10),mk(47,81,10,10),mk(10,95,37,9)]),
  f: gl([mk(10,0,28,9),mk(0,13,9,9),mk(0,27,9,9),mk(10,27,38,9),mk(0,41,9,9),mk(0,54,38,9),mk(0,67,9,9),mk(0,81,9,9),mk(0,95,9,9)]),
  g: gl([mk(10,27,38,9),mk(0,41,9,9),mk(48,41,9,9),mk(0,54,9,9),mk(48,54,9,9),mk(0,67,9,9),mk(48,67,9,9),mk(10,81,38,9),mk(48,95,9,9),mk(48,108,9,9),mk(20,122,28,9)]),
  h: gl([mk(0,0,9,9),mk(0,13,9,9),mk(0,27,9,9),mk(19,27,28,9),mk(0,41,9,9),mk(47,41,9,9),mk(0,54,9,9),mk(47,54,9,9),mk(0,67,9,9),mk(47,67,9,9),mk(0,81,9,9),mk(47,81,9,9),mk(0,95,9,9),mk(47,95,9,9)]),
  i: gl([mk(0,0,19,9),mk(0,27,19,9),mk(10,41,9,9),mk(10,54,9,9),mk(10,67,9,10),mk(10,81,9,10),mk(10,95,9,9)]),
  j: gl([mk(0,0,19,9),mk(0,27,19,9),mk(10,41,9,9),mk(10,54,9,9),mk(10,67,9,10),mk(10,81,9,10),mk(10,95,9,9),mk(0,108,9,9),mk(0,122,19,9)]),
  k: gl([mk(0,0,9,9),mk(0,13,9,9),mk(0,27,9,9),mk(0,41,9,9),mk(0,54,9,9),mk(0,67,9,9),mk(0,81,9,9),mk(0,95,9,9),mk(38,27,9,9),mk(19,41,19,9),mk(0,54,28,9),mk(19,67,19,9),mk(38,81,9,9),mk(57,95,9,9)]),
  l: gl([mk(0,0,10,9),mk(1,13,9,10),mk(0,27,10,10),mk(1,41,9,9),mk(0,54,10,9),mk(0,67,10,10),mk(0,81,10,10),mk(10,95,10,9)]),
  m: gl([mk(19,27,9,10),mk(38,27,18,10),mk(66,27,28,9),mk(19,41,19,9),mk(57,41,19,9),mk(94,41,10,9),mk(18,54,10,9),mk(56,54,10,10),mk(94,54,10,9),mk(18,67,10,10),mk(56,67,10,10),mk(95,67,9,10),mk(18,81,10,10),mk(56,81,10,10),mk(95,81,9,10),mk(18,95,10,9),mk(56,95,10,9),mk(94,95,10,9)]),
  n: gl([mk(0,27,9,9),mk(19,27,28,9),mk(0,41,9,9),mk(47,41,9,9),mk(0,54,9,9),mk(47,54,9,9),mk(0,67,9,9),mk(47,67,9,9),mk(0,81,9,9),mk(47,81,9,9),mk(0,95,9,9),mk(47,95,9,9)]),
  o: gl([mk(10,27,38,9),mk(0,41,10,9),mk(48,41,10,9),mk(0,54,10,9),mk(48,54,10,10),mk(1,67,9,10),mk(48,67,10,10),mk(0,81,10,10),mk(48,81,10,10),mk(10,95,38,9)]),
  p: gl([mk(0,27,9,10),mk(19,27,28,9),mk(0,41,19,9),mk(47,41,10,9),mk(0,54,9,10),mk(47,54,10,10),mk(0,68,9,9),mk(47,68,10,9),mk(0,81,19,10),mk(47,81,10,10),mk(0,95,9,9),mk(19,95,28,9),mk(0,108,9,9),mk(0,122,9,9)]),
  q: gl([mk(48,27,9,10),mk(10,27,28,9),mk(38,41,19,9),mk(0,41,10,9),mk(48,54,9,10),mk(0,54,10,10),mk(48,68,9,9),mk(0,68,10,9),mk(38,81,19,10),mk(0,81,10,10),mk(48,95,9,9),mk(10,95,28,9),mk(48,108,9,9),mk(48,122,9,9)]),
  r: gl([mk(1,27,9,10),mk(20,27,18,10),mk(1,41,18,9),mk(1,54,9,10),mk(0,67,10,10),mk(1,81,9,10),mk(0,95,10,9)]),
  s: gl([mk(10,27,28,10),mk(0,40,10,10),mk(38,40,10,10),mk(10,54,19,10),mk(29,67,19,10),mk(0,81,10,10),mk(38,81,10,10),mk(10,95,28,9)]),
  t: gl([mk(19,0,9,9),mk(19,13,9,9),mk(0,27,57,9),mk(19,41,9,9),mk(19,54,9,9),mk(19,67,9,9),mk(19,81,9,9),mk(19,95,28,9),mk(57,95,9,9)]),
  u: gl([mk(0,27,10,10),mk(48,27,9,9),mk(0,40,10,10),mk(48,41,9,9),mk(0,54,10,9),mk(48,54,9,9),mk(48,67,9,10),mk(0,68,10,9),mk(0,81,10,10),mk(38,81,19,10),mk(10,95,28,9),mk(48,95,9,9)]),
  v: gl([mk(0,27,9,9),mk(48,27,9,9),mk(0,41,9,9),mk(48,41,9,9),mk(0,54,9,9),mk(48,54,9,9),mk(0,67,9,9),mk(48,67,9,9),mk(10,81,9,9),mk(38,81,9,9),mk(19,95,19,9)]),
  w: gl([mk(0,27,9,9),mk(76,27,9,9),mk(0,41,9,9),mk(76,41,9,9),mk(0,54,9,9),mk(38,54,9,9),mk(76,54,9,9),mk(0,67,9,9),mk(19,67,9,9),mk(57,67,9,9),mk(76,67,9,9),mk(10,81,28,9),mk(48,81,28,9),mk(19,95,9,9),mk(57,95,9,9)]),
  x: gl([mk(0,27,9,9),mk(57,27,9,9),mk(10,41,9,9),mk(47,41,9,9),mk(19,54,28,9),mk(10,67,9,9),mk(47,67,9,9),mk(0,81,9,9),mk(57,81,9,9),mk(0,95,9,9),mk(57,95,9,9)]),
  y: gl([mk(0,27,10,10),mk(48,27,10,10),mk(0,40,10,10),mk(48,40,9,10),mk(0,54,10,10),mk(48,54,10,10),mk(0,67,10,10),mk(48,67,10,10),mk(10,81,9,10),mk(38,81,10,10),mk(19,95,19,9),mk(19,108,10,10),mk(0,122,19,9)]),
  z: gl([mk(10,27,28,9),mk(38,41,9,9),mk(29,54,19,9),mk(10,67,19,9),mk(0,81,9,9),mk(10,95,28,9)]),
  '.': gl([mk(0, 95)]),
  '!': gl([mk(0,27),mk(0,41),mk(0,54),mk(0,67),mk(0,95)]),
};
const FALLBACK = gl([mk(10,27,28),mk(38,41),mk(29,54,19),mk(19,81)]);

function layout(word, width, height, letterGap) {
  if (!word) return [];
  const chars = [...word.toLowerCase()];
  const glyphs = chars.map((c) => GLYPHS[c] ?? FALLBACK);
  const totalCols = glyphs.reduce((s, g, i) => s + g.w / CELL + (i === glyphs.length - 1 ? 0 : letterGap), 0);
  const maxW = width * 0.92, maxH = height * 0.7;
  const cell = Math.min((maxW / Math.max(1, totalCols)), maxH / (GLYPH_H / CELL));
  const dot = cell * 0.62;

  const targets = [];
  let col = 0;
  glyphs.forEach((g, li) => {
    for (const m of g.marks) {
      const s = cell / CELL;
      targets.push({
        x: col * cell + (m.x + m.w / 2) * s,
        y: (m.y + m.h / 2) * s,
        w: Math.max(dot, m.w * (dot / DOT)),
        h: m.h * (dot / DOT),
        letter: li,
      });
    }
    col += g.w / CELL + letterGap;
  });
  if (targets.length === 0) return [];

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const t of targets) {
    minX = Math.min(minX, t.x - t.w / 2); maxX = Math.max(maxX, t.x + t.w / 2);
    minY = Math.min(minY, t.y - t.h / 2); maxY = Math.max(maxY, t.y + t.h / 2);
  }
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  return targets.map((t) => ({ ...t, x: t.x - cx + width / 2, y: t.y - cy + height / 2 }));
}

export const params = {
  text: { kind: 'text', label: 'Text', default: 'scatter', maxLength: 24 },
  letterGap: { kind: 'slider', label: 'Letter gap', min: 0.4, max: 2.5, step: 0.05, default: 1.1 },
  mode: { kind: 'select', label: 'Scatter by', default: 'radius', options: [
    { value: 'radius', label: 'Pointer radius' },
    { value: 'word', label: 'Whole word' },
  ] },
  radius: { kind: 'slider', label: 'Pointer radius', min: 20, max: 240, step: 5, default: 110, unit: 'px' },
  scatterSpread: { kind: 'slider', label: 'Scatter spread', min: 20, max: 200, step: 5, default: 90, unit: 'px' },
  stiffness: { kind: 'slider', label: 'Spring stiffness', min: 0.02, max: 0.4, step: 0.01, default: 0.14, modulatable: true },
  damping: { kind: 'slider', label: 'Spring damping', min: 0.1, max: 0.9, step: 0.02, default: 0.72 },
  wander: { kind: 'slider', label: 'Wander', min: 0, max: 1, step: 0.02, default: 0.4, hint: 'Idle drift once a mark has scattered.' },
  color: { kind: 'color', label: 'Colour', default: { r: 1, g: 1, b: 1, a: 1 } },
  bg: { kind: 'color', label: 'Background', default: { r: 0, g: 0, b: 0, a: 1 } },
};

export default function sketch(p, get) {
  let targets = [];
  let marks = [];
  let builtFor = '';

  function build() {
    targets = layout(get('text'), p.width, p.height, get('letterGap'));
    marks = targets.map((t) => ({
      x: t.x - t.w / 2, y: t.y - t.h / 2,
      vx: 0, vy: 0,
      scattered: false,
      anchorX: 0, anchorY: 0,
      seed: Math.random() * 1000,
    }));
  }

  p.setup = () => {
    p.createCanvas(p.windowWidth, p.windowHeight);
    p.canvas.style.touchAction = 'none';
    p.colorMode(p.RGB, 1, 1, 1, 1);
    p.noStroke();
    build();
    builtFor = `${get('text')}:${get('letterGap')}`;
  };

  p.windowResized = () => { p.resizeCanvas(p.windowWidth, p.windowHeight); build(); };

  p.draw = () => {
    const key = `${get('text')}:${get('letterGap')}`;
    if (key !== builtFor) { build(); builtFor = key; }

    const bg = get('bg');
    p.background(bg.r, bg.g, bg.b, bg.a);

    const col = get('color');
    const mode = get('mode');
    const pointer = p.getCanvasPointer();
    const inside = pointer.active;
    const radius = get('radius');
    const spread = get('scatterSpread');
    const stiff = get('stiffness');
    const damp = get('damping');
    const wander = get('wander');
    const dt = Math.min((p.deltaTime || 16) / 16, 3);

    // Which marks are "hit" this frame, per the chosen mode.
    let hit = new Set();
    if (inside) {
      if (mode === 'radius') {
        const r2 = radius * radius;
        for (let i = 0; i < targets.length; i++) {
          const dx = targets[i].x - pointer.x, dy = targets[i].y - pointer.y;
          if (dx * dx + dy * dy <= r2) hit.add(i);
        }
      } else {
        // Whole-word: nearest letter index to the pointer, by target centre x.
        let nearestLetter = -1, best = Infinity;
        for (const t of targets) {
          const d = Math.abs(t.x - pointer.x);
          if (d < best) { best = d; nearestLetter = t.letter; }
        }
        for (let i = 0; i < targets.length; i++) if (targets[i].letter === nearestLetter) hit.add(i);
      }
    }

    for (let i = 0; i < marks.length; i++) {
      const m = marks[i];
      const t = targets[i];
      const wasScattered = m.scattered;
      m.scattered = hit.has(i);

      if (m.scattered && !wasScattered) {
        const a = Math.random() * Math.PI * 2;
        const d = Math.random() * spread;
        m.anchorX = t.x - t.w / 2 + Math.cos(a) * d;
        m.anchorY = t.y - t.h / 2 + Math.sin(a) * d;
      }

      const targetX = m.scattered ? m.anchorX : t.x - t.w / 2;
      const targetY = m.scattered ? m.anchorY : t.y - t.h / 2;

      if (m.scattered && wander > 0) {
        const n = p.millis() * 0.001 + m.seed;
        m.anchorX += Math.sin(n) * wander * 0.4 * dt;
        m.anchorY += Math.cos(n * 1.3) * wander * 0.4 * dt;
      }

      // Critically-damped-ish spring: acceleration toward target, velocity
      // decays by damping each step. Simple, stable, no external library.
      const ax = (targetX - m.x) * stiff;
      const ay = (targetY - m.y) * stiff;
      m.vx = (m.vx + ax * dt) * Math.pow(1 - damp, dt * 0.2);
      m.vy = (m.vy + ay * dt) * Math.pow(1 - damp, dt * 0.2);
      m.x += m.vx * dt;
      m.y += m.vy * dt;

      p.fill(col.r, col.g, col.b, col.a);
      const isDot = t.w <= t.h * 1.15;
      const w = isDot ? t.h : t.w;
      if (isDot) p.ellipse(m.x + w / 2, m.y + t.h / 2, w, t.h);
      else p.rect(m.x, m.y, w, t.h, t.h / 2);
    }
  };
}
