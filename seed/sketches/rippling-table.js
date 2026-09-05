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

  let simShader, tableShader, blurShader;
  let heightCur, heightPrev, heightNext;
  let freshScene, accumA, accumB;
  let accumReadIsA = true;
  let simAccumulator = 0;
  let rainTimer = 0;
  let lastW = -1, lastH = -1;

  // Audio tap — HIGHEST-UNCERTAINTY piece of this file, flagged in
  // PLACEMENT.md. Guarded defensively so a missing/renamed bridge
  // function no-ops instead of crashing the sketch (which would trip
  // the sandbox's heartbeat watchdog and tear the tile down). Confirm
  // the real p.getAudioWaveform() contract against public/sandbox/
  // index.html before relying on this.
  function readAudioEnergy() {
    if (typeof p.getAudioWaveform !== 'function') return 0;
    const wf = p.getAudioWaveform();
    if (!wf || !wf.length) return 0;
    let sum = 0;
    for (let i = 0; i < wf.length; i++) sum += Math.abs(wf[i]);
    return sum / wf.length; // rough RMS-ish energy, 0..~1
  }

  function rebuildSceneBuffers(w, h) {
    const opts = { width: w, height: h, textureFiltering: p.NEAREST, density: 1 };
    freshScene = p.createFramebuffer(opts);
    accumA = p.createFramebuffer(opts);
    accumB = p.createFramebuffer(opts);
    lastW = w;
    lastH = h;
  }

  p.setup = () => {
    const cnv = p.createCanvas(p.width || 400, p.height || 400, p.WEBGL);
    p.pixelDensity(1);

    simShader = p.createShader(SIM_VERT, SIM_FRAG);
    tableShader = p.createShader(TABLE_VERT, TABLE_FRAG);
    blurShader = p.createShader(SIM_VERT, BLUR_FRAG);

    const heightOpts = {
      width: SIM_RES, height: SIM_RES,
      textureFiltering: p.NEAREST, density: 1, format: p.FLOAT,
    };
    heightCur = p.createFramebuffer(heightOpts);
    heightPrev = p.createFramebuffer(heightOpts);
    heightNext = p.createFramebuffer(heightOpts);
    [heightCur, heightPrev, heightNext].forEach((fbo) => {
      fbo.begin(); p.clear(); fbo.end();
    });

    rebuildSceneBuffers(p.width, p.height);
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
    const tiltDeg = get('tilt');
    const zoomFactor = get('zoom');
    const camDist = TABLE_SIZE * 2.4 / Math.max(zoomFactor, 0.01);

    // ---- audio-reactive rain (schema-level @mod is the primary path —
    // right-click Rain rate / Drop strength / Ripple height / Pattern
    // warp / Spin speed / Zoom / Highlight color in the Inspector to
    // assign mic, track, or LFO. This is a SECOND, direct tap for a more
    // immediate "splash on transient" feel layered on top. ----
    const audioEnergy = readAudioEnergy();
    const effectiveRainRate = audioEnergy > 0
      ? rainRate * p.constrain(1 - audioEnergy * 0.8, 0.15, 1)
      : rainRate;
    const effectiveDropStrength = dropStrength * (1 + audioEnergy * 0.6);

    rainTimer += p.deltaTime;
    if (rainTimer >= effectiveRainRate) {
      rainTimer = 0;
      stampDrop(
        p.random(0.15, 0.85), p.random(0.15, 0.85),
        effectiveDropStrength * p.random(0.6, 1.0), dropSize,
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
    p.rotateY(p.frameCount * 0.002 * spinSpeed);
    p.rotateX(p.radians(tiltDeg * 0.3));

    p.shader(tableShader);
    tableShader.setUniform('uHeight', heightCur);
    tableShader.setUniform('uTexel', [1 / SIM_RES, 1 / SIM_RES]);
    tableShader.setUniform('uTime', p.millis() / 1000);
    tableShader.setUniform('uColorTable', [tableColor.r, tableColor.g, tableColor.b]);
    tableShader.setUniform('uColorHighlight', [highlightColor.r, highlightColor.g, highlightColor.b]);
    tableShader.setUniform('uWarp', warp);
    tableShader.setUniform('uPattern', patternMode);
    tableShader.setUniform('uHeightScale', rippleHeight);
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
void main() {
  float n  = texture2D(uCurrent, vUv + vec2(0.0,  uTexel.y)).r;
  float s  = texture2D(uCurrent, vUv - vec2(0.0,  uTexel.y)).r;
  float e  = texture2D(uCurrent, vUv + vec2(uTexel.x, 0.0)).r;
  float w  = texture2D(uCurrent, vUv - vec2(uTexel.x, 0.0)).r;
  float prevCenter = texture2D(uPrevious, vUv).r;

  float term = (n + s + e + w) * 0.5;
  float next = (term - prevCenter) * uDamping;

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

varying vec2 vUv;
varying vec3 vNormal;
varying float vHeight;
varying float vGradMag;

void main() {
  vUv = aTexCoord;

  float h  = texture2D(uHeight, vUv).r;
  float hn = texture2D(uHeight, vUv + vec2(0.0, uTexel.y)).r;
  float hs = texture2D(uHeight, vUv - vec2(0.0, uTexel.y)).r;
  float he = texture2D(uHeight, vUv + vec2(uTexel.x, 0.0)).r;
  float hw = texture2D(uHeight, vUv - vec2(uTexel.x, 0.0)).r;

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
  return 0.5;
}

void main() {
  vec3 N = normalize(vNormal);
  vec3 L1 = normalize(vec3(0.4, -1.0, -0.6));
  vec3 V = vec3(0.0, 0.0, 1.0);

  float diffuse = max(dot(N, -L1), 0.0);
  vec3 H = normalize(-L1 + V);
  float spec = pow(max(dot(N, H), 0.0), 48.0);

  float ao = clamp(0.75 + vHeight * 0.6, 0.4, 1.15);

  float warpPhase = vHeight * uWarp * 6.0 + vGradMag * uWarp * 10.0;
  float pat = patternValue(vUv, warpPhase);

  vec3 base = mix(uColorTable, uColorHighlight, pat);
  float crestMix = clamp(vHeight * 1.5 + vGradMag * 3.0, 0.0, 1.0);
  base = mix(base, uColorHighlight, crestMix * 0.6);

  vec3 lit = base * (0.25 + diffuse * 0.9) * ao + vec3(spec) * 0.6;
  vec3 toned = acesApprox(lit * 1.4);
  vec3 gammaCorrected = pow(toned, vec3(1.0 / 2.2));

  gl_FragColor = vec4(gammaCorrected, 1.0);
}
`;
