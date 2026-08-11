export const params = {
  word:          { kind: 'select', label: 'Word', options: [
                     { label: 'Drift', value: 'DRIFT' },
                     { label: 'Bloom', value: 'BLOOM' },
                     { label: 'Orbit', value: 'ORBIT' },
                     { label: 'Split', value: 'SPLIT' },
                   ], default: 'DRIFT' },
  particleCount: { kind: 'stepper', label: 'Particle Count', min: 400, max: 3000, step: 100, default: 1400 },
  cohesion:      { kind: 'slider', label: 'Cohesion', min: 0.01, max: 0.3, step: 0.005, default: 0.08, modulatable: true },
  scatterForce:  { kind: 'slider', label: 'Scatter Force', min: 0, max: 8, step: 0.1, default: 2.5 },
  reformDelay:   { kind: 'slider', label: 'Reform Delay (s)', min: 0, max: 3, step: 0.1, default: 0.6 },
  tint:          { kind: 'color', label: 'Tint', default: { r: 1, g: 1, b: 1, a: 1 } },
};

export default function sketch(p, get) {
  let targets = [];
  let particles = [];
  let lastDisturbTime = -999;
  let currentWord = '';
  let mask;

  function buildTargets(word) {
    const w = p.width;
    const h = p.height;
    mask = p.createGraphics(w, h);
    mask.background(0);
    mask.fill(255);
    mask.noStroke();
    mask.textAlign(p.CENTER, p.CENTER);
    const fontSize = Math.min(w, h) * 0.22;
    mask.textSize(fontSize);
    mask.textStyle(p.BOLD);
    mask.text(word, w / 2, h / 2);
    mask.loadPixels();

    const pts = [];
    const step = 3;
    for (let y = 0; y < h; y += step) {
      for (let x = 0; x < w; x += step) {
        const idx = 4 * (y * w + x);
        if (mask.pixels[idx] > 128) pts.push({ x, y });
      }
    }
    return pts;
  }

  function initParticles(count) {
    const arr = [];
    for (let i = 0; i < count; i++) {
      arr.push({
        x: p.random(p.width),
        y: p.random(p.height),
        vx: 0,
        vy: 0,
        targetIdx: targets.length ? Math.floor(p.random(targets.length)) : 0,
      });
    }
    return arr;
  }

  p.setup = () => {
    p.createCanvas(p.windowWidth, p.windowHeight);
    p.noStroke();
    currentWord = String(get('word'));
    targets = buildTargets(currentWord);
    particles = initParticles(get('particleCount'));
  };

  p.windowResized = () => {
    p.resizeCanvas(p.windowWidth, p.windowHeight);
    targets = buildTargets(currentWord);
  };

  p.mouseMoved = () => {
    lastDisturbTime = p.millis() / 1000;
  };
  p.touchMoved = () => {
    lastDisturbTime = p.millis() / 1000;
    return false;
  };

  p.draw = () => {
    const word = String(get('word'));
    if (word !== currentWord) {
      currentWord = word;
      targets = buildTargets(currentWord);
    }

    const wantCount = get('particleCount');
    if (particles.length !== wantCount) {
      particles = initParticles(wantCount);
    }

    const cohesion = get('cohesion');
    const scatterForce = get('scatterForce');
    const reformDelay = get('reformDelay');
    const tint = get('tint');
    const c = p.color(tint.r * 255, tint.g * 255, tint.b * 255, 255);

    p.background(0);

    const nowSec = p.millis() / 1000;
    const disturbedRecently = nowSec - lastDisturbTime < reformDelay;

    const px = p.touches.length ? p.touches[0].x : p.mouseX;
    const py = p.touches.length ? p.touches[0].y : p.mouseY;

    p.fill(c);
    for (const particle of particles) {
      if (targets.length) {
        const target = targets[particle.targetIdx];

        if (disturbedRecently) {
          const dx = particle.x - px;
          const dy = particle.y - py;
          const distSq = dx * dx + dy * dy + 1;
          const force = (scatterForce * 4000) / distSq;
          particle.vx += (dx / Math.sqrt(distSq)) * force * 0.02;
          particle.vy += (dy / Math.sqrt(distSq)) * force * 0.02;
        } else {
          particle.vx += (target.x - particle.x) * cohesion * 0.1;
          particle.vy += (target.y - particle.y) * cohesion * 0.1;
        }
      }

      particle.vx *= 0.88;
      particle.vy *= 0.88;
      particle.x += particle.vx;
      particle.y += particle.vy;

      p.circle(particle.x, particle.y, 2.2);
    }
  };
}
