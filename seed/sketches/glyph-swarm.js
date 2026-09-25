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

  // BUGFIX (post-Part-1 testing): the text/word rebuild never had this —
  // particleCount got a debounce because dragging a slider emits
  // intermediate values before settling; typing a word does the exact
  // same thing (a distinct string on every keystroke) but had no guard at
  // all. `word !== currentWord` was true on every keystroke's frame while
  // typing, and buildTargets() is not cheap — createGraphics() at full
  // canvas resolution plus a step-3 pixel scan across the whole thing —
  // so a burst of keystrokes queued a burst of full rebuilds back to
  // back, each one blocking draw() long enough to read as a freeze. Same
  // fix as particleCount already uses: wait for the value to hold still
  // for REBUILD_DEBOUNCE_MS before actually rebuilding.
  let pendingWord = null;
  let pendingWordSince = 0;

  /**
   * Font selection was tried in an earlier round and removed — this tile
   * uses whatever the browser's default sans-serif is (no explicit
   * `mask.textFont()` call at all, same as before font support existed).
   * `mask.remove()` was also tried as a cleanup step and reverted — it threw
   * on every call (`TypeError` inside p5's own `Element.remove()`), caught
   * by the try/catch below and doing nothing, so it's not present here.
   *
   * RESOLVED: word changes typed in live (as opposed to a word loaded at
   * setup()) were rebuilding a mask with 0 usable points, freezing the
   * formation. Root cause was pixel-density drift, not draw-loop timing —
   * see the `mask.pixelDensity(1)` call below for the full explanation.
   */
  function buildTargets(word) {
    const w = p.width;
    const h = p.height;
    mask = p.createGraphics(w, h);
    // ROOT CAUSE (confirmed): createGraphics() inherits whatever
    // p.pixelDensity() the OUTER sketch is running at that instant — it is
    // not fixed for the sketch's lifetime. The host (p5.renderer.ts) watches
    // this tile's container with a ResizeObserver and forwards a live
    // `pixelRatio: window.devicePixelRatio` to the sandbox on every layout
    // resize. On mobile, focusing the Word input triggers the browser's
    // auto-zoom-on-input (font-size < 16px), which changes the effective
    // devicePixelRatio for as long as the keyboard is up — and that reverts
    // (another resize) at the exact moment the user taps out, which is also
    // exactly when TextControl.tsx commits the new word. If the sandbox
    // applies that forwarded ratio via p.pixelDensity() (directly, or as a
    // side effect of handling the resize message), any createGraphics()
    // call made afterward — like this one, on the very next word change —
    // silently allocates a buffer at width*density × height*density instead
    // of width × height. The scan loop below indexes with `4 * (y * w + x)`
    // assuming 1px-per-unit; at density 2 that reads the wrong bytes for
    // every (x, y) and finds ~0 lit pixels even though the mask itself
    // rendered the word correctly — only the scan's indexing was wrong.
    // That's the whole "type a word, it
    // freezes, 0 points" bug: setup()'s first-ever buildTargets() call
    // always ran before any resize had propagated (so density was still 1,
    // hence "healthy"); every live in-place word edit ran after at least
    // one resize round trip had already bumped it. The earlier
    // requestAnimationFrame deferral (scheduleRebuild) targeted "runs
    // inside draw() vs setup()" as the variable, which is why it didn't
    // fix this — that was a coincidental correlation, not the actual cause.
    // Locking density here removes the dependency on the outer canvas's
    // density entirely: this is a hit-test mask sampled every 3rd pixel
    // anyway, so there's no benefit to rasterizing it at retina resolution,
    // and it's correct no matter what the host does to p.pixelDensity()
    // around it, now or in the future.
    mask.pixelDensity(1);
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

  /**
   * Wraps buildTargets() so nothing in the mask-build/pixel-scan path can
   * take the whole sketch down with it — once draw() throws it stops
   * being called again, which is exactly what "frozen, no motion, word
   * never updates" looks like from the outside, regardless of which line
   * actually threw. Falls back to whatever targets already existed
   * (last known good formation) rather than an empty array, and logs
   * once so a real problem stays visible in devtools instead of quietly
   * doing nothing forever.
   */
  function safeRebuildTargets(word) {
    try {
      return buildTargets(word);
    } catch (err) {
      console.error('[glyph-swarm] buildTargets failed, keeping previous formation:', err);
      return targets;
    }
  }

  /**
   * Runs a target rebuild + particle reinit on the next animation frame
   * instead of synchronously, right now, mid-draw-call. This does NOT fix
   * the 0-points bug (that was pixel-density drift — see buildTargets()'s
   * `mask.pixelDensity(1)`); it's independently worth keeping so a rebuild
   * never blocks the current frame's render. `word` is captured at call
   * time rather than read fresh inside the callback, so a rebuild scheduled
   * for "TOMMY" still rebuilds "TOMMY" even if `currentWord` has already
   * moved on by the time the callback actually runs.
   */
  function scheduleRebuild(word) {
    requestAnimationFrame(() => {
      targets = safeRebuildTargets(word);
      particles = initParticles(get('particleCount'));
    });
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
    p.canvas.style.touchAction = 'none';
    p.noStroke();
    p.textAlign(p.CENTER, p.CENTER);
    currentWord = (String(get('text') || 'BLOOM').trim().slice(0, 12) || 'BLOOM').toUpperCase();
    lastW = p.width;
    lastH = p.height;
    targets = safeRebuildTargets(currentWord);
    particles = initParticles(get('particleCount'));
  };

  // Kept as a fast-path for genuine browser window resizes, but this is no
  // longer the only way a size change gets picked up — see the per-frame
  // check in draw() below.
  p.windowResized = () => {
    p.resizeCanvas(p.windowWidth, p.windowHeight);
  };

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
      // Deferred for the same reason the word-change branch below is —
      // see scheduleRebuild()'s doc. This path runs from the exact same
      // mid-draw context; no symptom has been specifically reported here,
      // but resize is far rarer to trigger repeatedly than typing a word,
      // so it's plausible the same bug exists here and just hasn't been
      // noticed yet rather than genuinely not applying.
      scheduleRebuild(currentWord);
    }

    const rawText = String(get('text') || 'BLOOM').trim();
    const word = (rawText.slice(0, 12) || 'BLOOM').toUpperCase();
    if (word !== currentWord) {
      const now = p.millis();
      if (pendingWord !== word) {
        pendingWord = word;
        pendingWordSince = now;
      } else if (now - pendingWordSince > REBUILD_DEBOUNCE_MS) {
        currentWord = word;
        // The fix — see scheduleRebuild()'s doc and buildTargets()'s doc
        // above for the full reasoning. Particle reinit moves inside the
        // deferred callback too (scheduleRebuild does both together),
        // for the same reason it always had to happen in the same pass
        // as the targets rebuild: a particle's targetIdx has to be
        // bounded against whichever targets array actually exists by the
        // time it's assigned, and now that's the NEXT frame's array, not
        // this frame's.
        scheduleRebuild(currentWord);
        pendingWord = null;
      }
    } else {
      pendingWord = null;
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
    const pointer = p.getCanvasPointer();
    dragging = pointer.active && pointer.down;
    if (dragging) lastDisturbTime = nowSec;
    const disturbedRecently = dragging || (nowSec - lastDisturbTime < reformDelay);

    const px = pointer.x;
    const py = pointer.y;

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
