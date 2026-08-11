export const params = {
  gridDensity:    { kind: 'stepper', label: 'Grid Density', min: 4, max: 16, step: 1, default: 8 },
  trackingSpeed:  { kind: 'slider', label: 'Tracking Speed', min: 0.01, max: 0.3, step: 0.005, default: 0.06, modulatable: true },
  blinkFrequency: { kind: 'slider', label: 'Blink Frequency', min: 0.1, max: 3, step: 0.05, default: 0.6 },
  eyeColor:       { kind: 'color', label: 'Eye Color', default: { r: 0.95, g: 0.95, b: 0.9, a: 1 } },
  pupilFollow:    { kind: 'toggle', label: 'Follow Pointer', default: true },
};

export default function sketch(p, get) {
  let eyes = [];

  function buildEyes(density) {
    const arr = [];
    const cols = density;
    const rows = Math.max(2, Math.round((density * p.height) / p.width));
    const cellW = p.width / cols;
    const cellH = p.height / rows;

    for (let iy = 0; iy < rows; iy++) {
      for (let ix = 0; ix < cols; ix++) {
        arr.push({
          x: cellW * (ix + 0.5) + p.random(-cellW * 0.15, cellW * 0.15),
          y: cellH * (iy + 0.5) + p.random(-cellH * 0.15, cellH * 0.15),
          size: Math.min(cellW, cellH) * p.random(0.35, 0.55),
          pupilX: 0,
          pupilY: 0,
          responsiveness: p.random(0.5, 1.3),
          nextBlink: p.random(0.5, 3),
          blinkTimer: 0,
          blinking: false,
        });
      }
    }
    return arr;
  }

  p.setup = () => {
    p.createCanvas(p.windowWidth, p.windowHeight);
    p.noStroke();
    eyes = buildEyes(get('gridDensity'));
  };

  p.windowResized = () => {
    p.resizeCanvas(p.windowWidth, p.windowHeight);
    eyes = buildEyes(get('gridDensity'));
  };

  p.draw = () => {
    const density = get('gridDensity');
    if (eyes.length && Math.abs(Math.sqrt(eyes.length) - density) > 1) {
      eyes = buildEyes(density);
    }

    const trackingSpeed = get('trackingSpeed');
    const blinkFrequency = get('blinkFrequency');
    const eyeColor = get('eyeColor');
    const pupilFollow = get('pupilFollow');
    const dt = p.deltaTime / 1000;

    p.background(8);

    const targetX = p.touches.length ? p.touches[0].x : p.mouseX;
    const targetY = p.touches.length ? p.touches[0].y : p.mouseY;

    for (const eye of eyes) {
      let dx = 0;
      let dy = 0;
      if (pupilFollow) {
        const toX = targetX - eye.x;
        const toY = targetY - eye.y;
        const d = Math.sqrt(toX * toX + toY * toY) || 1;
        const maxOffset = eye.size * 0.18;
        dx = (toX / d) * Math.min(maxOffset, d * 0.06);
        dy = (toY / d) * Math.min(maxOffset, d * 0.06);
      } else {
        dx = Math.sin(p.frameCount * 0.01 + eye.x) * eye.size * 0.1;
        dy = Math.cos(p.frameCount * 0.013 + eye.y) * eye.size * 0.1;
      }
      eye.pupilX += (dx - eye.pupilX) * trackingSpeed * eye.responsiveness;
      eye.pupilY += (dy - eye.pupilY) * trackingSpeed * eye.responsiveness;

      eye.blinkTimer += dt;
      if (!eye.blinking && eye.blinkTimer > eye.nextBlink) {
        eye.blinking = true;
        eye.blinkTimer = 0;
      }
      let blinkAmount = 0;
      if (eye.blinking) {
        blinkAmount = Math.sin(Math.min(eye.blinkTimer / 0.15, 1) * Math.PI);
        if (eye.blinkTimer > 0.15) {
          eye.blinking = false;
          eye.blinkTimer = 0;
          eye.nextBlink = p.random(0.5, 3) / blinkFrequency;
        }
      }

      const openness = 1 - blinkAmount;
      const c = p.color(eyeColor.r * 255, eyeColor.g * 255, eyeColor.b * 255, 255);

      p.push();
      p.translate(eye.x, eye.y);
      p.fill(c);
      p.ellipse(0, 0, eye.size, eye.size * openness * 0.6 + 1);
      if (openness > 0.15) {
        p.fill(6);
        p.ellipse(eye.pupilX, eye.pupilY, eye.size * 0.35 * openness);
      }
      p.pop();
    }
  };
}
