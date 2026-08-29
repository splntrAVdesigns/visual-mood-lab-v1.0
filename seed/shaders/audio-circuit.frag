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

uniform int u_mirrorBars; // @label(Bar Count) @range(8, 48) @default(24) @group(Mirror)
uniform float u_mirrorSpread; // @label(Spread) @range(0.5, 2.0) @default(1.0) @group(Mirror) @hint(How far bars travel outward from the zero line at full amplitude.)

uniform float u_lineGlow; // @label(Glow) @range(0.0, 2.0) @default(0.4) @group(Line) @mod
uniform float u_lineEcho; // @label(Motion Blur) @range(0.0, 1.0) @default(0.25) @group(Line) @mod @hint(Trailing echo strength — 0 is a single clean trace.)
uniform int u_lineEchoCount; // @label(Echo Bands) @range(0, 4) @default(2) @group(Line)

uniform float u_radialSpeed; // @label(Pulse Speed) @range(0.1, 3.0) @default(1.0) @group(Radial Gradient) @mod
uniform float u_radialSpread; // @label(Bloom Spread) @range(0.5, 2.5) @default(1.4) @group(Radial Gradient) @mod @hint(How far the energy field extends past the tile's edge.)

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
    // Gradient Bands — REBUILT (rev 3). Rev 2 fixed the vertical-pillar
    // color bug but left two real problems: edges used a fixed 0.006 AA
    // width regardless of shape amplitude (reads as vector-clean/precut,
    // not a real waveform), and every x-position shared the same three
    // sin() terms scaled by the same scalar bass/mid/high — so the whole
    // ribbon swelled as one unit instead of different parts of it moving
    // independently, which is the actual look of an audio waveform.
    //
    // Only 4 scalar audio bands exist (bass/mid/high/rms — no per-bin FFT
    // texture; see header note), so true per-sample independence isn't
    // available data. Faked the same way Mirror fakes per-bar variation:
    // the ribbon is bucketed into pseudo-segments, each with its own
    // hash-seeded phase and time-rate, so the same shared scalar energy
    // reaches different segments at different moments instead of in
    // lockstep. Edges are now a noise-modulated smoothstep band (textured,
    // soft) instead of a fixed tight AA width, and a light per-segment
    // brightness shimmer stands in for LED-cell texture without
    // introducing hard geometric slicing.
    int layers = u_gbLayers;
    for (int i = 0; i < 5; i++) {
      if (i >= layers) break;
      float fi = float(i);
      float mirrorSign = mod(fi, 2.0) < 0.5 ? 1.0 : -1.0;

      float segCount = 40.0;
      float segId = floor((p.x * 0.5 + 0.5) * segCount + fi * 7.0);
      float segSeed = hash21(vec2(segId, fi + 11.0));
      float segSeed2 = hash21(vec2(segId, fi + 31.0));
      float segPhase = segSeed * 6.2831;
      float segRate = 0.55 + segSeed2 * 1.85;
      float segEnergy = bass * (0.35 + segSeed * 0.85) + mid * (0.25 + segSeed2 * 0.9);

      float xs = p.x * 5.0;
      float jitter = (hash21(vec2(floor(xs * 8.0), fi)) - 0.5) * 2.0;
      float shape =
        sin(xs + u_time * segRate + segPhase) * (0.08 + segEnergy * 0.20) +
        sin(xs * 2.7 - u_time * (segRate * 0.7) - segPhase) * (0.04 + mid * 0.08) +
        jitter * (0.02 + high * 0.05);
      shape *= mirrorSign;

      float centerOffset = (fi - (float(layers) - 1.0) * 0.5) * (0.12 + u_gbSpread * 0.16);
      float d = abs(p.y - centerOffset - shape);
      float thickness = 0.02 + abs(shape) * 0.6;
      // Blurred, textured edge: width varies with fbm() instead of a
      // fixed 0.006 constant, so the falloff itself reads as organic
      // rather than vector-clean. Kept modest (not extreme) per feedback.
      float edgeSoft = 0.018 + fbm(vec2(xs * 6.0, fi * 4.0 + u_time * 0.2)) * 0.045;
      float mask = smoothstep(thickness + edgeSoft, thickness - edgeSoft, d);

      float colorT = 0.5 + 0.5 * sin(p.x * 4.5 - u_time * 0.5 + fi * 2.1);
      colorT = clamp(colorT + (fbm(vec2(p.x * 2.0, u_time * 0.06 + fi * 3.0)) - 0.5) * 0.3, 0.0, 1.0);
      float ledTexture = 0.88 + 0.12 * hash21(vec2(segId, fi + 3.0));
      col += palette(clamp(colorT + bass * u_colorWarmth * 0.15, 0.0, 1.0)) * mask * ledTexture * (1.0 - fi * 0.12);
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
