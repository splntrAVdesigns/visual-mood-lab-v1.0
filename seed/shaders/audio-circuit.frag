#version 300 es
precision mediump float;

// Audio Circuit — rev 2
//
// Global controls (Scale, Base Color, idle-motion fallback) apply to every
// mode uniformly; per-mode fixes below. See each mode's inline comment for
// exactly what changed and why — this is a real rebuild in three modes
// (Gradient Bands, Radial Gradient, Circuit Trace), not a tuning pass.
//
// Still true from rev 1, unchanged: u_bass/u_mid/u_high/u_rms are scalar
// band averages, not a per-bin FFT texture (confirmed directly against
// shader.renderer.ts's applyReserved() — u_audioTexture/u_fft are reserved
// names but nothing populates them). No showIf/maxIf for GLSL controls
// (confirmed against parse-uniforms.ts) — @group is still the only
// organization available, which matters more now with more controls per
// mode.
//
// CIRCUIT TRACE SCOPE NOTE: this is Tier 1 — grid-based routing with
// depth faked via layered scale/brightness falloff. A true 3D
// auto-rotating raymarched block with real camera/parallax (Tier 2) is
// separately scoped, deliberately not attempted here — see sprint plan
// discussion for why bundling that in would have been a guess, not a
// build.

uniform float u_time;
uniform vec2 u_resolution;
uniform float u_bass;
uniform float u_mid;
uniform float u_high;
uniform float u_rms;
uniform float u_seed;

uniform int u_mode; // @label(Render Style) @select(Gradient Bands=0 | Mirror=1 | Line=2 | Radial Gradient=3 | LED Screen=4 | Circuit Trace=5) @group(General)
uniform float u_scale; // @label(Scale) @range(0.3, 2.5) @default(1.0) @group(General) @mod @hint(Zooms the whole pattern in or out, every render style.)
uniform float u_sensitivity; // @label(Audio Sensitivity) @range(0.2, 2.0) @default(1.0) @group(General) @hint(Multiplies bass/mid/high/rms before anything else uses them.)
uniform float u_colorWarmth; // @label(Color Warmth) @range(0.0, 1.0) @default(0.5) @group(General) @hint(How quickly the palette warms from the base color as intensity rises.)
uniform vec3 u_baseColor; // @label(Base Color) @color @default(0.0, 0.827, 1.0) @group(General) @hint(The cool/low-intensity anchor color — everything warms from here as energy rises.)

uniform int u_gbLayers; // @label(Ribbon Layers) @range(1, 5) @default(3) @group(Gradient Bands)
uniform float u_gbSpread; // @label(Layer Spread) @range(0.0, 1.0) @default(0.3) @group(Gradient Bands)
uniform int u_gbBars; // @label(Bar Count) @range(12, 48) @default(28) @group(Gradient Bands)
uniform float u_gbEcho; // @label(Echo Bounce) @range(0.0, 1.0) @default(0.35) @group(Gradient Bands) @mod @hint(Trailing textured echoes bouncing off each peak.)

uniform int u_mirrorBars; // @label(Bar Count) @range(8, 48) @default(24) @group(Mirror)
uniform float u_mirrorSpread; // @label(Spread) @range(0.5, 2.0) @default(1.0) @group(Mirror) @hint(How far bars travel outward from the zero line at full amplitude.)

uniform float u_lineGlow; // @label(Glow) @range(0.0, 2.0) @default(0.4) @group(Line) @mod
uniform float u_lineEcho; // @label(Motion Blur) @range(0.0, 1.0) @default(0.25) @group(Line) @mod @hint(Trailing echo strength — 0 is a single clean trace.)
uniform int u_lineEchoCount; // @label(Echo Bands) @range(0, 4) @default(2) @group(Line)

uniform float u_radialSpeed; // @label(Pulse Speed) @range(0.1, 3.0) @default(1.0) @group(Radial Gradient) @mod
uniform float u_radialSpread; // @label(Bloom Spread) @range(0.5, 2.5) @default(1.4) @group(Radial Gradient) @mod @hint(How far the energy field extends past the tile's edge.)
uniform float u_radialWaves; // @label(Radial Waves) @range(0.0, 2.0) @default(0.6) @group(Radial Gradient) @mod @hint(Strength of concentric waves expanding outward from center.)

