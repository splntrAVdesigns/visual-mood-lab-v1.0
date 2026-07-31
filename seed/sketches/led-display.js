/**
 * led-display — a scrolling LED matrix ticker with glow and flicker.
 *
 * Ported from a supplied "LED Display" component that was already
 * canvas2D and frame-driven — a 5x7 bitmap font packed as bitmasks, dot
 * columns flattened into one endless scrolling strip. The font table and
 * column-building logic carry over unchanged; what's dropped is the
 * distinction between typed text items and a separator glyph, folded into
 * a single editable text field since this app's control set doesn't have
 * a natural "list of strings" control kind, and one message plus a repeat
 * count covers the same ticker use case.
 */

const ROWS = 7;
const GLYPH_COLS = 5;
const WORD_GAP_EXTRA = 3;

const FONT = [
  [0x00, 0x00, 0x00, 0x00, 0x00], [0x00, 0x00, 0x5f, 0x00, 0x00], [0x00, 0x07, 0x00, 0x07, 0x00],
  [0x14, 0x7f, 0x14, 0x7f, 0x14], [0x24, 0x2a, 0x7f, 0x2a, 0x12], [0x23, 0x13, 0x08, 0x64, 0x62],
  [0x36, 0x49, 0x55, 0x22, 0x50], [0x00, 0x05, 0x03, 0x00, 0x00], [0x00, 0x1c, 0x22, 0x41, 0x00],
  [0x00, 0x41, 0x22, 0x1c, 0x00], [0x14, 0x08, 0x3e, 0x08, 0x14], [0x08, 0x08, 0x3e, 0x08, 0x08],
  [0x00, 0x50, 0x30, 0x00, 0x00], [0x08, 0x08, 0x08, 0x08, 0x08], [0x00, 0x60, 0x60, 0x00, 0x00],
  [0x20, 0x10, 0x08, 0x04, 0x02], [0x3e, 0x51, 0x49, 0x45, 0x3e], [0x00, 0x42, 0x7f, 0x40, 0x00],
  [0x42, 0x61, 0x51, 0x49, 0x46], [0x21, 0x41, 0x45, 0x4b, 0x31], [0x18, 0x14, 0x12, 0x7f, 0x10],
  [0x27, 0x45, 0x45, 0x45, 0x39], [0x3c, 0x4a, 0x49, 0x49, 0x30], [0x01, 0x71, 0x09, 0x05, 0x03],
  [0x36, 0x49, 0x49, 0x49, 0x36], [0x06, 0x49, 0x49, 0x29, 0x1e], [0x00, 0x36, 0x36, 0x00, 0x00],
  [0x00, 0x56, 0x36, 0x00, 0x00], [0x00, 0x08, 0x14, 0x22, 0x41], [0x14, 0x14, 0x14, 0x14, 0x14],
  [0x41, 0x22, 0x14, 0x08, 0x00], [0x02, 0x01, 0x51, 0x09, 0x06], [0x32, 0x49, 0x79, 0x41, 0x3e],
  [0x7e, 0x11, 0x11, 0x11, 0x7e], [0x7f, 0x49, 0x49, 0x49, 0x36], [0x3e, 0x41, 0x41, 0x41, 0x22],
  [0x7f, 0x41, 0x41, 0x22, 0x1c], [0x7f, 0x49, 0x49, 0x49, 0x41], [0x7f, 0x09, 0x09, 0x01, 0x01],
  [0x3e, 0x41, 0x41, 0x51, 0x32], [0x7f, 0x08, 0x08, 0x08, 0x7f], [0x00, 0x41, 0x7f, 0x41, 0x00],
  [0x20, 0x40, 0x41, 0x3f, 0x01], [0x7f, 0x08, 0x14, 0x22, 0x41], [0x7f, 0x40, 0x40, 0x40, 0x40],
  [0x7f, 0x02, 0x04, 0x02, 0x7f], [0x7f, 0x04, 0x08, 0x10, 0x7f], [0x3e, 0x41, 0x41, 0x41, 0x3e],
  [0x7f, 0x09, 0x09, 0x09, 0x06], [0x3e, 0x41, 0x51, 0x21, 0x5e], [0x7f, 0x09, 0x19, 0x29, 0x46],
  [0x46, 0x49, 0x49, 0x49, 0x31], [0x01, 0x01, 0x7f, 0x01, 0x01], [0x3f, 0x40, 0x40, 0x40, 0x3f],
  [0x1f, 0x20, 0x40, 0x20, 0x1f], [0x7f, 0x20, 0x18, 0x20, 0x7f], [0x63, 0x14, 0x08, 0x14, 0x63],
  [0x03, 0x04, 0x78, 0x04, 0x03], [0x61, 0x51, 0x49, 0x45, 0x43], [0x00, 0x00, 0x7f, 0x41, 0x41],
  [0x02, 0x04, 0x08, 0x10, 0x20], [0x41, 0x41, 0x7f, 0x00, 0x00], [0x04, 0x02, 0x01, 0x02, 0x04],
  [0x40, 0x40, 0x40, 0x40, 0x40],
];

function glyphFor(char) {
  const code = char.toUpperCase().charCodeAt(0);
  return FONT[code - 32] ?? FONT[0];
}

