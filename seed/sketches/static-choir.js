export const params = {
  staticIntensity:  { kind: 'slider', label: 'Static Intensity', min: 0, max: 1, step: 0.01, default: 0.35, modulatable: true },
  waveAmplitude:    { kind: 'slider', label: 'Wave Amplitude', min: 0, max: 200, step: 1, default: 90, modulatable: true },
  lfoRate:          { kind: 'slider', label: 'LFO Rate', min: 0.02, max: 1, step: 0.01, default: 0.12 },
  glitchFrequency:  { kind: 'slider', label: 'Glitch Frequency', min: 0, max: 1, step: 0.01, default: 0.15 },
  tint:             { kind: 'color', label: 'Tint', default: { r: 0.85, g: 0.9, b: 0.95, a: 1 } },
  scanlines:        { kind: 'toggle', label: 'Scanlines', default: true },
};

export default function sketch(p, get) {
  let rowOffsets = [];

  p.setup = () => {
    p.createCanvas(p.windowWidth, p.windowHeight);
    p.pixelDensity(1);
    rowOffsets = new Array(Math.ceil(p.height / 2)).fill(0);
  };

  p.windowResized = () => {
    p.resizeCanvas(p.windowWidth, p.windowHeight);
    rowOffsets = new Array(Math.ceil(p.height / 2)).fill(0);
  };

  p.draw = () => {
    const staticIntensity = get('staticIntensity');
    const waveAmplitude = get('waveAmplitude');
    const lfoRate = get('lfoRate');
    const glitchFrequency = get('glitchFrequency');
    const tint = get('tint');
    const scanlines = get('scanlines');

    p.background(4);

    const bandHeight = 2;
    p.noStroke();
    for (let y = 0; y < p.height; y += bandHeight) {
      const rowIdx = Math.floor(y / bandHeight);

      // Occasional CRT roll: a row briefly holds a horizontal offset.
      if (p.random() < glitchFrequency * 0.02) {
        rowOffsets[rowIdx] = p.random(-30, 30);
      } else {
        rowOffsets[rowIdx] *= 0.85;
      }

      const brightness = p.random(0, staticIntensity * 60);
      p.fill(brightness, brightness, brightness);
      p.rect(rowOffsets[rowIdx] || 0, y, p.width + 40, bandHeight);
    }

    // LFO-modulated waveform, breathing without needing real audio input.
    const lfoA = 0.5 + 0.5 * Math.sin(p.frameCount * lfoRate * 0.02);
    const lfoB = 0.5 + 0.5 * Math.sin(p.frameCount * lfoRate * 0.031 + 1.7);

    p.stroke(tint.r * 255, tint.g * 255, tint.b * 255, 220);
    p.strokeWeight(2);
    p.noFill();
    p.beginShape();
    const midY = p.height / 2;
    for (let x = 0; x <= p.width; x += 4) {
      const t = x * 0.02;
      const amp = waveAmplitude * (0.4 + 0.6 * lfoA);
      const y = midY
        + Math.sin(t + p.frameCount * 0.02) * amp * 0.5
        + Math.sin(t * 2.3 + p.frameCount * 0.013) * amp * 0.25 * lfoB
        + (p.noise(x * 0.01, p.frameCount * 0.01) - 0.5) * amp * 0.2;
      p.vertex(x, y);
    }
    p.endShape();

    if (scanlines) {
      p.stroke(0, 0, 0, 60);
      p.strokeWeight(1);
      for (let y = 0; y < p.height; y += 3) {
        p.line(0, y, p.width, y);
      }
    }
  };
}
