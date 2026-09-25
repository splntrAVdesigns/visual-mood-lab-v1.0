/** follow-cursor — a swarm that pursues the pointer with configurable
    attraction, orbiting and flee behaviour. Move the mouse over the canvas. */

export const params = {
  count: { kind: 'slider', label: 'Agents', min: 20, max: 2000, step: 1, default: 420, modulatable: true },
  attraction: { kind: 'slider', label: 'Attraction', min: -1, max: 2, step: 0.01, default: 0.6, hint: 'Negative values make them flee.', modulatable: true },
  orbit: { kind: 'slider', label: 'Orbit', min: -2, max: 2, step: 0.01, default: 0.8, hint: 'Sideways force. Creates a vortex around the pointer.' },
  damping: { kind: 'slider', label: 'Damping', min: 0.8, max: 0.999, step: 0.001, default: 0.94 },
  maxSpeed: { kind: 'slider', label: 'Max speed', min: 0.5, max: 20, step: 0.1, default: 7 },
  jitter: { kind: 'slider', label: 'Jitter', min: 0, max: 2, step: 0.01, default: 0.25 },
  falloff: { kind: 'slider', label: 'Falloff', min: 0.2, max: 4, step: 0.05, default: 1.2, hint: 'How quickly the pull weakens with distance.' },
  idleOrbit: { kind: 'slider', label: 'Idle drift', min: 0, max: 2, step: 0.01, default: 0.5, hint: 'Motion when the pointer is not over the canvas.' },
  size: { kind: 'slider', label: 'Agent size', min: 0.3, max: 8, step: 0.1, default: 1.8 },
  trail: { kind: 'slider', label: 'Trail fade', min: 0.01, max: 0.5, step: 0.005, default: 0.11 },
  speedColor: { kind: 'toggle', label: 'Colour by speed', default: true },
  slow: { kind: 'color', label: 'Slow', default: { r: 0.15, g: 0.1, b: 0.4, a: 1 } },
  fast: { kind: 'color', label: 'Fast', default: { r: 0, g: 0.83, b: 1, a: 1 } },
  showTarget: { kind: 'toggle', label: 'Show target', default: true, advanced: true },
  reseed: { kind: 'trigger', label: 'Reseed', default: null, event: 'reseed', advanced: true, midi: false },
};

export default function sketch(p, get) {
  let agents = [];

  function spawn() {
    const n = Math.floor(get('count'));
    agents = new Array(n);
    for (let i = 0; i < n; i++) {
      agents[i] = { x: p.random(p.width), y: p.random(p.height), vx: 0, vy: 0 };
    }
  }

  p.setup = () => {
    p.createCanvas(p.windowWidth, p.windowHeight);
    p.canvas.style.touchAction = 'none';
    p.colorMode(p.RGB, 1, 1, 1, 1);
    p.background(0);
    p.noStroke();
    spawn();
  };

  p.windowResized = () => { p.resizeCanvas(p.windowWidth, p.windowHeight); p.background(0); spawn(); };
  p.onEvent = (name) => { if (name === 'reseed') spawn(); };

  p.draw = () => {
    p.fill(0, 0, 0, get('trail'));
    p.rect(0, 0, p.width, p.height);

    if (agents.length !== Math.floor(get('count'))) spawn();

    const t = p.millis() * 0.001;
    const pointer = p.getCanvasPointer();
    const inside = pointer.active;

    // With no pointer the target orbits on its own, so the sketch is never
    // dead when it is only a thumbnail nobody is hovering.
    const idle = get('idleOrbit');
    const tx = inside ? pointer.x : p.width / 2 + Math.cos(t * idle) * p.width * 0.25;
    const ty = inside ? pointer.y : p.height / 2 + Math.sin(t * idle * 1.3) * p.height * 0.25;

    const attraction = get('attraction');
    const orbit = get('orbit');
    const damping = get('damping');
    const maxSpeed = get('maxSpeed');
    const jitter = get('jitter');
    const falloff = get('falloff');
    const size = get('size');
    const slow = get('slow');
    const fast = get('fast');
    const bySpeed = get('speedColor');

    for (const a of agents) {
      const dx = tx - a.x;
      const dy = ty - a.y;
      const d = Math.max(Math.hypot(dx, dy), 4);
      const pull = attraction * 60 / Math.pow(d, falloff);

      a.vx += (dx / d) * pull + (-dy / d) * orbit * 40 / d;
      a.vy += (dy / d) * pull + (dx / d) * orbit * 40 / d;

      a.vx += (Math.random() - 0.5) * jitter;
      a.vy += (Math.random() - 0.5) * jitter;

      a.vx *= damping;
      a.vy *= damping;

      const sp = Math.hypot(a.vx, a.vy);
      if (sp > maxSpeed) { a.vx = (a.vx / sp) * maxSpeed; a.vy = (a.vy / sp) * maxSpeed; }

      a.x += a.vx;
      a.y += a.vy;

      if (a.x < 0) a.x += p.width; else if (a.x > p.width) a.x -= p.width;
      if (a.y < 0) a.y += p.height; else if (a.y > p.height) a.y -= p.height;

      const f = bySpeed ? Math.min(sp / maxSpeed, 1) : 1;
      p.fill(p.lerp(slow.r, fast.r, f), p.lerp(slow.g, fast.g, f), p.lerp(slow.b, fast.b, f), 0.9);
      p.circle(a.x, a.y, size);
    }

    if (get('showTarget')) {
      p.noFill();
      p.stroke(fast.r, fast.g, fast.b, 0.5);
      p.strokeWeight(1);
      p.circle(tx, ty, 18);
      p.noStroke();
    }
  };
}
