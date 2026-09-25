/**
 * Rippling Table — GPU-simulated wave surface, height-reactive pattern,
 * autonomous spin, audio-reactive rain.
 *
 * Origin: de-risked as a standalone spike (rippling-table-spike.html)
 * before this authoring pass — see PLACEMENT.md for the full debugging
 * history. Every piece of this file's core technique (GPU ping-pong wave
 * sim via createFramebuffer, height-reactive fragment shading, custom
 * lighting/tonemap, camera/perspective scaling) was verified against a
 * live browser via Playwright + real screenshots before being ported
 * here. What's NOT yet verified is this exact file running inside the
 * real sandboxed iframe — see the "Needs live verification" list in
 * PLACEMENT.md before treating this as shipped.
 *
 * Hard-won lessons folded in from the spike (kept here so the next
 * person touching this file doesn't rediscover them the slow way):
 *   - GPU full-screen-quad passes for a custom shader MUST use plane(),
 *     not rect() — rect() does not reliably feed aTexCoord/vUv to a
 *     fully custom shader in this p5 version. Confirmed via a bare
 *     pass-through shader outputting vUv as color: rect() gave a
 *     constant wrong value, plane() gave the exact expected gradient.
 *   - The wave-sim recurrence needs THREE framebuffers, rotated by
 *     reference each step, not two — writing into the same buffer a
 *     shader reads as an input in the same pass is a read/write hazard.
 *   - Height framebuffers need format: FLOAT — default UNSIGNED_BYTE
 *     clamps to [0,1] and silently destroys wave troughs.
 *   - Moving camera()/perspective() close to a small-scale scene needs
 *     matching near/far — the default far-away near/far planes will
 *     clip a close-up scene to nothing.
 *   - Do NOT call p5's built-in ambientLight()/directionalLight()/
 *     pointLight() before shader() on a custom-shaded Framebuffer draw —
 *     confirmed this makes p5 render with its own default lit material
 *     instead of the custom shader's actual output, even though
 *     CURRENT_PROGRAM correctly shows the custom program bound.
 *   - camera()/perspective() are NOT scoped per-Framebuffer — they leak
 *     across separate begin()/end() blocks. Any GPGPU pass needs its own
 *     explicit ortho() immune to whatever another framebuffer left
 *     behind.
 *   - stampDrop()'s fill() needs colorMode(RGB, 1) — p5's default 0-255
 *     color mode silently renders near-black, near-transparent stamps
 *     for values in the 0-1 range.
 *   - The wave sim step must run on a FIXED TIMESTEP, decoupled from
 *     render fps, via an accumulator — coupling physics steps to
 *     rendered frames means the same tile ripples at a completely
 *     different (and mostly invisible) speed on a 30fps device vs a
 *     144fps one.
 *   - Canvas-size-dependent framebuffers (freshScene/accumA/accumB, sized
 *     to width/height) must be rebuilt on resize by POLLING p.width/
 *     p.height once per frame and comparing, not by relying on
 *     p.windowResized — this mirrors the exact Fullscreen-transition bug
 *     already documented for Glyph Swarm/Wound Thread/Chorus of Eyes:
 *     the sandbox's resize path does not reliably fire that callback.
 */

