/**
 * echo-type — kinetic typography built on discrete, snapping jumps
 * instead of continuous motion. Every letter independently jumps to a
 * new pose (position/rotation/scale) on its own timer, no easing — the
 * jump is instant, which is what reads as "snappy" rather than smooth.
 * Trailing ghost copies replay each letter's own pose history a few
 * jumps late (a true delay line, not just independently-jittering
 * duplicates), color-shifted apart per layer for an RGB-split echo, on
 * top of a continuous hue drift for the psychedelic read. This is a
 * deliberately different motion language from type-wave (continuous
 * sine-wave displacement) and glyph-swarm (continuous particle
 * cohesion) — nothing here eases or interpolates between poses.
 */

export const params = {
  text: { kind: 'text', label: 'Text', default: 'MOOD', maxLength: 12, hint: 'Up to 12 characters.' },
  wordScale: { kind: 'slider', label: 'Word scale', min: 0.3, max: 3, step: 0.02, default: 1, hint: 'Scales the whole word — letter size, spacing, and jump distance all together.' },

  snapInterval: { kind: 'slider', label: 'Snap interval', min: 0.05, max: 1.0, step: 0.01, default: 0.18, unit: 's', modulatable: true, hint: 'How often each letter jumps to a new pose — lower is snappier.' },
  jumpAmount: { kind: 'slider', label: 'Jump distance', min: 0, max: 60, step: 1, default: 22, unit: 'px' },
  rotationJump: { kind: 'slider', label: 'Rotation jump', min: 0, max: 30, step: 1, default: 8, unit: 'deg' },
  scaleJump: { kind: 'slider', label: 'Scale jump', min: 0, max: 0.4, step: 0.01, default: 0.14 },
  staggerAmount: { kind: 'slider', label: 'Letter stagger', min: 0, max: 1, step: 0.02, default: 0.6, hint: '0 snaps every letter in unison; higher spreads their timing apart.' },

  echoCount: { kind: 'stepper', label: 'Echo count', min: 0, max: 6, step: 1, default: 3, hint: 'Number of trailing ghost copies behind each letter.' },
  echoSpacing: { kind: 'stepper', label: 'Echo spacing', min: 1, max: 5, step: 1, default: 1, hint: 'How many jumps behind the previous echo each ghost trails — steps, not seconds.' },
  rgbSplit: { kind: 'slider', label: 'Chromatic split', min: 0, max: 1, step: 0.02, default: 0.6, hint: 'Color divergence between echo layers.' },

  hueDrift: { kind: 'toggle', label: 'Hue drift', default: true, hint: 'Continuously cycles the color for a psychedelic effect.' },
  hueSpeed: { kind: 'slider', label: 'Hue drift speed', min: 0, max: 3, step: 0.02, default: 0.6, modulatable: true, showIf: { equals: ['hueDrift', true] } },

  fontWeight: { kind: 'stepper', label: 'Weight', min: 300, max: 900, step: 100, default: 800 },
  baseColor: { kind: 'color', label: 'Base color', default: { r: 0, g: 0.83, b: 1, a: 1 } },
  glow: { kind: 'slider', label: 'Glow', min: 0, max: 2, step: 0.02, default: 0.8 },
  bgTrail: { kind: 'slider', label: 'Background trail', min: 0, max: 0.95, step: 0.01, default: 0.55, hint: 'Higher leaves a longer smear behind the snapping letters.' },

  tileEffect: { kind: 'toggle', label: 'Tile background', default: false, hint: 'Fills the background with a repeating grid of the same word, behind the main animation.' },
  tileOpacity: { kind: 'slider', label: 'Tile opacity', min: 0, max: 1, step: 0.02, default: 0.15, showIf: { equals: ['tileEffect', true] } },
};

// Minimal RGB<->HSB pair — enough for a true hue rotation on the base
// color without pulling in a full color library. Params store color as
// {r,g,b,a} in 0..1 to match every other color control in the library.
function rgbToHsb(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  return [h, s, max];
}

function hsbToRgb(h, s, v) {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  return [r + m, g + m, b + m];
}

