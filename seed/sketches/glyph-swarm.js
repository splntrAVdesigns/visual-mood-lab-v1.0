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
   * Not because embedding fonts didn't work in principle — three other
   * typography tiles use the exact same shared bridge successfully — but
   * because this tile's own word-shape mask is rebuilt via a p5.Graphics
   * buffer, and font swaps there kept surfacing edge cases (a crash from
   * a resized mask leaving particle indices out of bounds, then a
   * regression from a since-reverted `mask.remove()` cleanup silently
   * breaking every subsequent rebuild once caught by the safety net
   * below) that weren't worth the feature for a tile whose actual point
   * is the particle formation, not typography. Per direct instruction.
   *
   * BUGFIX (post-Part-1 testing, round 2): the disposal theory above
   * didn't hold up — `mask.remove()` was confirmed via console to throw
   * every single time it's called (`TypeError: Cannot read properties of
   * undefined (reading 'indexOf')`, inside p5's own `Element.remove()`),
   * caught by the try/catch below and doing precisely nothing. That
   * attempt never actually disposed anything in any round of testing.
   * Reverted — it added a caught error to the console for zero benefit.
   *
   * What the data actually shows, unambiguously, once disposal is ruled
   * out: a rebuild triggered from `setup()` — before the sketch's draw
   * loop has run even once — consistently produces a healthy point count
   * (7296+ for real words). A rebuild triggered from inside `draw()` —
   * every live word-change, mid-frame, while the sketch's own per-frame
   * rendering is active — consistently produces exactly 0, silently, no
   * exception. That matches independently-reported behavior exactly:
   * leaving the tile and reopening it re-runs `setup()` with whatever
   * word is currently saved, and it renders correctly every time; only
   * the live in-place edit path is broken. `buildTargets()` itself is
   * identical code either way — the one confirmed difference is WHEN it
   * runs relative to the active draw loop, not what it does.
   *
   * `scheduleRebuild()` below moves the actual rebuild work to the start
   * of the NEXT frame via `requestAnimationFrame`, out of the mid-draw
   * synchronous context and into the same "no rendering currently in
   * flight" state `setup()` has — worth trying directly since it's the
   * one variable the data confirms actually differs between the working
   * and broken cases. The pixel-count diagnostic stays in place either
   * way, so the next test is conclusive regardless of outcome.
   */
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

    // TEMPORARY DIAGNOSTIC — remove once confirmed fixed. If the
    // mask.remove() fix above isn't sufficient on its own, this
    // distinguishes the two remaining possibilities cleanly: pixels.length
    // near 0/undefined means the buffer itself never got sized or filled
    // correctly (a resource/allocation problem); a full-length array of
    // all-dark values means the buffer is fine but the text draw call
    // isn't actually landing pixels into it (a text-rendering problem) —
    // genuinely different fixes depending on which. Direct loop over the
    // typed array rather than Array.from()+filter — this can be several
    // million entries on a full-screen canvas, no reason to copy it just
    // to count.
    let filled = 0;
    if (mask.pixels) {
      for (let i = 0; i < mask.pixels.length; i += 4) {
        if (mask.pixels[i] > 128) filled++;
      }
    } else {
      filled = -1;
    }
    console.log('[glyph-swarm] mask', mask.width, 'x', mask.height, 'pixels.length=', mask.pixels ? mask.pixels.length : 'MISSING', 'lit-pixels=', filled);

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
      const pts = buildTargets(word);
      // DIAGNOSTIC, kept in place — confirmed the actual failure mode
      // (see buildTargets()'s doc above): setup()-time rebuilds are
      // healthy, draw()-time rebuilds were consistently 0. Left in so the
      // next test is conclusive if scheduleRebuild() below isn't the
      // full fix either.
      console.log('[glyph-swarm] rebuilt targets for', JSON.stringify(word), '—', pts.length, 'points');
      return pts;
    } catch (err) {
      console.error('[glyph-swarm] buildTargets failed, keeping previous formation:', err);
      return targets;
    }
  }

  /**
   * Runs a target rebuild + particle reinit on the next animation frame
   * instead of synchronously, right now, mid-draw-call. See buildTargets()'s
   * doc above — this is the fix for the one confirmed difference between
   * the working (setup()-time) and broken (draw()-time) rebuild paths.
   * `word` is captured at call time rather than read fresh inside the
   * callback, so a rebuild scheduled for "TOMMY" still rebuilds "TOMMY"
   * even if `currentWord` has already moved on by the time the callback
   * actually runs.
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