export const params = {
  // ---- water / droplets ----
  rainRate: {
    kind: 'slider', label: 'Rain rate', group: 'water',
    min: 80, max: 1500, step: 10, default: 450, unit: 'ms',
    modulatable: true,
    hint: 'Lower = drops fall more often. Modulate this for audio-reactive rain density.',
  },
  dropSize: {
    kind: 'slider', label: 'Drop size', group: 'water',
    min: 0.02, max: 0.2, step: 0.005, default: 0.06,
  },
  dropStrength: {
    kind: 'slider', label: 'Drop strength', group: 'water',
    min: 0.1, max: 1.5, step: 0.01, default: 0.8,
    modulatable: true,
    hint: 'Modulate with bass/RMS for beat-reactive splashes.',
  },
  rippleHeight: {
    kind: 'slider', label: 'Ripple height', group: 'water',
    min: 0.1, max: 2, step: 0.01, default: 0.9,
    modulatable: true,
  },
  ripplePersistence: {
    kind: 'slider', label: 'Ripple persistence', group: 'water',
    min: 0.9, max: 0.999, step: 0.001, default: 0.985,
  },
  simSpeed: {
    kind: 'slider', label: 'Sim speed', group: 'water',
    min: 5, max: 60, step: 1, default: 30, unit: 'steps/s',
    hint: 'Physics steps per second — independent of frame rate, so ripple speed reads the same on any device.',
  },
  clearRipples: {
    kind: 'trigger', label: 'Clear ripples', group: 'water', event: 'clear',
  },

  // ---- table appearance ----
  tableColor: {
    kind: 'color', label: 'Table color', group: 'appearance',
    default: { r: 0.07, g: 0.19, b: 0.27, a: 1 },
  },
  highlightColor: {
    kind: 'color', label: 'Highlight color', group: 'appearance',
    default: { r: 0.5, g: 0.91, b: 1, a: 1 },
    modulatable: true,
  },
  pattern: {
    kind: 'select', label: 'Pattern', group: 'appearance',
    default: 'lines',
    options: [
      { value: 'solid', label: 'Solid' },
      { value: 'lines', label: 'Scrolling lines' },
      { value: 'rings', label: 'Radial rings' },
    ],
  },
  patternWarp: {
    kind: 'slider', label: 'Pattern warp', group: 'appearance',
    min: 0, max: 3, step: 0.01, default: 1.2,
    modulatable: true,
  },
  motionBlur: {
    kind: 'slider', label: 'Motion blur', group: 'appearance',
    min: 0, max: 0.9, step: 0.01, default: 0.35,
  },

  // ---- motion ----
  spinSpeed: {
    kind: 'slider', label: 'Spin speed', group: 'motion',
    min: -2, max: 2, step: 0.01, default: 0.25,
    modulatable: true,
    hint: 'Turntable spin — the table stays flat and rotates around its vertical axis, like a lazy susan.',
  },
  horizontalSpin: {
    kind: 'slider', label: 'Horizontal spin', group: 'motion',
    min: -2, max: 2, step: 0.01, default: 0,
    modulatable: true,
    hint: 'A second, independent rotation around a horizontal axis — tips/rolls the table rather than turning it flat. Combine with Spin speed for a tumbling motion.',
  },
  tilt: {
    kind: 'slider', label: 'Tilt', group: 'motion',
    min: 0, max: 30, step: 1, default: 10,
  },
  zoom: {
    kind: 'slider', label: 'Zoom', group: 'motion',
    min: 0.4, max: 3, step: 0.01, default: 1,
    modulatable: true,
  },
};

const PATTERN_INDEX = { solid: 0, lines: 1, rings: 2 };

