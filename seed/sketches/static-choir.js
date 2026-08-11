export const params = {
  staticIntensity:  { kind: 'slider', label: 'Static Intensity', min: 0, max: 1, step: 0.01, default: 0.35, modulatable: true },
  waveAmplitude:    { kind: 'slider', label: 'Wave Amplitude', min: 0, max: 200, step: 1, default: 90, modulatable: true },
  waveFrequency:    { kind: 'slider', label: 'Wave Frequency', min: 0.5, max: 4, step: 0.05, default: 1, modulatable: true },
  harmonicMix:      { kind: 'slider', label: 'Harmonic Mix', min: 0, max: 1, step: 0.01, default: 0.25, hint: 'Blends in a secondary, higher-frequency harmonic.' },
  layers:           { kind: 'stepper', label: 'Waveform Layers', min: 1, max: 5, step: 1, default: 2, hint: 'Each layer moves opposite the one before it.' },
  layerSpread:      { kind: 'slider', label: 'Layer Spread', min: 0, max: 1, step: 0.01, default: 0.3, hint: 'Vertical spacing between stacked layers.' },
  lfoRate:          { kind: 'slider', label: 'LFO Rate', min: 0.02, max: 1, step: 0.01, default: 0.12 },
  glitchFrequency:  { kind: 'slider', label: 'Glitch Frequency', min: 0, max: 1, step: 0.01, default: 0.15 },
  tint:             { kind: 'color', label: 'Wave Tint', default: { r: 0.85, g: 0.9, b: 0.95, a: 1 } },
  scanlines:        { kind: 'toggle', label: 'Scanlines', default: true },
  scanlineColor:    { kind: 'color', label: 'Scanline Color', default: { r: 0, g: 0, b: 0, a: 1 } },
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
    const waveFrequency = get('waveFrequency');
    const harmonicMix = get('harmonicMix');
    const layers = Math.round(get('layers'));
    const layerSpread = get('layerSpread');
    const lfoRate = get('lfoRate');
    const glitchFrequency = get('glitchFrequency');
    const tint = get('tint');
    const scanlines = get('scanlines');
    const scanlineColor = get('scanlineColor');

    p.background(4);

    const bandHeight = 2;
    p.noStroke();
    for (let y = 0; y < p.height; y += bandHeight) {
      const rowIdx = Math.floor(y / bandHeight);

      if (p.random() < glitchFrequency * 0.02) {
        rowOffsets[rowIdx] = p.random(-30, 30);
      } else {
        rowOffsets[rowIdx] *= 0.85;
      }

      const brightness = p.random(0, staticIntensity * 60);
      p.fill(brightness, brightness, brightness);
      p.rect(rowOffsets[rowIdx] || 0, y, p.width + 40, bandHeight);
    }

    const lfoA = 0.5 + 0.5 * Math.sin(p.frameCount * lfoRate * 0.02);
    const lfoB = 0.5 + 0.5 * Math.sin(p.frameCount * lfoRate * 0.031 + 1.7);

    p.strokeWeight(2);
    p.noFill();

    for (let layer = 0; layer < layers; layer++) {
      // Every other layer runs its phase backwards, so stacked waveforms
      // visibly move in opposite directions rather than just being copies.
      const dirSign = layer % 2 === 0 ? 1 : -1;
      const layerOffset = layers > 1
        ? (layer / (layers - 1) - 0.5) * p.height * layerSpread
        : 0;
      const fade = 1 - (layer / Math.max(layers, 1)) * 0.35;

      p.stroke(tint.r * 255, tint.g * 255, tint.b * 255, 220 * fade);
      p.beginShape();
      const midY = p.height / 2 + layerOffset;

      for (let x = 0; x <= p.width; x += 4) {
        const t = x * 0.02 * waveFrequency;
        const amp = waveAmplitude * (0.4 + 0.6 * lfoA) * fade;
        const phase = dirSign * p.frameCount * 0.02;

        const fundamental = Math.sin(t + phase) * amp * 0.5;
        const harmonic = Math.sin(t * 2.3 + dirSign * p.frameCount * 0.013) * amp * 0.25 * lfoB * (0.3 + harmonicMix);
        const grain = (p.noise(x * 0.01, layer * 10 + p.frameCount * 0.01) - 0.5) * amp * 0.2;

        p.vertex(x, midY + fundamental + harmonic + grain);
      }
      p.endShape();
    }

    if (scanlines) {
      p.stroke(scanlineColor.r * 255, scanlineColor.g * 255, scanlineColor.b * 255, 60);
      p.strokeWeight(1);
      for (let y = 0; y < p.height; y += 3) {
        p.line(0, y, p.width, y);
      }
    }
  };
}
