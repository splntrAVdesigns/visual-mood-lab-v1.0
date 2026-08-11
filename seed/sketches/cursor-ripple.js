export const params = {
  rippleSpeed: { kind: 'slider', label: 'Ripple Speed', min: 0.5, max: 6, step: 0.1, default: 2.2, modulatable: true },
  decay:       { kind: 'slider', label: 'Decay', min: 0.01, max: 0.2, step: 0.005, default: 0.045 },
  density:     { kind: 'stepper', label: 'Ring Density', min: 1, max: 6, step: 1, default: 3 },
  maxRipples:  { kind: 'stepper', label: 'Max Ripples', min: 8, max: 80, step: 2, default: 30 },
  tint:        { kind: 'color', label: 'Tint', default: { r: 0.2, g: 0.9, b: 1, a: 1 } },
  autoSpawn:   { kind: 'toggle', label: 'Idle Auto-Spawn', default: true },
};

export default function sketch(p, get) {
  let ripples = [];
  let lastSpawn = 0;
  let lastMoveTime = 0;
  const minSpawnGap = 60; // ms

  function spawn(x, y) {
    const maxRipples = get('maxRipples');
    ripples.push({ x, y, radius: 0, alpha: 255 });
    if (ripples.length > maxRipples) ripples.shift();
  }

  p.setup = () => {
    p.createCanvas(p.windowWidth, p.windowHeight);
    p.noFill();
  };

  p.windowResized = () => {
    p.resizeCanvas(p.windowWidth, p.windowHeight);
  };

  p.mouseMoved = () => {
    const now = p.millis();
    if (now - lastSpawn > minSpawnGap) {
      spawn(p.mouseX, p.mouseY);
      lastSpawn = now;
    }
    lastMoveTime = now;
  };

  p.mousePressed = () => {
    spawn(p.mouseX, p.mouseY);
    lastMoveTime = p.millis();
  };

  p.touchMoved = () => {
    const now = p.millis();
    if (p.touches.length && now - lastSpawn > minSpawnGap) {
      spawn(p.touches[0].x, p.touches[0].y);
      lastSpawn = now;
    }
    lastMoveTime = now;
    return false;
  };

  p.touchStarted = () => {
    if (p.touches.length) spawn(p.touches[0].x, p.touches[0].y);
    lastMoveTime = p.millis();
    return false;
  };

  p.draw = () => {
    p.background(0, 0, 0, 40);

    const rippleSpeed = get('rippleSpeed');
    const decay = get('decay');
    const density = get('density');
    const tint = get('tint');
    const autoSpawn = get('autoSpawn');

    // If idle for a while and auto-spawn is on, drift a gentle ripple from center
    // so the piece is never fully static before anyone touches it.
    const idleFor = p.millis() - lastMoveTime;
    if (autoSpawn && idleFor > 1500 && p.frameCount % 90 === 0) {
      spawn(p.width / 2 + p.random(-40, 40), p.height / 2 + p.random(-40, 40));
    }

    for (let i = ripples.length - 1; i >= 0; i--) {
      const r = ripples[i];
      r.radius += rippleSpeed;
      r.alpha -= decay * 255;

      if (r.alpha <= 0) {
        ripples.splice(i, 1);
        continue;
      }

      for (let ring = 0; ring < density; ring++) {
        const ringRadius = r.radius - ring * 14;
        if (ringRadius <= 0) continue;
        p.stroke(tint.r * 255, tint.g * 255, tint.b * 255, r.alpha * (1 - ring / density));
        p.strokeWeight(1.5);
        p.circle(r.x, r.y, ringRadius * 2);
      }
    }
  };
}