export default function sketch(p, get) {
  const SIM_RES = 128;
  const MESH_SEG = 96;
  const TABLE_SIZE = 6;
  const MAX_SIM_STEPS_PER_FRAME = 6;
  // Bound stacked impulses before a spike can intersect the camera plane.
  const MAX_WAVE_HEIGHT = 2.0;

  let simShader, tableShader, blurShader;
  let heightCur, heightPrev, heightNext;
  let freshScene, accumA, accumB;
  let accumReadIsA = true;
  let simAccumulator = 0;
  let rainTimer = 0;
  let spinAngle = 0;
  let horizontalAngle = 0;
  let lastW = -1, lastH = -1;
  let energyHistory = [0, 0, 0, 0, 0, 0, 0, 0]; // rolling window for a local baseline
  let energyHistoryIdx = 0;
  let transientCooldown = 0;

  // Audio tap — CONFIRMED against the real public/sandbox/index.html
  // source (was a flagged guess before; verified correct, no change
  // needed to the bridge call itself). What DID need to change is how
  // this value gets used: the original version continuously scaled
  // rainRate/dropStrength/rippleHeight every frame, which is why it
  // didn't feel "synced" despite visibly moving in the Inspector — those
  // params scale an ALREADY-SMOOTH, already-simulated wave field with
  // real temporal inertia (ripplePersistence 0.985 means seconds of
  // decay), so a bass hit just made the existing slow-moving waves
  // taller for a moment rather than creating a new, snappy event. A
  // continuous multiplier can't produce a percussive response no matter
  // how it's tuned — the fix is a discrete trigger instead.
  //
  // This detects a RISING EDGE against a short rolling baseline (not a
  // fixed threshold, since "loud" is relative to the track) and stamps
  // an EXTRA drop the instant a transient crosses it — layered on top of
  // the regular timed rain, not replacing it. That's what makes a splash
  // read as "on the beat" rather than "the water looks different now."
  function readAudioEnergy() {
    if (typeof p.getAudioWaveform !== 'function') return 0;
    const wf = p.getAudioWaveform();
    if (!wf || !wf.length) return 0;
    let sum = 0;
    for (let i = 0; i < wf.length; i++) sum += Math.abs(wf[i]);
    return sum / wf.length;
  }

  function detectTransient(energy) {
    let baseline = 0;
    for (let i = 0; i < energyHistory.length; i++) baseline += energyHistory[i];
    baseline /= energyHistory.length;

    energyHistory[energyHistoryIdx] = energy;
    energyHistoryIdx = (energyHistoryIdx + 1) % energyHistory.length;

    // Rising edge: meaningfully above its own recent baseline, not just
    // "loud" in absolute terms (a quiet passage's transients should
    // still register; a loud passage's steady-state shouldn't re-trigger
    // every frame). Cooldown prevents a single hit from firing repeatedly
    // across consecutive frames while the energy is still elevated.
    return energy > baseline * 1.4 && energy > 0.05;
  }

  function rebuildSceneBuffers(w, h) {
    const opts = { width: w, height: h, textureFiltering: p.LINEAR, density: 1 };
    if (freshScene) {
      freshScene.resize(w, h);
      accumA.resize(w, h);
      accumB.resize(w, h);
    } else {
      freshScene = p.createFramebuffer(opts);
      accumA = p.createFramebuffer(opts);
      accumB = p.createFramebuffer(opts);
    }
    // Previous-frame textures are invalid after a resize (and undefined
    // after first creation). Never blend them into the first new frame.
    for (const buffer of [accumA, accumB]) {
      buffer.begin(); p.clear(); buffer.end();
    }
    accumReadIsA = true;
    lastW = w;
    lastH = h;
  }

  p.setup = () => {
    // p.width/p.height are still 0 at this point — p5 hasn't created a
    // canvas yet, so it has nothing to report. windowWidth/windowHeight
    // reflect the actual containing iframe's size at load time, which is
    // what a card-embedded sketch needs. The previous `p.width || 400`
    // fallback ALWAYS hit the 400 branch (0 is falsy), producing a fixed
    // 400x400 canvas that never matched the real card size and then
    // never resized afterward, since no windowResized() was defined —
    // p5 does not auto-resize the canvas on its own; that's the sketch's
    // job. Confirmed as the real bug from a live report: canvas rendered
    // pinned to the top-left corner, unaffected by the Zoom control,
    // identical on desktop and mobile — exactly what a wrong-and-frozen
    // canvas size looks like, since zoom only moves the camera inside an
    // already-wrong-sized canvas.
    const cnv = p.createCanvas(p.windowWidth, p.windowHeight, p.WEBGL);
    // NOT calling p.pixelDensity() here — the sandbox manages this itself
    // via the 'quality' message (public/sandbox/index.html calls
    // instance.pixelDensity(densityFor(quality, ...)) on every quality
    // change). A fixed pixelDensity(1) call here would silently override
    // that and disable the sandbox's own preview/full cost management —
    // found by reading the sandbox source directly, not something this
    // sketch should second-guess.

    initGL();

    // Best-effort WebGL context-loss handling — flagged as a PLAUSIBLE
    // mitigation for reported "flashing artifacts" / erratic rendering,
    // NOT a confirmed fix. This sketch is genuinely GPU-heavy (three
    // height framebuffers plus three scene framebuffers, three custom
    // shaders, a real-time simulation), which raises the odds of a
    // context-loss event under sustained use, especially on lower-power
    // or mobile GPUs. WebGL does not throw on a stale handle after a
    // context loss — it silently no-ops or returns garbage — which
    // matches "erratic/glitching" better than a hard crash would.
    // preventDefault() on the loss event is required for
    // 'webglcontextrestored' to fire at all; without it the context
    // stays dead permanently. If glitching persists after this, it's
    // most likely NOT context loss and needs a different diagnosis —
    // browser/GPU details and whether the browser console shows any
    // WebGL warnings at the moment it happens would help narrow it down.
    const rawCanvas = cnv.canvas || cnv.elt;
    if (rawCanvas) {
      rawCanvas.addEventListener('webglcontextlost', (e) => {
        e.preventDefault();
      }, false);
      rawCanvas.addEventListener('webglcontextrestored', () => {
        initGL();
      }, false);
    }
  };

  // Pulled out of setup() so the context-restored handler above can
  // re-run exactly the same initialization without duplicating it.
  function initGL() {
    simShader = p.createShader(SIM_VERT, SIM_FRAG);
    tableShader = p.createShader(TABLE_VERT, TABLE_FRAG);
    blurShader = p.createShader(SIM_VERT, BLUR_FRAG);

    const heightOpts = {
      width: SIM_RES, height: SIM_RES,
      textureFiltering: p.LINEAR, density: 1, format: p.FLOAT,
    };
    heightCur = p.createFramebuffer(heightOpts);
    heightPrev = p.createFramebuffer(heightOpts);
    heightNext = p.createFramebuffer(heightOpts);
    [heightCur, heightPrev, heightNext].forEach((fbo) => {
      fbo.begin(); p.clear(); fbo.end();
    });

    // A restored GL context cannot reuse framebuffer handles from before
    // context loss. Resize during normal operation does reuse them.
    freshScene = accumA = accumB = null;
    rebuildSceneBuffers(p.width, p.height);
  }

  // Primary resize path — p5 does not resize its own canvas on a host
  // resize unless the sketch does it explicitly. This is what actually
  // fixes the "stuck in the corner" bug; the poll-and-rebuild in draw()
  // below is a secondary backstop for the one case this project has
  // already documented windowResized NOT reliably firing for (the
  // Fullscreen transition, per the known Glyph Swarm/Wound Thread/
  // Chorus of Eyes issue) — kept as belt-and-suspenders, not a
  // replacement for this.
  p.windowResized = () => {
    p.resizeCanvas(p.windowWidth, p.windowHeight);
  };

  function stepSim(damp) {
    heightNext.begin();
    p.clear();
    p.ortho(-SIM_RES / 2, SIM_RES / 2, -SIM_RES / 2, SIM_RES / 2, -1000, 1000);
    p.shader(simShader);
    simShader.setUniform('uCurrent', heightCur);
    simShader.setUniform('uPrevious', heightPrev);
    simShader.setUniform('uTexel', [1 / SIM_RES, 1 / SIM_RES]);
    simShader.setUniform('uDamping', damp);
    simShader.setUniform('uMaxWaveHeight', MAX_WAVE_HEIGHT);
    p.noStroke();
    p.plane(SIM_RES, SIM_RES); // plane(), not rect() — see file header
    heightNext.end();

    const tmp = heightPrev;
    heightPrev = heightCur;
    heightCur = heightNext;
    heightNext = tmp;
  }

  function stampDrop(u, v, strength, sizeFraction) {
    heightCur.begin();
    // Camera/projection state leaks between p5 framebuffer passes. Always
    // address the 128px simulation grid in its own coordinates, regardless
    // of the preceding table camera or full-size blur pass.
    p.ortho(-SIM_RES / 2, SIM_RES / 2, -SIM_RES / 2, SIM_RES / 2, -1000, 1000);
    p.push();
    p.colorMode(p.RGB, 1);
    p.blendMode(p.ADD);
    p.noStroke();
    p.fill(strength, strength, strength, 1);
    const x = (u - 0.5) * SIM_RES;
    const y = (v - 0.5) * SIM_RES;
    p.circle(x, y, SIM_RES * sizeFraction);
    p.pop();
    heightCur.end();
  }

  p.draw = () => {
    // Poll-and-rebuild instead of trusting p.windowResized — see file
    // header. Cheap check every frame; only reallocates on real change.
    if (p.width !== lastW || p.height !== lastH) {
      rebuildSceneBuffers(p.width, p.height);
    }

    const rainRate = get('rainRate');
    const dropSize = get('dropSize');
    const dropStrength = get('dropStrength');
    const rippleHeight = get('rippleHeight');
    const damp = get('ripplePersistence');
    const simStepsPerSecond = get('simSpeed');
    const tableColor = get('tableColor');
    const highlightColor = get('highlightColor');
    const patternMode = PATTERN_INDEX[get('pattern')] ?? 1;
    const warp = get('patternWarp');
    const blurAmt = get('motionBlur');
    const spinSpeed = get('spinSpeed');
    const horizontalSpin = get('horizontalSpin');
    const tiltDeg = get('tilt');
    const zoomFactor = get('zoom');
    const camDist = TABLE_SIZE * 2.4 / Math.max(zoomFactor, 0.01);

    // Speed is modulatable. Multiplying the entire elapsed frame count by
    // the CURRENT speed makes each beat-sized change jump the table to a
    // different absolute angle and back. Integrate the speed instead so a
    // changed speed only affects future movement. Cap a suspended tab's
    // first delta to avoid an unrelated rotation jump on resume.
    const motionDtMs = Math.min(Math.max(p.deltaTime || 0, 0), 50);
    const angleStep = motionDtMs * (0.002 * 30 / 1000);
    spinAngle = (spinAngle + angleStep * spinSpeed) % p.TWO_PI;
    horizontalAngle = (horizontalAngle + angleStep * horizontalSpin) % p.TWO_PI;

    // ---- regular timed rain (unaffected by audio — see the transient
    // trigger below for the actual audio-reactive splash) ----
    rainTimer += p.deltaTime;
    if (rainTimer >= rainRate) {
      rainTimer = 0;
      stampDrop(
        p.random(0.15, 0.85), p.random(0.15, 0.85),
        dropStrength * p.random(0.6, 1.0), dropSize,
      );
    }

    // ---- audio-reactive splash: a genuine transient trigger, not a
    // continuous scale. Schema-level @mod (right-click Rain rate / Drop
    // strength / Ripple height / Pattern warp / Spin speed / Zoom /
    // Highlight color in the Inspector) is still the primary, general
    // modulation path and is unaffected by this. This is specifically
    // for the "feels synced to the beat" ask — a new drop lands the
    // instant a transient is detected, independent of the regular rain
    // timer, so the visual response tracks the actual audio event
    // instead of waiting up to a full rain-rate interval. ----
    if (transientCooldown > 0) transientCooldown -= p.deltaTime;
    const audioEnergy = readAudioEnergy();
    if (transientCooldown <= 0 && detectTransient(audioEnergy)) {
      transientCooldown = 120; // ms — prevents one hit re-triggering across a few frames
      stampDrop(
        p.random(0.25, 0.75), p.random(0.25, 0.75),
        dropStrength * p.constrain(1 + audioEnergy * 1.5, 0.8, 2.2),
        dropSize * 1.3, // slightly larger than ambient rain — reads as a distinct "hit"
      );
    }

    // ---- fixed-timestep wave sim, decoupled from render fps ----
    const stepMs = 1000 / simStepsPerSecond;
    simAccumulator += p.deltaTime;
    let steps = 0;
    while (simAccumulator >= stepMs && steps < MAX_SIM_STEPS_PER_FRAME) {
      simAccumulator -= stepMs;
      stepSim(damp);
      steps++;
    }
    if (steps === MAX_SIM_STEPS_PER_FRAME) simAccumulator = 0;

    // ---- shaded, height-reactive table into an offscreen scene buffer ----
    freshScene.begin();
    p.clear(0, 0, 0, 1);
    p.camera(0, -camDist * 0.55, camDist * 0.85, 0, 0, 0, 0, 1, 0);
    p.perspective(p.PI / 3, p.width / p.height, camDist * 0.01, camDist * 20);
    p.push();
    // Deliberately NOT calling p.ambientLight()/directionalLight()/
    // pointLight() here — see file header. All lighting is authored
    // directly in TABLE_FRAG.
    p.rotateX(p.radians(90));
    // rotateZ, not rotateY, for Spin speed — verified by matrix derivation,
    // not assumed. After rotateX(90) flattens the table, a SUBSEQUENT
    // rotate operates in the frame AS ALREADY TRANSFORMED: the local Y
    // axis at that point maps to world Z (a horizontal, in-plane axis),
    // and the local Z axis maps to world -Y (vertical). The old
    // rotateY(spin) call was therefore spinning around a horizontal axis
    // — tipping the table end-over-end, exactly the "flips on itself"
    // bug report. rotateZ(spin) here rotates around the vertical axis
    // instead, the correct flat "turntable" spin.
    p.rotateZ(spinAngle);
    // Horizontal spin is a SEPARATE, independent control — deliberately
    // reusing what rotateY does at this point in the transform stack
    // (rotation around the horizontal, in-plane axis) as an intentional
    // second axis, not the accidental one Spin speed used to be.
    p.rotateY(horizontalAngle);
    // *0.6, not the old *0.3 — doubles the effective tilt range per the
    // "increase tilt ability by 1x more" ask, without changing the
    // slider's own displayed 0-30 range.
    p.rotateX(p.radians(tiltDeg * 0.6));

    p.shader(tableShader);
    tableShader.setUniform('uHeight', heightCur);
    tableShader.setUniform('uTexel', [1 / SIM_RES, 1 / SIM_RES]);
    tableShader.setUniform('uTime', p.millis() / 1000);
    tableShader.setUniform('uColorTable', [tableColor.r, tableColor.g, tableColor.b]);
    tableShader.setUniform('uColorHighlight', [highlightColor.r, highlightColor.g, highlightColor.b]);
    tableShader.setUniform('uWarp', warp);
    tableShader.setUniform('uPattern', patternMode);
    tableShader.setUniform('uHeightScale', rippleHeight);
    tableShader.setUniform('uMaxWaveHeight', MAX_WAVE_HEIGHT);
    p.noStroke();
    p.plane(TABLE_SIZE, TABLE_SIZE, MESH_SEG, MESH_SEG);
    p.pop();
    freshScene.end();

    // ---- motion blur accumulation, genuine 2-buffer ping-pong ----
    const readBuf = accumReadIsA ? accumA : accumB;
    const writeBuf = accumReadIsA ? accumB : accumA;

    writeBuf.begin();
    p.clear();
    p.ortho(-p.width / 2, p.width / 2, -p.height / 2, p.height / 2, -1000, 1000);
    p.shader(blurShader);
    blurShader.setUniform('uCurrent', freshScene);
    blurShader.setUniform('uPrevious', readBuf);
    blurShader.setUniform('uDecay', blurAmt);
    p.noStroke();
    p.plane(p.width, p.height); // plane(), not rect() — see file header
    writeBuf.end();
    accumReadIsA = !accumReadIsA;

    // ---- final blit to the visible canvas — plain rect() is fine here,
    // this is p5's own built-in textured-quad path (resetShader()), not
    // a custom shader, and that path is confirmed to populate UVs
    // correctly on its own. ----
    p.clear();
    p.resetShader();
    // The camera and projection used by the simulation and scene buffers
    // can leak into the default framebuffer in p5. Set a known view for
    // this one-to-one screen blit every frame.
    p.resetMatrix();
    p.camera(0, 0, 1, 0, 0, 0, 0, 1, 0);
    p.ortho(-p.width / 2, p.width / 2, -p.height / 2, p.height / 2, -1000, 1000);
    p.noStroke();
    p.rectMode(p.CENTER);
    p.texture(writeBuf);
    p.rect(0, 0, p.width, p.height);
  };

  // Trigger-control event hook — NEEDS LIVE VERIFICATION. Inferred from
  // TriggerControl's `event` field ("event name dispatched to the
  // renderer") and P5Renderer.emit()'s `{type:'event', event}` message,
  // but I don't have the sandbox's own event-dispatch contract to
  // confirm the exact hook name the sketch should implement. If the
  // sandbox calls something other than p.onEvent, wire it up there
  // instead — the logic itself (clear all three height buffers) is
  // correct regardless of how it gets invoked.
  p.onEvent = (eventName) => {
    if (eventName !== 'clear') return;
    [heightCur, heightPrev, heightNext].forEach((fbo) => {
      fbo.begin(); p.clear(); fbo.end();
    });
  };
}