export default function sketch(p, get) {
  let letters = [];
  let builtFor = '';
  let time = 0;

  function rand(min, max) { return min + Math.random() * (max - min); }

  function newPose() {
    const jump = get('jumpAmount') * get('wordScale');
    const rotJ = get('rotationJump');
    const scaleJ = get('scaleJump');
    return {
      tx: rand(-jump, jump),
      ty: rand(-jump, jump),
      rot: rand(-rotJ, rotJ) * (Math.PI / 180),
      scale: 1 + rand(-scaleJ, scaleJ),
    };
  }

  function buildLetters() {
    const text = String(get('text') || 'MOOD').slice(0, 12).toUpperCase() || 'MOOD';
    letters = text.split('').map(() => ({
      nextSnap: rand(0, get('snapInterval')),
      history: [{ tx: 0, ty: 0, rot: 0, scale: 1 }],
    }));
    // Store the characters separately from per-letter state so a text
    // edit that keeps the same length doesn't reset motion history.
    for (let i = 0; i < letters.length; i++) letters[i].ch = text[i];
  }

  p.setup = () => {
    p.createCanvas(p.windowWidth, p.windowHeight);
    p.colorMode(p.RGB, 1, 1, 1, 1);
    p.textAlign(p.CENTER, p.CENTER);
    p.noStroke();
    buildLetters();
    builtFor = get('text');
  };

  p.windowResized = () => { p.resizeCanvas(p.windowWidth, p.windowHeight); };

  function drawTileBackground(text, scale, color, opacity) {
    if (opacity <= 0) return;
    p.push();
    p.noStroke();
    p.fill(color.r, color.g, color.b, opacity * color.a);
    p.textSize(28 * scale);
    p.textStyle(p.NORMAL);
    const cellW = 90 * scale, cellH = 70 * scale;
    const cols = Math.ceil(p.width / cellW) + 2;
    const rows = Math.ceil(p.height / cellH) + 2;
    for (let r = 0; r < rows; r++) {
      const rowOffset = (r % 2 === 0) ? 0 : cellW / 2;
      for (let c = 0; c < cols; c++) {
        const x = c * cellW + rowOffset - cellW;
        const y = r * cellH - cellH;
        p.push();
        p.translate(x, y);
        p.text(text, 0, 0);
        p.pop();
      }
    }
    p.pop();
  }

  p.draw = () => {
    const currentText = get('text');
    if (currentText !== builtFor) { buildLetters(); builtFor = currentText; }

    const dt = Math.min(p.deltaTime, 100) / 1000;
    time += dt;

    const trail = get('bgTrail');
    p.fill(0, 0, 0, 1 - trail);
    p.rect(0, 0, p.width, p.height);

    const wordScale = get('wordScale');
    const tileOn = get('tileEffect');
    if (tileOn) {
      drawTileBackground(currentText || 'MOOD', wordScale, get('baseColor'), get('tileOpacity'));
    }

    const snapInterval = get('snapInterval');
    const stagger = get('staggerAmount');
    const echoCount = Math.round(get('echoCount'));
    const echoSpacing = Math.round(get('echoSpacing'));
    const historyDepth = echoCount * echoSpacing + 2;

    letters.forEach((L) => {
      if (time >= L.nextSnap) {
        L.history.unshift(newPose());
        if (L.history.length > historyDepth) L.history.length = historyDepth;
        L.nextSnap = time + snapInterval + stagger * rand(0, snapInterval);
      }
    });

    const weight = Math.round(get('fontWeight'));
    p.textStyle(weight >= 700 ? p.BOLD : p.NORMAL);
    p.textSize(64 * wordScale);

    const glowAmt = get('glow');
    const base = get('baseColor');
    const hueOn = get('hueDrift');
    const hueSpeed = get('hueSpeed');
    const split = get('rgbSplit');

    const [baseH, baseS, baseV] = rgbToHsb(base.r, base.g, base.b);
    const driftH = hueOn ? (time * hueSpeed * 60) % 360 : 0;

    const spacing = 50 * wordScale;
    const totalWidth = letters.length * spacing;
    const startX = p.width / 2 - totalWidth / 2 + spacing / 2;
    const cy = p.height / 2;

    for (let layer = echoCount; layer >= 0; layer--) {
      const histIdx = layer * echoSpacing;
      const opacity = layer === 0 ? 1 : Math.max(0.06, 0.55 - layer * (0.5 / Math.max(1, echoCount)));
      const layerHueShift = layer === 0 ? 0 : layer * 40 * split;
      let h = (baseH + driftH + layerHueShift) % 360;
      if (h < 0) h += 360;
      const [cr, cg, cb] = hsbToRgb(h, baseS, baseV);

      if (glowAmt > 0) {
        p.drawingContext.shadowBlur = (layer === 0 ? 14 : 6) * glowAmt;
        p.drawingContext.shadowColor = `rgba(${cr * 255},${cg * 255},${cb * 255},0.7)`;
      }
      p.fill(cr, cg, cb, opacity * base.a);

      letters.forEach((L, i) => {
        const pose = L.history[Math.min(histIdx, L.history.length - 1)];
        const x = startX + i * spacing;
        p.push();
        p.translate(x + pose.tx, cy + pose.ty);
        p.rotate(pose.rot);
        p.scale(pose.scale);
        p.text(L.ch, 0, 0);
        p.pop();
      });
    }
    p.drawingContext.shadowBlur = 0;
  };
}