function buildColumns(text, spread) {
  const columns = [];
  const blanks = (n) => { for (let i = 0; i < n; i++) columns.push(0); };
  const chars = [...(text || 'LED DISPLAY')];
  if (chars.length === 0) { blanks(GLYPH_COLS + spread); return columns; }
  chars.forEach((char, i) => {
    if (char === ' ') { blanks(spread + WORD_GAP_EXTRA); return; }
    const glyph = glyphFor(char);
    for (let c = 0; c < GLYPH_COLS; c++) columns.push(glyph[c]);
    if (chars[i + 1] !== undefined && chars[i + 1] !== ' ') blanks(spread);
  });
  blanks(spread + WORD_GAP_EXTRA * 2);
  return columns;
}

function flickerNoise(t) {
  const i = Math.floor(t), f = t - i;
  const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
  const smooth = f * f * (3 - 2 * f);
  const value = hash(i) * (1 - smooth) + hash(i + 1) * smooth;
  return value * value;
}

export const params = {
  text: { kind: 'text', label: 'Message', default: 'VISUAL MOOD LAB', maxLength: 60 },
  speed: { kind: 'slider', label: 'Scroll speed', min: 2, max: 80, step: 1, default: 24, modulatable: true },
  direction: { kind: 'select', label: 'Direction', default: 'left', options: [
    { value: 'left', label: 'Left' },
    { value: 'right', label: 'Right' },
  ] },
  textSize: { kind: 'slider', label: 'Board size', min: 40, max: 260, step: 5, default: 130, unit: 'px' },
  dotSize: { kind: 'slider', label: 'Dot size', min: 4, max: 30, step: 0.5, default: 16, unit: 'px' },
  spread: { kind: 'stepper', label: 'Letter spread', min: 0, max: 4, step: 1, default: 1 },
  dotShape: { kind: 'select', label: 'Dot shape', default: 'round', options: [
    { value: 'round', label: 'Round' },
    { value: 'square', label: 'Square' },
  ] },
  onColor: { kind: 'color', label: 'Lit', default: { r: 1, g: 1, b: 1, a: 1 } },
  offColor: { kind: 'color', label: 'Unlit', default: { r: 1, g: 0, b: 0, a: 0 } },
  glow: { kind: 'slider', label: 'Glow', min: 0, max: 100, step: 1, default: 40, unit: '%' },
  flicker: { kind: 'slider', label: 'Flicker', min: 0, max: 100, step: 1, default: 15, unit: '%' },
};

export default function sketch(p, get) {
  let columns = [];
  let builtFor = '';
  let offset = 0;
  let ctx;

  function rebuild() {
    columns = buildColumns(get('text'), Math.floor(get('spread')));
  }

  p.setup = () => {
    p.createCanvas(p.windowWidth, p.windowHeight);
    ctx = p.drawingContext;
    rebuild();
    builtFor = `${get('text')}:${get('spread')}`;
  };

  p.windowResized = () => p.resizeCanvas(p.windowWidth, p.windowHeight);

  function dotPath(x, y, radius, shape) {
    if (shape === 'square') {
      const s = radius * 2;
      ctx.rect(x - radius, y - radius, s, s);
    } else {
      ctx.moveTo(x + radius, y);
      ctx.arc(x, y, radius, 0, Math.PI * 2);
    }
  }

  p.draw = () => {
    const key = `${get('text')}:${get('spread')}`;
    if (key !== builtFor) { rebuild(); builtFor = key; }

    const total = columns.length;
    if (total === 0) return;

    const boardRows = ROWS;
    const cell = Math.max(1, get('textSize') / boardRows);
    const radius = get('dotSize') / 2;
    const visibleCols = Math.ceil(p.width / cell) + 1;
    const yPad = (p.height - boardRows * cell) / 2;
    const dir = get('direction') === 'right' ? -1 : 1;

    const dt = Math.min((p.deltaTime || 16) / 1000, 0.05);
    offset = (offset + get('speed') * dt) % total;

    const whole = Math.floor(offset);
    const shift = (offset - whole) * cell;
    const xBase = -dir * shift;

    const off = get('offColor');
    const on = get('onColor');
    const glowAmt = get('glow') / 100;
    const flickerAmt = get('flicker') / 100;

    p.background(0);

    ctx.beginPath();
    for (let cx = 0; cx < visibleCols; cx++) {
      const px = xBase + cx * cell + cell / 2;
      for (let row = 0; row < boardRows; row++) dotPath(px, yPad + row * cell + cell / 2, radius, get('dotShape'));
    }
    ctx.fillStyle = `rgba(${Math.round(off.r * 255)}, ${Math.round(off.g * 255)}, ${Math.round(off.b * 255)}, ${off.a})`;
    ctx.fill();

    ctx.beginPath();
    for (let cx = 0; cx < visibleCols; cx++) {
      const source = Math.floor(cx + dir * whole);
      const index = ((source % total) + total) % total;
      const bits = columns[index];
      if (!bits) continue;
      const px = xBase + cx * cell + cell / 2;
      for (let row = 0; row < boardRows; row++) {
        if (!((bits >> row) & 1)) continue;
        dotPath(px, yPad + row * cell + cell / 2, radius, get('dotShape'));
      }
    }

    const wobble = flickerAmt > 0 ? 1 - flickerAmt * flickerNoise((p.millis() / 1000) * 3) : 1;
    ctx.globalAlpha = wobble;
    ctx.fillStyle = `rgb(${Math.round(on.r * 255)}, ${Math.round(on.g * 255)}, ${Math.round(on.b * 255)})`;

    if (glowAmt > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.shadowColor = ctx.fillStyle;
      ctx.shadowBlur = radius * 2 * (glowAmt * 3);
      ctx.globalAlpha = wobble * glowAmt;
      ctx.fill();
      ctx.restore();
      ctx.globalAlpha = wobble;
    }
    ctx.fill();
    ctx.globalAlpha = 1;
  };
}