// ------------------------------------------------------------------
// Shaders — identical to the verified spike, ortho()+plane() GPGPU
// passes throughout. See file header for why plane() is load-bearing.
// ------------------------------------------------------------------

const SIM_VERT = `
precision highp float;
attribute vec3 aPosition;
attribute vec2 aTexCoord;
varying vec2 vUv;
uniform mat4 uModelViewMatrix;
uniform mat4 uProjectionMatrix;
void main() {
  vUv = aTexCoord;
  vec4 pos = uModelViewMatrix * vec4(aPosition, 1.0);
  gl_Position = uProjectionMatrix * pos;
}
`;

const SIM_FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uCurrent;
uniform sampler2D uPrevious;
uniform vec2 uTexel;
uniform float uDamping;
uniform float uMaxWaveHeight;
void main() {
  float n  = texture2D(uCurrent, vUv + vec2(0.0,  uTexel.y)).r;
  float s  = texture2D(uCurrent, vUv - vec2(0.0,  uTexel.y)).r;
  float e  = texture2D(uCurrent, vUv + vec2(uTexel.x, 0.0)).r;
  float w  = texture2D(uCurrent, vUv - vec2(uTexel.x, 0.0)).r;
  float prevCenter = texture2D(uPrevious, vUv).r;

  float term = (n + s + e + w) * 0.5;
  float next = clamp((term - prevCenter) * uDamping, -uMaxWaveHeight, uMaxWaveHeight);

  gl_FragColor = vec4(next, next, next, 1.0);
}
`;

const BLUR_FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uCurrent;
uniform sampler2D uPrevious;
uniform float uDecay;
void main() {
  vec3 cur = texture2D(uCurrent, vUv).rgb;
  vec3 prev = texture2D(uPrevious, vUv).rgb;
  gl_FragColor = vec4(mix(cur, prev, uDecay), 1.0);
}
`;

