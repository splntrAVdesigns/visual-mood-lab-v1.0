/** field-lines — a grid of short segments that bend toward (or away from)
    the pointer, like magnetic field lines. Rebuilt as p5 for the same
    reason as ink-trail: the shader version's pointer uniform was never
    actually bound by the renderer. Direct port of the same bend math,
    just drawn with p.line() instead of an SDF. */

export const params = {
  density:       { kind: 'stepper', label: 'Grid Density', min: 8, max: 48, step: 1, default: 22 },
  lineLength:    { kind: 'slider', label: 'Line Length', min: 4, max: 40, step: 1, default: 14 },
  bendStrength:  { kind: 'slider', label: 'Bend Strength', min: 0, max: 3, step: 0.05, default: 1.2, modulatable: true },
  fieldRadius:   { kind: 'slider', label: 'Field Radius', min: 40, max: 600, step: 5, default: 260, modulatable: true },
  polarity:      { kind: 'select', label: 'Polarity', options: [
                     { label: 'Attract', value: 'ATTRACT' },
                     { label: 'Repel', value: 'REPEL' },
                   ], default: 'ATTRACT' },
  lineWidth:     { kind: 'slider', label: 'Line Width', min: 0.5, max: 4, step: 0.1, default: 1.4 },
  lineColor:     { kind: 'color', label: 'Line Color', default: { r: 0, g: 0.83, b: 1, a: 1 } },
  glow:          { kind: 'slider', label: 'Glow', min: 0, max: 1, step: 0.01, default: 0.4 },
};

export default function sketch(p, get) {
  // Graze-to-pluck: each cell remembers whether the field was "near" it
  // last frame. A false→true transition is the graze — the moment the
  // cursor actually crosses that line — and fires exactly one pluck, not
  // one per frame the cursor happens to linger. Rebuilt whenever density
  // changes, since the grid's cell count (and therefore every index into
  // this array) changes with it; a stale array from a different-sized
  // grid would compare the wrong cells against each other.
  let wasNear = [];
  let wasNearDensity = -1;
  const NEAR_THRESHOLD = 0.55;

  p.setup = () => {
    p.createCanvas(p.windowWidth, p.windowHeight);
    p.canvas.style.touchAction = 'none';
  };

  p.windowResized = () => {
    p.resizeCanvas(p.windowWidth, p.windowHeight);
  };

  p.draw = () => {
    const density = Math.round(get('density'));
    const lineLength = get('lineLength');
    const bendStrength = get('bendStrength');
    const fieldRadius = get('fieldRadius');
    const polarity = get('polarity');
    const lineWidth = get('lineWidth');
    const lineColor = get('lineColor');
    const glow = get('glow');

    p.background(0);

    const t = p.millis() * 0.001;

    // Idle: the field's focal point drifts gently so the piece isn't
    // static before anyone touches it, same idea as follow-cursor.js.
    const pointer = p.getCanvasPointer();
    const pointerActive = pointer.active;
    const px = pointerActive ? pointer.x : p.width / 2 + Math.cos(t * 0.35) * p.width * 0.25;
    const py = pointerActive ? pointer.y : p.height / 2 + Math.sin(t * 0.28) * p.height * 0.25;

    const cellW = p.width / density;
    const cellH = p.height / density;

    if (density !== wasNearDensity) {
      wasNear = new Array(density * density).fill(false);
      wasNearDensity = density;
    }
    // No real pointer on the tile: nothing counts as "near" for graze
    // purposes, so the idle drift point never triggers a pluck, and the
    // next genuine crossing after re-entry always reads as fresh rather
    // than inheriting whatever was true the last time the pointer left.
    if (!pointerActive) wasNear.fill(false);

    p.strokeCap(p.ROUND);

    for (let iy = 0; iy < density; iy++) {
      for (let ix = 0; ix < density; ix++) {
        const cx = (ix + 0.5) * cellW;
        const cy = (iy + 0.5) * cellH;

        const dx = px - cx;
        const dy = py - cy;
        const dist = Math.hypot(dx, dy);
        // Raw proximity, independent of Bend Strength — graze detection
        // reads this directly so the knob stays purely visual and doesn't
        // secretly retune how easily the instrument triggers.
        const proximity = p.constrain(1 - dist / fieldRadius, 0, 1);
        const influence = proximity * bendStrength;

        const baseAngle = Math.sin(ix * 0.4) * 0.4 + Math.cos(iy * 0.4) * 0.4;
        let pointerAngle = Math.atan2(dy, dx);
        if (polarity === 'REPEL') pointerAngle += Math.PI;

        const angle = p.lerp(baseAngle, pointerAngle, p.constrain(influence, 0, 1));
        const len = lineLength * (1 + influence * 0.6);

        const ax = cx - Math.cos(angle) * len;
        const ay = cy - Math.sin(angle) * len;
        const bx = cx + Math.cos(angle) * len;
        const by = cy + Math.sin(angle) * len;

        if (glow > 0) {
          p.stroke(lineColor.r * 255, lineColor.g * 255, lineColor.b * 255, 60 * glow);
          p.strokeWeight(lineWidth * 4);
          p.line(ax, ay, bx, by);
        }

        p.stroke(lineColor.r * 255, lineColor.g * 255, lineColor.b * 255, 255);
        p.strokeWeight(lineWidth);
        p.line(ax, ay, bx, by);

        if (pointerActive) {
          const cellIndex = iy * density + ix;
          const near = proximity > NEAR_THRESHOLD;
          if (near && !wasNear[cellIndex] && typeof p.pluck === 'function') {
            p.pluck(cx / p.width);
          }
          wasNear[cellIndex] = near;
        }
      }
    }
  };
}