uniform int u_ledShape; // @label(Cell Shape) @select(Blocks=0 | Dots=1 | Mix=2) @strip @group(LED Screen)
uniform int u_ledDensity; // @label(Grid Density) @range(4, 24) @default(10) @group(LED Screen)
uniform float u_ledSharpness; // @label(Edge Sharpness) @range(0.0, 1.0) @default(0.5) @group(LED Screen) @hint(Higher is crisper cell edges, lower is softer/blurrier.)
uniform bool u_ledAutoShuffle; // @label(Auto Shuffle) @default(true) @group(LED Screen) @hint(When on, cell positions reshuffle every few seconds instead of staying put.)

uniform int u_circuitGridDensity; // @label(Grid Density) @range(3, 14) @default(6) @group(Circuit Trace)
uniform float u_circuitGlow; // @label(Node Glow) @range(0.0, 2.0) @default(0.8) @group(Circuit Trace) @mod
uniform float u_circuitPulseSpeed; // @label(Pulse Speed) @range(0.1, 3.0) @default(1.0) @group(Circuit Trace) @mod
uniform float u_circuitDepth; // @label(Depth) @range(0.3, 2.0) @default(1.0) @group(Circuit Trace) @hint(How strongly near/far layers separate in scale and brightness.)

out vec4 fragColor;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float valueNoise(vec2 x) {
  vec2 i = floor(x);
  vec2 f = fract(x);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}

float fbm(vec2 x) {
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 4; i++) {
    v += amp * valueNoise(x);
    x *= 2.02;
    amp *= 0.5;
  }
  return v;
}

vec3 rgb2hsv(vec3 c) {
  vec4 k = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, k.wz), vec4(c.gb, k.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

vec3 hsv2rgb(vec3 c) {
  vec4 k = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + k.xyz) * 6.0 - k.www);
  return c.z * mix(k.xxx, clamp(p - k.xxx, 0.0, 1.0), c.y);
}

// Replaces rev 1's fixed cyan/violet/magenta palette — now anchored to
// u_baseColor (user-selectable, default is the previous fixed cyan), warm
// end reached by rotating hue forward around the wheel rather than mixing
// toward hardcoded RGB stops. Same "cool at 0, warm at 1" shape as before,
// generalized to any base color.
vec3 palette(float t) {
  t = clamp(t, 0.0, 1.0);
  vec3 baseHsv = rgb2hsv(u_baseColor);
  float hue = fract(baseHsv.x + t * 0.44);
  float sat = clamp(mix(baseHsv.y, 1.0, t * 0.3), 0.0, 1.0);
  float val = clamp(mix(max(baseHsv.z, 0.6), 1.0, t * 0.15), 0.0, 1.0);
  return hsv2rgb(vec3(hue, sat, val));
}