const TABLE_VERT = `
precision highp float;
attribute vec3 aPosition;
attribute vec2 aTexCoord;
attribute vec3 aNormal;

uniform mat4 uModelViewMatrix;
uniform mat4 uProjectionMatrix;
uniform mat3 uNormalMatrix;
uniform sampler2D uHeight;
uniform vec2 uTexel;
uniform float uHeightScale;
uniform float uMaxWaveHeight;

varying vec2 vUv;
varying vec3 vNormal;
varying float vHeight;
varying float vGradMag;

void main() {
  vUv = aTexCoord;

  // Drops can land between fixed simulation ticks. Bound the mesh too so
  // a fresh impulse cannot flash a large triangle for one display frame.
  float h  = clamp(texture2D(uHeight, vUv).r, -uMaxWaveHeight, uMaxWaveHeight);
  float hn = clamp(texture2D(uHeight, vUv + vec2(0.0, uTexel.y)).r, -uMaxWaveHeight, uMaxWaveHeight);
  float hs = clamp(texture2D(uHeight, vUv - vec2(0.0, uTexel.y)).r, -uMaxWaveHeight, uMaxWaveHeight);
  float he = clamp(texture2D(uHeight, vUv + vec2(uTexel.x, 0.0)).r, -uMaxWaveHeight, uMaxWaveHeight);
  float hw = clamp(texture2D(uHeight, vUv - vec2(uTexel.x, 0.0)).r, -uMaxWaveHeight, uMaxWaveHeight);

  vec3 tangentX = vec3(uTexel.x * 2.0, 0.0, (he - hw) * uHeightScale);
  vec3 tangentY = vec3(0.0, uTexel.y * 2.0, (hn - hs) * uHeightScale);
  vec3 n = normalize(cross(tangentX, tangentY));

  vGradMag = length(vec2(he - hw, hn - hs));
  vHeight = h;
  vNormal = normalize(uNormalMatrix * n);

  vec3 displaced = aPosition + vec3(0.0, 0.0, h * uHeightScale);
  vec4 viewPos = uModelViewMatrix * vec4(displaced, 1.0);
  gl_Position = uProjectionMatrix * viewPos;
}
`;

