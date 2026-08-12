export const params = {
  text:          { kind: 'text', label: 'Word', default: 'BLOOM', maxLength: 12, hint: 'Up to 12 characters.' },
  charSet:       { kind: 'select', label: 'Particle Glyph', options: [
                     { label: 'Dot', value: 'DOT' },
                     { label: 'Letters', value: 'LETTERS' },
                     { label: 'Numbers', value: 'NUMBERS' },
                     { label: 'Symbols', value: 'SYMBOLS' },
                     { label: 'Mixed', value: 'MIXED' },
                   ], default: 'DOT' },
  particleCount: { kind: 'stepper', label: 'Particle Count', min: 400, max: 2500, step: 100, default: 1400 },
  cohesion:      { kind: 'slider', label: 'Cohesion', min: 0.05, max: 1, step: 0.01, default: 0.4, modulatable: true, hint: 'How strongly particles pull toward the word shape.' },
  scatterForce:  { kind: 'slider', label: 'Scatter Force', min: 0, max: 8, step: 0.1, default: 2.5, hint: 'Click and drag on the canvas to push particles apart.' },
  reformDelay:   { kind: 'slider', label: 'Reform Delay (s)', min: 0, max: 3, step: 0.1, default: 0.6 },
  drift:         { kind: 'slider', label: 'Drift', min: 0, max: 1, step: 0.01, default: 0.15, hint: 'Constant small wobble once settled, so the word never goes fully static.' },
  tint:          { kind: 'color', label: 'Tint', default: { r: 1, g: 1, b: 1, a: 1 } },
};

const LETTER_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const NUMBER_CHARS = '0123456789';
const SYMBOL_CHARS = '!@#$%&*+=<>/\\?';

function glyphFor(charSet, particleSeed) {
  if (charSet === 'DOT') return null;
  let pool;
  if (charSet === 'LETTERS') pool = LETTER_CHARS;
  else if (charSet === 'NUMBERS') pool = NUMBER_CHARS;
  else if (charSet === 'SYMBOLS') pool = SYMBOL_CHARS;
  else pool = LETTER_CHARS + NUMBER_CHARS + SYMBOL_CHARS; // MIXED
  return pool[Math.floor(particleSeed * pool.length) % pool.length];
}

