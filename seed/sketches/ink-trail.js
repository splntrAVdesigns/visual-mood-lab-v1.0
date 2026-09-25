/** ink-trail — a fluid ink trail that follows the canvas-local pointer. */

export const params = {
  decay:       { kind: 'slider', label: 'Decay', min: 0.85, max: 0.995, step: 0.001, default: 0.965, hint: 'How much of the last frame survives.' },
  dispersion:  { kind: 'slider', label: 'Dispersion', min: 0, max: 1, step: 0.01, default: 0.4, modulatable: true, hint: 'How soft and spread-out the ink is.' },
  flowSpeed:   { kind: 'slider', label: 'Flow Speed', min: 0, max: 2, step: 0.01, default: 0.6, modulatable: true, hint: 'Curling wobble applied to the trail as it\u2019s laid down.' },
  inkSize:     { kind: 'slider', label: 'Ink Size', min: 3, max: 60, step: 1, default: 18 },
  inkColor:    { kind: 'color', label: 'Ink Color', default: { r: 0.9, g: 0.2, b: 0.5, a: 1 } },
  secondaryColor: { kind: 'color', label: 'Secondary Color', default: { r: 0.1, g: 0.6, b: 0.9, a: 1 } },
  autoDrift:   { kind: 'toggle', label: 'Idle Auto-Drift', default: true },
};

export default function sketch(p, get) {
  let lastX = null, lastY = null;
  let curlPhase = 0;

  // The sandbox pointer bridge tracks both coordinates and presence, even
  // when a finger is used or the pointer leaves for the Inspector drawer.
  let driftBlend = 0; // 0 = following the real cursor, 1 = fully on the idle path

  function dab(x, y, size, dispersion, color) {
    const rings = 4;
    for (let i = rings; i >= 1; i--) {
      const t = i / rings;
      const r = size * (0.4 + dispersion * 1.6) * t;
      const alpha = (1 - t) * 70 * (0.5 + dispersion * 0.5);
      p.fill(color.r * 255, color.g * 255, color.b * 255, alpha);
      p.circle(x, y, r * 2);
    }
    p.fill(color.r * 255, color.g * 255, color.b * 255, 180);
    p.circle(x, y, size * 0.5);
  }

  p.setup = () => {
    p.createCanvas(p.windowWidth, p.windowHeight);
    p.canvas.style.touchAction = 'none';
    p.noStroke();
    p.background(0);
  };

  p.windowResized = () => {
    p.resizeCanvas(p.windowWidth, p.windowHeight);
  };

  p.draw = () => {
    const decay = get('decay');
    const dispersion = get('dispersion');
    const flowSpeed = get('flowSpeed');
    const inkSize = get('inkSize');
    const inkColor = get('inkColor');
    const secondaryColor = get('secondaryColor');
    const autoDrift = get('autoDrift');

    const fadeAlpha = (1 - decay) * 255;
    p.noStroke();
    p.fill(0, 0, 0, fadeAlpha);
    p.rect(0, 0, p.width, p.height);

    const t = p.millis() * 0.001;
    const pointer = p.getCanvasPointer();
    const overCanvas = pointer.active;

    const idleX = p.width / 2 + Math.cos(t * 0.3) * p.width * 0.22;
    const idleY = p.height / 2 + Math.sin(t * 0.42) * p.height * 0.2;

    let tx, ty;
    if (!autoDrift) {
      tx = overCanvas ? pointer.x : p.width / 2;
      ty = overCanvas ? pointer.y : p.height / 2;
      driftBlend = 0;
    } else if (overCanvas) {
      tx = pointer.x;
      ty = pointer.y;
      driftBlend = 0;
    } else {
      // Ramp smoothly onto the idle path over ~0.8s instead of snapping —
      // this is the actual fix for the "sticks at the last spot" report.
      // lastX/lastY (the real last cursor position) is always where the
      // blend starts from, so there's never a jump.
      driftBlend = Math.min(1, driftBlend + 1 / 48);
      const eased = driftBlend * driftBlend * (3 - 2 * driftBlend); // smoothstep
      tx = p.lerp(lastX ?? idleX, idleX, eased);
      ty = p.lerp(lastY ?? idleY, idleY, eased);
    }

    curlPhase += 0.02 + flowSpeed * 0.03;

    if (lastX === null) { lastX = tx; lastY = ty; }

    // Interpolate between last and current position so fast movement lays
    // a continuous trail instead of leaving gaps between frames.
    const dist = Math.hypot(tx - lastX, ty - lastY);
    const steps = Math.max(1, Math.min(20, Math.ceil(dist / 4)));

    const colorPhase = 0.5 + 0.5 * Math.sin(t * 0.2);
    const tone = {
      r: p.lerp(inkColor.r, secondaryColor.r, colorPhase),
      g: p.lerp(inkColor.g, secondaryColor.g, colorPhase),
      b: p.lerp(inkColor.b, secondaryColor.b, colorPhase),
    };

    for (let i = 1; i <= steps; i++) {
      const st = i / steps;
      const bx = p.lerp(lastX, tx, st) + Math.cos(curlPhase + i) * flowSpeed * 3;
      const by = p.lerp(lastY, ty, st) + Math.sin(curlPhase * 1.3 + i) * flowSpeed * 3;
      dab(bx, by, inkSize, dispersion, tone);
    }

    lastX = tx;
    lastY = ty;
  };
}
