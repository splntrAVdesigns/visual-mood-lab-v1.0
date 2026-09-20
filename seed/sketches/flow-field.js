/** flow-field — particles advected through a Perlin vector field. */

export const params = {
  count: { kind: 'slider', label: 'Particles', min: 200, max: 6000, step: 1, default: 2200, modulatable: true },
  noiseScale: { kind: 'slider', label: 'Field scale', min: 0.0005, max: 0.02, step: 0.0001, default: 0.0032, scale: 'log' },
  speed: { kind: 'slider', label: 'Speed', min: 0.1, max: 6, step: 0.05, default: 1.4, modulatable: true },
  turbulence: { kind: 'slider', label: 'Turbulence', min: 0, max: 4, step: 0.01, default: 1.2, modulatable: true },
  evolve: { kind: 'slider', label: 'Field evolve', min: 0, max: 0.01, step: 0.0001, default: 0.0015 },
  weight: { kind: 'slider', label: 'Stroke weight', min: 0.2, max: 4, step: 0.1, default: 0.7 },
  alpha: { kind: 'slider', label: 'Stroke alpha', min: 0.01, max: 1, step: 0.01, default: 0.14 },
  tint: { kind: 'color', label: 'Tint', default: { r: 0, g: 0.83, b: 1, a: 1 } },
  hueSpread: { kind: 'slider', label: 'Hue spread', min: 0, max: 1, step: 0.01, default: 0.22 },
  fade: { kind: 'slider', label: 'Trail fade', min: 0, max: 0.3, step: 0.005, default: 0.012, hint: 'Zero leaves permanent trails.' },
  wrap: { kind: 'toggle', label: 'Wrap edges', default: true },
  reseed: { kind: 'trigger', label: 'Reseed', default: null, event: 'reseed', advanced: true, midi: false },
};

export default function sketch(p, get) {
  let agents = [];
  let zoff = 0;

  function spawn() {
    const n = Math.floor(get('count'));
    agents = new Array(n);
    for (let i = 0; i < n; i++) {
      agents[i] = { x: p.random(p.width), y: p.random(p.height), h: p.random(-1, 1) };
    }
  }

  p.setup = () => {
    p.createCanvas(p.windowWidth, p.windowHeight);
    p.colorMode(p.HSB, 360, 100, 100, 1);
    p.background(0);
    p.noFill();
    spawn();
  };

  p.windowResized = () => {
    p.resizeCanvas(p.windowWidth, p.windowHeight);
    p.background(0);
  };

  p.onEvent = (name) => {
    if (name === 'reseed') {
      p.noiseSeed(Math.floor(Math.random() * 100000));
      p.background(0);
      spawn();
    }
  };

  p.draw = () => {
    const fade = get('fade');
    if (fade > 0) {
      p.push();
      p.noStroke();
      p.fill(0, 0, 0, fade);
      p.rect(0, 0, p.width, p.height);
      p.pop();
    }

    if (agents.length !== Math.floor(get('count'))) spawn();

    const ns = get('noiseScale');
    const speed = get('speed');
    const turb = get('turbulence');
    const wrap = get('wrap');
    const tint = get('tint');
    const spread = get('hueSpread');
    const baseHue = rgbToHue(tint.r, tint.g, tint.b);

    p.strokeWeight(get('weight'));

    for (const a of agents) {
      const angle = p.noise(a.x * ns, a.y * ns, zoff) * p.TWO_PI * turb;
      const nx = a.x + Math.cos(angle) * speed;
      const ny = a.y + Math.sin(angle) * speed;

      const hue = (baseHue + a.h * spread * 120 + 360) % 360;
      p.stroke(hue, 65, 100, get('alpha') * tint.a);
      p.line(a.x, a.y, nx, ny);

      a.x = nx;
      a.y = ny;

      const out = a.x < 0 || a.x > p.width || a.y < 0 || a.y > p.height;
      if (out) {
        if (wrap) {
          a.x = (a.x + p.width) % p.width;
          a.y = (a.y + p.height) % p.height;
        } else {
          a.x = p.random(p.width);
          a.y = p.random(p.height);
        }
      }
    }

    zoff += get('evolve');
  };
}

function rgbToHue(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (d === 0) return 0;
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}