const TABLE_FRAG = `
precision highp float;
varying vec2 vUv;
varying vec3 vNormal;
varying float vHeight;
varying float vGradMag;

uniform float uTime;
uniform vec3 uColorTable;
uniform vec3 uColorHighlight;
uniform float uWarp;
uniform int uPattern;

vec3 acesApprox(vec3 x) {
  float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

float patternValue(vec2 uv, float warpPhase) {
  if (uPattern == 1) {
    float p = uv.y * 40.0 + uTime * 0.6 + warpPhase;
    return smoothstep(0.4, 0.6, fract(p));
  } else if (uPattern == 2) {
    vec2 c = uv - 0.5;
    float r = length(c) * 30.0 - uTime * 1.2 + warpPhase;
    return smoothstep(0.4, 0.6, fract(r));
  }
  // Solid: 0.0, not 0.5. The old 0.5 permanently mixed table and
  // highlight 50/50 across the ENTIRE surface regardless of wave
  // activity — table color never actually showed as a distinct base,
  // which is exactly the "colors blending instead of having distinct
  // jobs" complaint. 0.0 makes table color the true, undiluted base;
  // highlight now only enters via crestMix below, tied to real height/
  // gradient — i.e. only where a wave actually is.
  return 0.0;
}

void main() {
  vec3 N = normalize(vNormal);
  vec3 L1 = normalize(vec3(0.4, -1.0, -0.6));
  vec3 V = vec3(0.0, 0.0, 1.0);

  float diffuse = max(dot(N, -L1), 0.0);
  vec3 H = normalize(-L1 + V);
  // Dual specular ("clearcoat" trick) — a tight, bright glint plus a
  // broader, softer sheen underneath it. A single narrow specular term
  // (the old pow(...,48.0) alone) reads as a hard plastic dot rather
  // than a wet/glassy surface; layering a second, wide, low-intensity
  // lobe under it is the standard cheap way to fake the clearcoat look
  // the original reference material was going for (MeshPhysicalMaterial
  // clearcoat: 1.0) without an actual second render pass.
  float specTight = pow(max(dot(N, H), 0.0), 64.0);
  float specWide = pow(max(dot(N, H), 0.0), 6.0) * 0.25;
  float spec = specTight + specWide;

  // Fresnel rim — view-dependent edge brightening, tied to the highlight
  // color specifically. This gives highlight color a SECOND distinct
  // job (rim/edge accent, on top of "wave crest" below) reinforcing that
  // the two colors do different things rather than reading as one
  // blended surface color.
  float fresnel = pow(1.0 - max(dot(N, V), 0.0), 3.0);

  // Wider AO range for real light/shadow separation — the old
  // 0.4..1.15 range read flat under most lighting angles. Troughs now
  // go noticeably darker, crests noticeably brighter.
  float ao = clamp(0.55 + vHeight * 0.9, 0.22, 1.3);

  float warpPhase = vHeight * uWarp * 6.0 + vGradMag * uWarp * 10.0;
  float pat = patternValue(vUv, warpPhase);

  vec3 base = mix(uColorTable, uColorHighlight, pat);
  // smoothstep, not a raw linear clamp — the old version had a visible
  // "seam" where the ramp hit its 0/1 ceiling abruptly. smoothstep's
  // S-curve eases into and out of the transition instead of clipping,
  // which is what "not fluidly blending / smooth gradient meshing" was
  // actually describing.
  float crestMixRaw = clamp(vHeight * 1.5 + vGradMag * 3.0, 0.0, 1.0);
  float crestMix = smoothstep(0.0, 1.0, crestMixRaw);
  base = mix(base, uColorHighlight, crestMix * 0.85);

  // Specular tinted toward highlight color rather than raw white — pure
  // vec3(spec) reads as a hard plastic/CG artifact ("you're placing
  // white in there"); a real wet surface's highlight picks up some of
  // the surrounding color instead of being colorless.
  vec3 specColor = mix(vec3(1.0), uColorHighlight, 0.45);

  vec3 lit = base * (0.25 + diffuse * 0.9) * ao
    + specColor * spec * 0.7
    + uColorHighlight * fresnel * 0.18;
  vec3 toned = acesApprox(lit * 1.4);
  vec3 gammaCorrected = pow(toned, vec3(1.0 / 2.2));

  gl_FragColor = vec4(gammaCorrected, 1.0);
}
`;
