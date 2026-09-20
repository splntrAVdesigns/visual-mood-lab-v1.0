export const params = {
  columns:     { kind: 'stepper', label: 'Columns', min: 8, max: 64, step: 1, default: 32 },
  fallSpeed:   { kind: 'slider', label: 'Fall Speed', min: 0.5, max: 20, step: 0.5, default: 8, modulatable: true },
  swapRate:    { kind: 'slider', label: 'Glyph Swap Rate', min: 0.5, max: 12, step: 0.1, default: 4, modulatable: true },
  trailLen:    { kind: 'stepper', label: 'Trail Length', min: 4, max: 40, step: 1, default: 14 },
  charSet:     { kind: 'select', label: 'Characters', options: [
                   { label: 'Katakana-style', value: 'KANA' },
                   { label: 'Numbers', value: 'NUMBERS' },
                   { label: 'Binary', value: 'BINARY' },
                   { label: 'Mixed', value: 'MIXED' },
                 ], default: 'MIXED' },
  direction:   { kind: 'select', label: 'Direction', options: [
                   { label: 'Down', value: 'DOWN' },
                   { label: 'Up', value: 'UP' },
                 ], default: 'DOWN' },
  tint:        { kind: 'color', label: 'Tint', default: { r: 0.1, g: 1.0, b: 0.4, a: 1 } },
  headGlow:    { kind: 'toggle', label: 'Head Glow', default: true },
  reseed:      { kind: 'trigger', label: 'Reseed Columns', default: null, event: 'reseed', advanced: true, midi: false },
};

// Not real Katakana — a small set of glyphs picked to *read* as Matrix-code
// without needing a font/atlas asset. Numbers/Binary/Mixed use real ASCII.
const KANA_LIKE = 'ﾊﾐﾋｰｳｼﾅﾓﾆｻﾜﾂｵﾘｱﾎﾃﾏｹﾒｴｶｷﾑﾕﾗｾﾈｽﾀﾇﾍ0123456789'.split('');
const NUMBER_CHARS = '0123456789'.split('');
const BINARY_CHARS = ['0', '1'];
const charPoolFor = (set) => {
  if (set === 'NUMBERS') return NUMBER_CHARS;
  if (set === 'BINARY') return BINARY_CHARS;
  if (set === 'MIXED') return KANA_LIKE.concat(NUMBER_CHARS);
  return KANA_LIKE;
};

export default function sketch(p, get) {
  let cols = [];
  let charSize = 16;
  let numCols = 32;

  function buildColumns(count) {
    const arr = [];
    for (let i = 0; i < count; i++) {
      arr.push({
        speed: 0.6 + Math.random() * 0.8,
        phase: Math.random() * 1000,
        glyphSeed: Math.random() * 1000,
      });
    }
    return arr;
  }

  p.setup = () => {
    p.createCanvas(p.windowWidth, p.windowHeight);
    p.background(0);
    p.noStroke();
    p.textAlign(p.CENTER, p.CENTER);
    numCols = Math.round(get('columns'));
    cols = buildColumns(numCols);
  };

  p.windowResized = () => {
    p.resizeCanvas(p.windowWidth, p.windowHeight);
  };

  p.onEvent = (name) => {
    if (name === 'reseed') cols = buildColumns(numCols);
  };

  p.draw = () => {
    const wantCols = Math.round(get('columns'));
    if (wantCols !== numCols) {
      numCols = wantCols;
      cols = buildColumns(numCols);
    }

    const fallSpeed = get('fallSpeed');
    const swapRate = get('swapRate');
    const trailLen = Math.round(get('trailLen'));
    const charSet = get('charSet');
    const direction = get('direction');
    const tint = get('tint');
    const headGlow = get('headGlow');
    const pool = charPoolFor(charSet);

    charSize = p.width / numCols;
    const rows = Math.ceil(p.height / charSize) + trailLen;

    p.fill(0, 0, 0, 60);
    p.rect(0, 0, p.width, p.height);

    p.textSize(charSize * 0.9);
    const dirSign = direction === 'UP' ? -1 : 1;
    const t = p.millis() * 0.001;

    for (let c = 0; c < numCols; c++) {
      const col = cols[c];
      const x = c * charSize + charSize / 2;

      const headRow = ((t * fallSpeed * col.speed + col.phase) % rows + rows) % rows;

      for (let trail = 0; trail < trailLen; trail++) {
        const rowFromHead = trail;
        const row = dirSign > 0
          ? (headRow - rowFromHead + rows) % rows
          : (headRow + rowFromHead) % rows;
        const y = row * charSize - charSize * (trailLen / 2);
        if (y < -charSize || y > p.height + charSize) continue;

        const brightness = Math.pow(1 - trail / trailLen, 1.6);
        const glyphIndex = Math.floor(t * swapRate + col.glyphSeed + row * 3.7) % pool.length;
        const ch = pool[((glyphIndex % pool.length) + pool.length) % pool.length];

        if (trail === 0 && headGlow) {
          p.fill(255, 255, 255, 230);
        } else {
          p.fill(tint.r * 255, tint.g * 255, tint.b * 255, 255 * brightness);
        }
        p.text(ch, x, y);
      }
    }
  };
}