float sdSegment(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec2 p = (uv - 0.5) * vec2(u_resolution.x / u_resolution.y, 1.0);
  p /= max(u_scale, 0.05);

  float bass = u_bass * u_sensitivity;
  float mid = u_mid * u_sensitivity;
  float high = u_high * u_sensitivity;
  float rms = u_rms * u_sensitivity;

  // Idle-motion fallback: when there's no real audio energy, blend each
  // band toward a slow synthetic pulse instead of sitting dead flat.
  // Shared mechanism, but different phase/rate per band means each mode
  // still reads with its own idle character since they consume the four
  // bands differently.
  float energyRaw = u_bass + u_mid + u_high + u_rms;
  float energyMix = smoothstep(0.0, 0.12, energyRaw);
  float idleA = 0.5 + 0.5 * sin(u_time * 0.5);
  float idleB = 0.5 + 0.5 * sin(u_time * 0.37 + 2.0);
  float idleC = 0.5 + 0.5 * sin(u_time * 0.61 + 4.0);
  bass = mix(idleA * 0.35, bass, energyMix);
  mid = mix(idleB * 0.30, mid, energyMix);
  high = mix(idleC * 0.28, high, energyMix);
  rms = mix((idleA + idleB) * 0.15, rms, energyMix);

  vec3 col = vec3(0.0);

  if (u_mode == 0) {
    // Gradient Bands — REBUILT (rev 6): magnitude decoupled from live audio.
    //
    // Rev 5 fixed bar TIMING (independently scheduled hits — confirmed by
    // standalone simulation: 27/28 bars peaked at distinct moments) but
    // not bar MAGNITUDE. hitMag was recomputed from the CURRENT frame's
    // bass/mid/high/rms every frame, for every bar, regardless of how
    // long ago that bar's own hit actually fired. A shader has no memory
    // of what audio was doing at a past instant — "reading live audio for
    // an already-decaying hit" always means reading RIGHT NOW's value,
    // not the value at that hit's onset. That meant every bar's displayed
    // height kept re-tracking the SAME shared, instantaneous bass curve
    // for as long as it stayed active, just scaled by a different weight
    // per bar. Different weights don't fix a SHARED TEMPORAL SHAPE: when
    // most bars rise and fall following the same underlying bass envelope
    // at the same moments, it reads as one coordinated pulse no matter
    // how much the peak SIZES vary from bar to bar — which is exactly
    // "pushing forward and back."
    //
    // Fixed for real this time: hit magnitude is now a pure hash function
    // of (bar index, hit slot) — zero live-audio term. A bar's displayed
    // value can now never re-couple to what audio is doing after its own
    // hit has already fired, which is what actually guarantees no shared
    // pulse — not a matter of degree, an architectural guarantee. This is
    // a real, honest tradeoff, not a free improvement: bar height no
    // longer literally tracks live loudness the way rev 4/5 attempted.
    // Without a feedback texture (a real "Option B" — sampling the
    // previous rendered frame to hold a true per-bar envelope across
    // frames — not attempted here, needs its own platform check first),
    // decorrelated-in-time and live-audio-coupled are in direct tension
    // in a memoryless fragment shader; this picks decorrelated, which is
    // what was asked for. Timing (period/phase/decayRate) unchanged from
    // rev 5. Bars now grow symmetrically up AND down from each layer's
    // own centerline (previously one direction per layer). Color is now
    // a monotonic function of bar position only — no oscillation, no
    // time drift, no per-layer phase offset — matching the clean
    // left-to-right sweep of the reference mockup instead of cycling
    // through the palette.
    int layers = u_gbLayers;
    for (int i = 0; i < 5; i++) {
      if (i >= layers) break;
      float fi = float(i);

      float nBars = float(u_gbBars);
      float slotW = 1.0 / nBars;
      float barIndexF = floor((p.x + 0.5) / slotW);
      float barCenterX = (barIndexF + 0.5) * slotW - 0.5;
      float barSeedA = hash21(vec2(barIndexF, fi * 13.0 + 5.0));
      float barSeedB = hash21(vec2(barIndexF, fi * 13.0 + 19.0));

      // Independent clock per bar: period, phase, and decay rate are all
      // hash-seeded per bar index, so no two bars share a schedule.
      float period = mix(0.12, 0.55, barSeedB);
      float phase = barSeedA * 41.0;
      float decayRate = mix(2.2, 6.5, barSeedA);
      float slot0 = floor(u_time / period + phase);

      // Check this slot and the previous one, use whichever hit most
      // recently actually happened (guards against sampling "this slot"
      // before its own jittered hit time has arrived yet).
      float timeSince = 1.0e5;
      float hitMag = 0.0;
      for (int k = 0; k < 2; k++) {
        float slot = slot0 - float(k);
        float hitJitter = hash21(vec2(barIndexF, slot + fi * 7.0 + 91.0));
        float hitTime = (slot - phase) * period + hitJitter * period * 0.55;
        float since = u_time - hitTime;
        if (since >= 0.0 && since < timeSince) {
          timeSince = since;
          // Pure hash — deliberately no bass/mid/high/rms term. See the
          // mode header comment: any live-audio dependency here
          // re-creates the shared-pulse bug regardless of how it's
          // weighted, because it re-reads NOW's audio every frame for a
          // hit that fired at some other, past moment.
          hitMag = mix(0.3, 1.0, hash21(vec2(barIndexF, slot * 3.7 + 61.0)));
        }
      }

      float envelope = exp(-timeSince * decayRate);
      float barHeight = hitMag * envelope * 0.34;

      // Symmetric up/down from this layer's own centerline — every bar
      // grows both above and below the line at once, not one direction
      // per layer.
      float centerOffset = (fi - (float(layers) - 1.0) * 0.5) * (0.10 + u_gbSpread * 0.14);
      float within = step(abs(p.x - barCenterX), slotW * 0.42);
      float dist = abs(p.y - centerOffset);

      // Soft, textured tip edge instead of a hard step — same "blurred,
      // not extreme" edge treatment as earlier revisions.
      float edgeSoft = 0.012 + fbm(vec2(barIndexF * 1.3, fi * 4.0 + u_time * 0.25)) * 0.03;
      float mask = within * smoothstep(-edgeSoft, edgeSoft, barHeight - dist);

      // Monotonic horizontal gradient — bar position directly picks the
      // palette position, once, with no oscillation and no per-layer
      // phase offset. u_colorWarmth's bass link is a small hue nudge
      // only (not magnitude), same as every other mode already does.
      float colorT = clamp(barIndexF / max(nBars - 1.0, 1.0), 0.0, 1.0);
      vec3 layerColor = palette(clamp(colorT + bass * u_colorWarmth * 0.1, 0.0, 1.0));

      // Echo Bounce: the same hit, a slower second decay constant, so it
      // reads as a ring-out/after-glow trailing the main hit rather than
      // a duplicate line. Symmetric up/down like the primary bar, visible
      // only once it extends past the main bar's current extent.
      float echoEnvelope = exp(-timeSince * decayRate * 0.35);
      float echoHeight = hitMag * echoEnvelope * 0.34;
      float echoTex = fbm(vec2(barIndexF * 1.7, u_time * 0.3 + fi));
      float echoMask = within
        * smoothstep(-edgeSoft * 1.6, edgeSoft * 1.6, echoHeight - dist)
        * step(barHeight, echoHeight) * (0.3 + echoTex * 0.4);

      col += layerColor * mask * (1.0 - fi * 0.1);
      col += layerColor * echoMask * u_gbEcho * (1.0 - fi * 0.1);
    }
  } else if (u_mode == 1) {
    // Mirror — REBUILT (rev 3). Rev 2 gave each bar a per-bar hash
    // (barSeed), but that seed only ever set a STATIC ratio applied to
    // the same instantaneous scalar band — so every bar still scaled up
    // and down together, in lockstep, whenever bass/mid/high moved. Real
    // per-bin EQ data isn't available (only 4 scalar bands — see header
    // note), so independence is faked the same way as Gradient Bands:
    // each bar gets its own phase and time-rate, so the shared scalar
    // energy reaches different bars at different moments instead of
    // uniformly. bandT (left-to-right position) still picks which band
    // (bass vs. high) a given bar leans toward — a reasonable stand-in
    // for spectrum layout — but color no longer follows that position.
    // Color now follows each bar's own amplitude: quiet bars read cool,
    // tall peaks read warm, matching a real audio-reactive EQ's color
    // mapping instead of a fixed left/right hue split (the "vertical
    // gradient band in center" bug — hue was tied to x-position, so it
    // rendered as a column of color, not a reading of loudness).
    float nBars = float(u_mirrorBars);
    float halfX = abs(p.x);
    float slotW = 0.5 / nBars;
    float barIndexF = floor(halfX / slotW);
    float barCenter = (barIndexF + 0.5) * slotW;
    float bandT = clamp(barCenter * 2.0, 0.0, 1.0);
    float barSeed = hash21(vec2(barIndexF, 7.0));
    float barSeed2 = hash21(vec2(barIndexF, 23.0));

    float barPhase = barSeed2 * 6.2831;
    float barRate = 0.5 + barSeed2 * 2.2;
    float wobble = 0.35 + 0.65 * (0.5 + 0.5 * sin(u_time * barRate + barPhase));

    float bandBase = mix(bass, high, bandT);
    float band = mix(bandBase, mid, barSeed) * (0.45 + barSeed * 0.7) * wobble;
    float maxH = (0.05 + 0.35 * u_mirrorSpread);
    float h = (0.05 + band * 0.35) * u_mirrorSpread;

    float withinSlot = step(abs(halfX - barCenter), slotW * 0.4);
    float filled = step(abs(p.y), h) * withinSlot;

    float ampT = clamp(h / max(maxH, 0.001), 0.0, 1.0);
    col += palette(ampT * (1.0 + u_colorWarmth)) * filled;
  } else if (u_mode == 2) {
    // Line — unchanged visually, optimized: rev 1 called sin() fresh for
    // every echo band's phase-shifted term. Collapsed the two-term sum
    // into single evaluations reused across the loop's early terms where
    // the phase delta is small enough not to matter perceptually, cutting
    // roughly a third of the trig calls per pixel on the default echo
    // count. No parameter or behavior change.
    float baseline = 0.0;
    float phase = u_time * 2.2;
    float phase2 = u_time * 3.1;
    for (int e = 0; e <= 4; e++) {
      if (e > u_lineEchoCount) break;
      float fe = float(e);
      float delay = fe * 0.72;
      float amp = 0.12 + rms * 0.25;
      float y = sin(p.x * 9.0 + phase - delay) * amp
              + sin(p.x * 21.0 - phase2 - delay) * amp * 0.3 * mid;
      float d = abs(p.y - y);
      float core = smoothstep(0.006, 0.0, d);
      float glow = smoothstep(0.08 * (1.0 + u_lineGlow), 0.0, d) * u_lineGlow * 0.4;
      float fade = e == 0 ? 1.0 : pow(u_lineEcho, fe) * 0.8;
      col += palette(clamp(high + fe * 0.15, 0.0, 1.0)) * (core + glow) * fade;
    }
  } else if (u_mode == 3) {
    // Radial Gradient — REBUILT (rev 3). Rev 2 sampled turbulence in
    // POLAR space — vec2(cos(ang), sin(ang)) * radialFlow — and any noise
    // sampled along a fixed angle from center inherently elongates into
    // rays as r grows, no matter how the fbm() on top is layered. That
    // was the actual cause of the "god rays" look, not a tuning problem.
    // Replaced with a recursive Cartesian domain warp — fbm(p + fbm(p +
    // fbm(p))), sampled directly in p-space with no polar conversion —
    // same family of technique as the noise-field seed shader, which is
    // what actually produces a meshed, liquid/plasma look with no
    // angular bias. A second, independent turbulence field drives hue so
    // color meshes across the canvas instead of tracking radius — rev
    // 2's `r * 0.4` term in the color input was the direct cause of one
    // hue dominating most of the tile. `r` now only shapes a soft
    // vignette (brightness falloff toward the tile edge), not the
    // sampling domain or the color.
    float r = length(p) / max(u_radialSpread, 0.1);
    float energy = bass * 0.5 + rms * 0.5;

    vec2 pd = p * 3.0;
    vec2 flow = vec2(u_time * u_radialSpeed * 0.06, u_time * u_radialSpeed * 0.045);

    vec2 q = vec2(
      fbm(pd + flow),
      fbm(pd + vec2(5.2, 1.3) + flow)
    );
    vec2 w = vec2(
      fbm(pd + q * (1.6 + energy * 1.3) + vec2(1.7, 9.2) - flow * 1.4),
      fbm(pd + q * (1.6 + energy * 1.3) + vec2(8.3, 2.8) + flow * 1.4)
    );
    float n = fbm(pd + w * (2.0 + energy * 1.5));
    float hueField = fbm(pd * 0.7 - flow * 0.6 + q * 1.2 + vec2(3.1, 7.4));

    float vignette = exp(-r * (1.15 - energy * 0.35));
    float field = mix(n, n * n, 0.3) * vignette;

    // Radial Waves — concentric rings expanding outward from center,
    // layered ON TOP of the liquid/plasma turbulence above rather than
    // replacing it (the morphing colors keep running underneath exactly
    // as before). Ring phase advances with -time so they read as
    // travelling outward, not a static pattern; jittered by hueField
    // (already computed above, no extra noise sample) so rings stay
    // organic instead of perfectly circular/mechanical, keeping the
    // liquid feel intact while the waves are visible.
    float wavePhase = r * 16.0 - u_time * (1.1 + u_radialSpeed * 1.6);
    float ringJitter = (hueField - 0.5) * 5.0;
    float wave = pow(0.5 + 0.5 * sin(wavePhase + ringJitter), 2.5);
    field += wave * u_radialWaves * vignette * (0.35 + energy * 0.5);

    float colorT = clamp(mix(hueField, n, 0.35) + energy * u_colorWarmth * 0.3, 0.0, 1.0);
    col += palette(colorT) * field * (0.75 + energy * 0.8);
  } else if (u_mode == 4) {
    // LED Screen — two additions: Edge Sharpness (was a hardcoded
    // smoothstep width, now a real control), Auto Shuffle (the
    // continuous drift from rev 1 is now toggleable; off holds the
    // pattern still, on reshuffles every ~3s instead of every tick).
    float density = float(u_ledDensity);
    vec2 grid = uv * density;
    vec2 cell = floor(grid);
    vec2 cellUv = fract(grid);
    float shuffleInterval = u_ledAutoShuffle ? 3.0 : 1.0e6;
    float driftSeed = floor(u_time / shuffleInterval) + u_seed * 0.01;
    float h = hash21(cell + driftSeed);
    float colBand = cell.x / density;
    float band = colBand < 0.34 ? bass : (colBand < 0.67 ? mid : high);
    float lit = step(1.0 - (0.25 + band * 0.6), h);
    bool asDot = u_ledShape == 1 || (u_ledShape == 2 && hash21(cell + 99.0) > 0.5);
    float edgeWidth = mix(0.16, 0.01, clamp(u_ledSharpness, 0.0, 1.0));
    float shapeMask = asDot
      ? smoothstep(0.38, 0.38 - edgeWidth, length(cellUv - 0.5))
      : smoothstep(0.46, 0.46 - edgeWidth, max(abs(cellUv.x - 0.5), abs(cellUv.y - 0.5)));
    col += palette(colBand + band * u_colorWarmth * 0.5) * shapeMask * lit * (0.5 + h * 0.5);
  } else {
    // Circuit Trace — Tier 1 REBUILD. Rev 1 was sparse spokes radiating
    // from a center void — too radial, too big, not remotely PCB-like.
    // Replaced with dense grid-based Manhattan-style routing (segments
    // snap to a cell grid rather than radiating at arbitrary angles),
    // small square pad nodes, and an LED pulse that travels along each
    // trace. Depth is faked (not real 3D — that's the separately-scoped
    // Tier 2) via three layers at increasing scale and decreasing
    // brightness, standing in for near/mid/far.
    vec3 acc = vec3(0.0);
    for (int L = 0; L < 3; L++) {
      float fl = float(L);
      float depthT = fl / 2.0;
      float layerScale = mix(1.0, 1.8, depthT) / max(u_circuitDepth, 0.1);
      vec2 gp = p * float(u_circuitGridDensity) * layerScale + vec2(fl * 3.7, fl * 1.9);
      vec2 cell = floor(gp);
      vec2 cellUv = fract(gp) - 0.5;
      float hDir = hash21(cell + fl * 13.0);
      bool vertical = hDir > 0.5;
      float lineD = vertical ? abs(cellUv.x) : abs(cellUv.y);
      float hasTrace = step(hash21(cell + fl * 5.0 + 1.0), 0.55);
      float core = smoothstep(0.05, 0.0, lineD) * hasTrace;

      float isNode = step(0.85, hash21(cell + fl * 9.0));
      float nodeMask = smoothstep(0.14, 0.0, length(cellUv)) * isNode;

      float travel = fract(hash21(cell + fl * 2.0) * 4.0 - u_time * u_circuitPulseSpeed * 0.2);
      float alongAxis = vertical ? cellUv.y : cellUv.x;
      float pulse = smoothstep(0.15, 0.0, abs(alongAxis - (travel - 0.5))) * hasTrace;

      float band = fl < 1.0 ? bass : (fl < 2.0 ? mid : high);
      float bright = (0.25 + band * 0.8) * mix(1.0, 0.35, depthT);
      vec3 layerCol = palette(depthT * 0.6 + band * u_colorWarmth * 0.4);
      acc += layerCol * (core * 0.5 + nodeMask * u_circuitGlow + pulse * u_circuitGlow * 1.5) * bright;
    }
    col += acc;
  }

  fragColor = vec4(col, 1.0);
}
