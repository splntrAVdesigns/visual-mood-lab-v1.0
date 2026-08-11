export const params = {
  staticIntensity:  { kind: 'slider', label: 'Static Intensity', min: 0, max: 1, step: 0.01, default: 0.35, modulatable: true },
  waveShape:        { kind: 'select', label: 'Waveform Shape', options: [
                        { label: 'Sine', value: 'SINE' },
                        { label: 'Saw', value: 'SAW' },
                        { label: 'Square', value: 'SQUARE' },
                        { label: 'Triangle', value: 'TRIANGLE' },
                      ], default: 'SINE', hint: 'Manual shape today; amplitude/frequency stay modulatable so this can become the idle shape once audio input drives them.' },
  waveAmplitude:    { kind: 'slider', label: 'Wave Amplitude', min: 0, max: 200, step: 1, default: 90, modulatable: true },
  waveFrequency:    { kind: 'slider', label: 'Wave Frequency', min: 0.5, max: 4, step: 0.05, default: 1, modulatable: true },
  harmonicMix:      { kind: 'slider', label: 'Harmonic Mix', min: 0, max: 1, step: 0.01, default: 0.25, hint: 'Blends in a secondary, higher-frequency harmonic.' },
  layers:           { kind: 'stepper', label: 'Waveform Layers', min: 1, max: 10, step: 1, default: 2, hint: 'Each layer moves opposite the one before it.' },
  layerSpread:      { kind: 'slider', label: 'Layer Spread', min: 0, max: 1, step: 0.01, default: 0.3, hint: 'Vertical spacing between stacked layers.' },
  lfoRate:          { kind: 'slider', label: 'LFO Rate', min: 0.02, max: 1, step: 0.01, default: 0.12 },
  glitchFrequency:  { kind: 'slider', label: 'Glitch Frequency', min: 0, max: 1, step: 0.01, default: 0.15, hint: 'Chance per second of a jolt burst — perturbs the waveform directly, not just the static.' },
  tint:             { kind: 'color', label: 'Wave Tint', default: { r: 0.85, g: 0.9, b: 0.95, a: 1 } },
  scanlines:        { kind: 'toggle', label: 'Scanlines', default: true, hint: 'Master switch for all horizontal artifacts — static grain and overlay lines together.' },
  scanlineColor:    { kind: 'color', label: 'Scanline Color', default: { r: 0, g: 0, b: 0, a: 1 } },
  scanlineWidth:    { kind: 'slider', label: 'Scanline Width', min: 1, max: 8, step: 0.5, default: 3 },
  scanlineMotion:   { kind: 'slider', label: 'Scanline Motion', min: -3, max: 3, step: 0.1, default: 0, hint: 'Negative scrolls up, positive scrolls down, 0 is static.' },
};

function waveValue(shape, x) {
  switch (shape) {
    case 'SAW': {
      const cycle = ((x / (2 * Math.PI)) % 1 + 1) % 1;
      return cycle * 2 - 1;
    }
    case 'SQUARE':
      return Math.sin(x) >= 0 ? 1 : -1;
    case 'TRIANGLE':
      return (2 / Math.PI) * Math.asin(Math.sin(x));
    default: // SINE
      return Math.sin(x);
  }
}