export default function sketch(p, get) {
  let targets = [];
  let particles = [];
  let currentWord = '';
  let mask;
  let lastW = 0;
  let lastH = 0;

  // Click-and-drag state — replaces the old "any mouse movement" disturb
  // trigger, which misread ambient inspector interaction as a scatter
  // gesture and kept the swarm from ever settling. See sprint notes.
  let dragging = false;
  let lastDisturbTime = -999;
  let lastCharSet = null;

  // Debounces the particle-count rebuild so an in-progress slider drag
  // (which can emit intermediate values before settling on a step) doesn't
  // tear down and re-scatter the whole formation on every intermediate frame.
  let pendingCount = null;
  let pendingCountSince = 0;
  const REBUILD_DEBOUNCE_MS = 220;

  function buildTargets(word) {
    const w = p.width;
    const h = p.height;
    mask = p.createGraphics(w, h);
    mask.background(0);
    mask.fill(255);
    mask.noStroke();
    mask.textAlign(p.CENTER, p.CENTER);
    let fontSize = Math.min(w, h) * 0.22;
    mask.textSize(fontSize);
    mask.textStyle(p.BOLD);

    const maxWidth = w * 0.9;
    if (mask.textWidth(word) > maxWidth) {
      fontSize *= maxWidth / mask.textWidth(word);
      mask.textSize(fontSize);
    }

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
        seed: Math.random(),
        driftPhase: p.random(p.TWO_PI),
      });
    }
    return arr;
  }

  p.setup = () => {
    p.createCanvas(p.windowWidth, p.windowHeight);
    p.noStroke();
    p.textAlign(p.CENTER, p.CENTER);
    currentWord = (String(get('text') || 'BLOOM').trim().slice(0, 12) || 'BLOOM').toUpperCase();
    lastW = p.width;
    lastH = p.height;
    targets = buildTargets(currentWord);
    particles = initParticles(get('particleCount'));
  };

  // Kept as a fast-path for genuine browser window resizes, but this is no
  // longer the only way a size change gets picked up — see the per-frame
  // check in draw() below.
  p.windowResized = () => {
    p.resizeCanvas(p.windowWidth, p.windowHeight);
  };

  p.mousePressed = () => { dragging = true; };
  p.mouseReleased = () => { dragging = false; };
  p.mouseDragged = () => { lastDisturbTime = p.millis() / 1000; };
  p.touchStarted = () => { dragging = true; lastDisturbTime = p.millis() / 1000; return false; };
  p.touchEnded = () => { dragging = false; return false; };
  p.touchMoved = () => { lastDisturbTime = p.millis() / 1000; return false; };

  p.draw = () => {
    // p.windowResized only fires on a genuine browser `window resize`
    // event. Entering Fullscreen apparently resizes this sketch's canvas
    // through the host/sandbox bridge directly (a postMessage-driven call
    // rather than a native resize event), which never triggers that
    // callback — so `targets`/`particles`, computed for the old canvas
    // size, went stale and the word rendered stretched across the new,
    // much larger canvas. Checking the actual dimensions every frame
    // instead of trusting the callback makes this correct regardless of
    // which mechanism actually changed the size.
    if (p.width !== lastW || p.height !== lastH) {
      lastW = p.width;
      lastH = p.height;
      targets = buildTargets(currentWord);
      particles = initParticles(get('particleCount'));
    }

    const rawText = String(get('text') || 'BLOOM').trim();
    const word = (rawText.slice(0, 12) || 'BLOOM').toUpperCase();
    if (word !== currentWord) {
      currentWord = word;
      targets = buildTargets(currentWord);
    }

    const wantCount = Math.round(get('particleCount') / 100) * 100;
    if (wantCount !== particles.length) {
      const now = p.millis();
      if (pendingCount !== wantCount) {
        pendingCount = wantCount;
        pendingCountSince = now;
      } else if (now - pendingCountSince > REBUILD_DEBOUNCE_MS) {
        particles = initParticles(wantCount);
        pendingCount = null;
      }
    } else {
      pendingCount = null;
    }

    const charSet = get('charSet');
    if (lastCharSet !== null && charSet !== lastCharSet) {
      // Reuse the same scatter/reform mechanism a word change already
      // gets, so switching glyph style visibly reforms instead of just
      // silently swapping every particle's rendered character in place.
      lastDisturbTime = p.millis() / 1000;
    }
    lastCharSet = charSet;

    const cohesion = get('cohesion');
    const scatterForce = get('scatterForce');
    const reformDelay = get('reformDelay');
    const drift = get('drift');
    const tint = get('tint');
    const c = p.color(tint.r * 255, tint.g * 255, tint.b * 255, 255);

    p.background(0);

    const nowSec = p.millis() / 1000;
    const disturbedRecently = dragging || (nowSec - lastDisturbTime < reformDelay);

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
          // No hidden internal multiplier on cohesion any more — the old
          // 0.01-0.3 slider range times an internal *0.1 compressed almost
          // the whole range into visually indistinguishable territory.
          particle.vx += (target.x - particle.x) * cohesion * 0.02;
          particle.vy += (target.y - particle.y) * cohesion * 0.02;

          if (drift > 0) {
            const settled = Math.hypot(target.x - particle.x, target.y - particle.y) < 6;
            if (settled) {
              particle.driftPhase += 0.03 + particle.seed * 0.02;
              particle.vx += Math.cos(particle.driftPhase) * drift * 0.15;
              particle.vy += Math.sin(particle.driftPhase * 1.3) * drift * 0.15;
            }
          }
        }
      }

      particle.vx *= 0.88;
      particle.vy *= 0.88;
      particle.x += particle.vx;
      particle.y += particle.vy;

      if (charSet === 'DOT') {
        p.circle(particle.x, particle.y, 2.2);
      } else {
        const glyph = glyphFor(charSet, particle.seed);
        p.push();
        p.textSize(7);
        p.text(glyph, particle.x, particle.y);
        p.pop();
      }
    }
  };
}
