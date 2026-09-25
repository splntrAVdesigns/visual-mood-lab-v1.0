/** bezier-lab — draggable control points and curve families. */

export const params = {
  copies: { kind: 'stepper', label: 'Copies', min: 1, max: 60, step: 1, default: 18 },
  offset: { kind: 'slider', label: 'Copy offset', min: 0, max: 200, step: 1, default: 34, modulatable: true },
  offsetAngle: { kind: 'slider', label: 'Offset angle', min: -180, max: 180, step: 1, default: 90, unit: 'deg' },
  weight: { kind: 'slider', label: 'Stroke weight', min: 0.25, max: 6, step: 0.05, default: 1 },
  alpha: { kind: 'slider', label: 'Alpha', min: 0.05, max: 1, step: 0.01, default: 0.5 },
  wobble: { kind: 'slider', label: 'Wobble', min: 0, max: 120, step: 1, default: 18, modulatable: true },
  wobbleRate: { kind: 'slider', label: 'Wobble rate', min: 0.05, max: 3, step: 0.05, default: 0.4, showIf: { truthy: 'wobble' } },
  startColor: { kind: 'color', label: 'Start', default: { r: 0, g: 0.83, b: 1, a: 1 } },
  endColor: { kind: 'color', label: 'End', default: { r: 0.27, g: 0.27, b: 0.3, a: 1 } },
  showHandles: { kind: 'toggle', label: 'Show handles', default: true },
  reset: { kind: 'trigger', label: 'Reset points', default: null, event: 'reset' },
};

export default function sketch(p, get) {
  let pts = [];
  let dragging = -1;

  function defaults() {
    const w = p.width, h = p.height;
    return [
      { x: w * 0.18, y: h * 0.72 },
      { x: w * 0.34, y: h * 0.22 },
      { x: w * 0.66, y: h * 0.78 },
      { x: w * 0.82, y: h * 0.28 },
    ];
  }

  p.setup = () => {
    p.createCanvas(p.windowWidth, p.windowHeight);
    p.canvas.style.touchAction = 'none';
    p.canvas.addEventListener('pointerdown', (event) => {
      const pointer = p.getCanvasPointer();
      for (let i = 0; i < pts.length; i++) {
        if (p.dist(pointer.x, pointer.y, pts[i].x, pts[i].y) < 22) {
          dragging = i;
          p.canvas.setPointerCapture(event.pointerId);
          break;
        }
      }
    });
    p.canvas.addEventListener('pointermove', () => {
      if (dragging < 0) return;
      const pointer = p.getCanvasPointer();
      pts[dragging].x = pointer.x;
      pts[dragging].y = pointer.y;
    });
    p.canvas.addEventListener('pointerup', () => { dragging = -1; });
    p.canvas.addEventListener('pointercancel', () => { dragging = -1; });
    p.colorMode(p.RGB, 1, 1, 1, 1);
    pts = defaults();
  };

  p.windowResized = () => {
    p.resizeCanvas(p.windowWidth, p.windowHeight);
    pts = defaults();
  };

  p.onEvent = (name) => {
    if (name === 'reset') pts = defaults();
  };

  p.draw = () => {
    p.background(0);

    const copies = Math.floor(get('copies'));
    const off = get('offset');
    const ang = p.radians(get('offsetAngle'));
    const ox = Math.cos(ang);
    const oy = Math.sin(ang);
    const wob = get('wobble');
    const t = p.millis() * 0.001 * get('wobbleRate');
    const a = get('startColor');
    const b = get('endColor');

    p.noFill();
    p.strokeWeight(get('weight'));

    for (let c = 0; c < copies; c++) {
      const f = copies === 1 ? 0 : c / (copies - 1);
      const d = (f - 0.5) * off * copies * 0.12;
      const w = Math.sin(t + f * 6.28) * wob * f;

      p.stroke(
        p.lerp(a.r, b.r, f),
        p.lerp(a.g, b.g, f),
        p.lerp(a.b, b.b, f),
        p.lerp(a.a, b.a, f) * get('alpha'),
      );

      p.bezier(
        pts[0].x + ox * d, pts[0].y + oy * d,
        pts[1].x + ox * d + w, pts[1].y + oy * d - w,
        pts[2].x + ox * d - w, pts[2].y + oy * d + w,
        pts[3].x + ox * d, pts[3].y + oy * d,
      );
    }

    if (get('showHandles')) {
      p.stroke(0.27, 0.27, 0.3, 0.9);
      p.strokeWeight(1);
      p.line(pts[0].x, pts[0].y, pts[1].x, pts[1].y);
      p.line(pts[2].x, pts[2].y, pts[3].x, pts[3].y);

      p.noStroke();
      for (let i = 0; i < pts.length; i++) {
        const anchor = i === 0 || i === 3;
        p.fill(anchor ? 0 : 0.45, anchor ? 0.83 : 0.45, anchor ? 1 : 0.5, 1);
        p.circle(pts[i].x, pts[i].y, anchor ? 11 : 8);
      }
    }
  };
}
