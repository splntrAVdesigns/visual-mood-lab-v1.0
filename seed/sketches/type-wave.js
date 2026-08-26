export const params = {
  text:       { kind: 'text', label: 'Text', default: 'FLUX', maxLength: 12, monospace: false, hint: 'Up to 12 characters.' },
  font:       { kind: 'font', label: 'Font', default: 'orbitron' },
  amplitude:  { kind: 'slider', label: 'Amplitude', min: 0, max: 120, step: 1, default: 40, modulatable: true },
  frequency:  { kind: 'slider', label: 'Frequency', min: 0.05, max: 2, step: 0.01, default: 0.35, modulatable: true },
  noiseAmt:   { kind: 'slider', label: 'Noise Amount', min: 0, max: 80, step: 1, default: 18 },
  speed:      { kind: 'slider', label: 'Speed', min: 0, max: 3, step: 0.01, default: 0.8 },
  weight:     { kind: 'stepper', label: 'Weight', min: 300, max: 900, step: 100, default: 700 },
  tint:       { kind: 'color', label: 'Tint', default: { r: 0, g: 0.83, b: 1, a: 1 } },
  trails:     { kind: 'toggle', label: 'Trails', default: false },
};

export default function sketch(p, get) {
  let t = 0;
  let noiseSeed = Math.random() * 1000;

  p.setup = () => {
    p.createCanvas(p.windowWidth, p.windowHeight);
    p.textAlign(p.CENTER, p.CENTER);
    p.noStroke();
  };

  p.windowResized = () => {
    p.resizeCanvas(p.windowWidth, p.windowHeight);
  };

  p.draw = () => {
    const trails = get('trails');
    if (trails) {
      p.fill(0, 0, 0, 20);
      p.rect(0, 0, p.width, p.height);
    } else {
      p.background(0);
    }

    const rawText = String(get('text') || '').trim();
    const phrase = (rawText.slice(0, 12) || 'FLUX').toUpperCase();
    const amplitude = get('amplitude');
    const frequency = get('frequency');
    const noiseAmt = get('noiseAmt');
    const speed = get('speed');
    const weight = get('weight');
    const tint = get('tint');
    const c = p.color(tint.r * 255, tint.g * 255, tint.b * 255, tint.a * 255);

    t += speed * 0.02;

    let fontSize = Math.min(p.width, p.height) * 0.18;
    p.textSize(fontSize);
    p.textStyle(weight >= 700 ? p.BOLD : p.NORMAL);
    // Embedded font, resolved against lib/fonts/manifest.ts and pushed in
    // by the host (p5.renderer.ts) — see protocol.ts's `fonts` field doc.
    // getEmbeddedFont is only defined once the sandbox runtime actually
    // implements the receiving half of that bridge; guarded so this
    // sketch still renders (just with the browser default face) against
    // an older sandbox build that predates it.
    const embeddedFont = typeof p.getEmbeddedFont === 'function' ? p.getEmbeddedFont(get('font')) : null;
    p.textFont(embeddedFont || 'sans-serif');

    // Custom text can run much longer than the original 4-5 letter presets —
    // scale down if it would overflow the canvas width.
    const maxWidth = p.width * 0.92;
    const measuredWidth = p.textWidth(phrase);
    if (measuredWidth > maxWidth) {
      fontSize *= maxWidth / measuredWidth;
      p.textSize(fontSize);
    }

    p.fill(c);

    const totalWidth = p.textWidth(phrase);
    let x = p.width / 2 - totalWidth / 2;
    const baseY = p.height / 2;

    for (let i = 0; i < phrase.length; i++) {
      const ch = phrase[i];
      const chWidth = p.textWidth(ch);
      const wave = Math.sin(x * frequency * 0.02 + t) * amplitude;
      const wob = (p.noise(noiseSeed + i * 0.4, t * 0.6) - 0.5) * 2 * noiseAmt;
      const y = baseY + wave + wob;
      const rot = Math.sin(x * frequency * 0.02 + t + 0.3) * 0.15;

      p.push();
      p.translate(x + chWidth / 2, y);
      p.rotate(rot);
      p.text(ch, 0, 0);
      p.pop();

      x += chWidth;
    }
  };
}