export default function sketch(p, get) {
  let rowOffsets = [];
  let scanScroll = 0;

  // Glitch is now a real timed burst state, not a per-row coin flip on
  // noise (which was imperceptible — shifting noise sideways barely reads).
  let glitchTimer = 0;
  let glitchStrength = 0;

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
    const waveShape = get('waveShape');
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
    const scanlineWidth = get('scanlineWidth');
    const scanlineMotion = get('scanlineMotion');

    p.background(4);

    // Trigger / advance a glitch burst. ~glitchFrequency chance per second.
    if (glitchTimer <= 0) {
      if (p.random() < glitchFrequency / 60) {
        glitchTimer = Math.floor(p.random(6, 16));
        glitchStrength = p.random(0.5, 1);
      }
    } else {
      glitchTimer--;
    }
    const glitching = glitchTimer > 0;

    // Static/roll bands — now fully owned by the Scanlines toggle, so
    // switching it off actually removes every horizontal artifact instead
    // of just the overlay color.
    if (scanlines) {
      const bandHeight = 2;
      p.noStroke();
      for (let y = 0; y < p.height; y += bandHeight) {
        const rowIdx = Math.floor(y / bandHeight);

        const glitchChance = glitching ? 0.25 : 0.004;
        if (p.random() < glitchChance) {
          rowOffsets[rowIdx] = p.random(-30, 30) * (glitching ? 1.8 : 1);
        } else {
          rowOffsets[rowIdx] *= 0.85;
        }

        const brightness = p.random(0, staticIntensity * 60);
        p.fill(brightness, brightness, brightness);
        p.rect(rowOffsets[rowIdx] || 0, y, p.width + 40, bandHeight);
      }
    }

    const lfoA = 0.5 + 0.5 * Math.sin(p.frameCount * lfoRate * 0.02);
    const lfoB = 0.5 + 0.5 * Math.sin(p.frameCount * lfoRate * 0.031 + 1.7);

    p.noFill();

    // During a glitch burst, draw the waveform 2-3 times with a chromatic
    // (RGB-split) offset — cheap, and it's the thing that actually reads
    // as "alive" rather than the old sideways-noise-shift approach.
    const passes = glitching
      ? [
          { dx: -glitchStrength * 6, color: { r: 1, g: 0.2, b: 0.2 }, alpha: 130 },
          { dx: glitchStrength * 6, color: { r: 0.2, g: 0.6, b: 1 }, alpha: 130 },
          { dx: 0, color: tint, alpha: 255 },
        ]
      : [{ dx: 0, color: tint, alpha: 220 }];

    for (const pass of passes) {
      for (let layer = 0; layer < layers; layer++) {
        const dirSign = layer % 2 === 0 ? 1 : -1;
        const layerOffset = layers > 1
          ? (layer / (layers - 1) - 0.5) * p.height * layerSpread
          : 0;
        const fade = 1 - (layer / Math.max(layers, 1)) * 0.35;

        p.stroke(pass.color.r * 255, pass.color.g * 255, pass.color.b * 255, pass.alpha * fade);
        p.strokeWeight(2);
        p.beginShape();
        const midY = p.height / 2 + layerOffset;

        for (let x = 0; x <= p.width; x += 4) {
          const t = x * 0.02 * waveFrequency;
          const amp = waveAmplitude * (0.4 + 0.6 * lfoA) * fade;
          const phase = dirSign * p.frameCount * 0.02;

          const fundamental = waveValue(waveShape, t + phase) * amp * 0.5;
          const harmonic = Math.sin(t * 2.3 + dirSign * p.frameCount * 0.013) * amp * 0.25 * lfoB * (0.3 + harmonicMix);
          const grain = (p.noise(x * 0.01, layer * 10 + p.frameCount * 0.01) - 0.5) * amp * 0.2;

          let jolt = 0;
          if (glitching) {
            jolt = (p.noise(x * 0.05, p.frameCount * 0.6, layer) - 0.5) * amp * glitchStrength * 1.4;
          }

          p.vertex(pass.dx + x, midY + fundamental + harmonic + grain + jolt);
        }
        p.endShape();
      }
    }

    if (scanlines) {
      scanScroll += scanlineMotion;
      const spacing = Math.max(2, scanlineWidth * 3);
      p.stroke(scanlineColor.r * 255, scanlineColor.g * 255, scanlineColor.b * 255, 60);
      p.strokeWeight(1);
      const offset = ((scanScroll % spacing) + spacing) % spacing;
      for (let y = -spacing; y < p.height + spacing; y += spacing) {
        p.line(0, y + offset, p.width, y + offset);
      }
    }
  };
}
