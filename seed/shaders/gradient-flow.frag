#version 300 es
precision highp float;

/*
 * gradient-flow — a soft, large-scale ambient gradient built from a
 * handful of drifting colour anchors, blended smoothly by distance.
 *
 * This library's other gradient tiles (Liquid Gradient, Liquid Panel)
 * are built on domain-warped fbm noise — genuinely liquid, turbulent,
 * lava-lamp motion. This is the deliberate opposite: no noise field at
 * all. A small number of anchor points drift along slow, smooth
 * sine/cosine paths (not noise-driven — smooth, composed motion reads
 * as designed rather than organic), and every pixel's colour is just an
 * inverse-distance-weighted blend of however many anchors are near it.
 * That combination — few anchors, smooth motion, no turbulence — is
 * what gives it the calm, "ambient product-page gradient" character
 * rather than a liquid one.
 *
 * Grain is a real multi-mode system, not a single dither pass — see
 * grainFor() below for what each of the 5 modes actually does
 * differently, and why plain per-pixel white noise was flagged as not
 * reading as genuine grain to begin with.
 */

uniform float u_time;
uniform vec2 u_resolution;

uniform int u_anchorCount;      // @label(Anchor count) @range(2, 12) @default(5)
uniform float u_softness;       // @label(Blend softness) @range(0.5, 4) @default(1.6) @mod @hint(Higher values blend anchors more gradually into each other.)
uniform float u_scale;          // @label(Scale) @range(0.33, 3) @default(1) @mod @hint(Zooms the whole pattern in or out.)
uniform float u_driftSpeed;     // @label(Drift speed) @range(0, 2) @default(0.12) @mod
uniform float u_driftRadius;    // @label(Drift radius) @range(0.1, 1.3) @default(0.55) @hint(How far each anchor wanders from its resting position.)

uniform vec3 u_colorA;          // @label(Color A) @color @default(1.0, 0.4, 0.2)
uniform vec3 u_colorB;          // @label(Color B) @color @default(0.15, 0.2, 0.95)
uniform vec3 u_colorC;          // @label(Color C) @color @default(1.0, 0.85, 0.15)
uniform vec3 u_colorD;          // @label(Color D) @color @default(0.9, 0.15, 0.6)
uniform vec3 u_bg;              // @label(Background) @color @default(0.04, 0.04, 0.08)

uniform int u_grainType;        // @label(Grain style) @select(Classic=0 | Fine Film=1 | Coarse Analog=2 | Paper Fiber=3 | Halftone Stipple=4) @default(0)
uniform float u_grain;          // @label(Grain amount) @range(0, 0.08) @default(0.02) @advanced @hint(Also helps avoid visible banding across such large smooth colour areas, regardless of style.)

out vec4 fragColor;

float hash1(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }

float valueNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash1(i), hash1(i + vec2(1.0, 0.0)), u.x),
             mix(hash1(i + vec2(0.0, 1.0)), hash1(i + vec2(1.0, 1.0)), u.x), u.y);
}

/*
 * Five genuinely different textures, not one dither pass with a label
 * change. Plain fract(sin(...)) per pixel — the original — is spectrally
 * flat white noise: every pixel independent of its neighbours, which is
 * NOT what real film grain looks like (real grain has spatial
 * correlation, actual clumped particles of a characteristic size) and is
 * why it read as "a different kind of texture," not grain.
 *
 *   0 Classic       — triangular-PDF dither (sum of two independent
 *                      uniform samples), the standard, correct dithering
 *                      technique — still per-pixel and fine-grained, but
 *                      its distribution is the one real dither/grain
 *                      algorithms actually use, not flat uniform noise.
 *   1 Fine Film     — small-scale value noise, genuinely clustered at a
 *                      photographic-grain size instead of independent
 *                      per pixel.
 *   2 Coarse Analog — the same clustering at a larger scale, like pushed
 *                      high-ISO film or old analog video noise.
 *   3 Paper Fiber   — anisotropic (x/y stretched differently) value
 *                      noise, reading as a directional fibre/canvas
 *                      texture rather than isotropic grain.
 *   4 Halftone Stipple — a structured, rotated dot grid rather than
 *                      randomness at all — a print-texture overlay, the
 *                      one deliberately non-random option of the five.
 */
float grainFor(vec2 fragCoord, int mode) {
  if (mode == 0) {
    float a = hash1(fragCoord);
    float b = hash1(fragCoord + vec2(37.0, 91.0));
    return (a + b) * 0.5 - 0.5;
  }
  if (mode == 1) {
    return valueNoise(fragCoord * 0.9) - 0.5;
  }
  if (mode == 2) {
    return valueNoise(fragCoord * 0.28) - 0.5;
  }
  if (mode == 3) {
    return valueNoise(fragCoord * vec2(0.15, 1.1)) - 0.5;
  }
  // Halftone stipple: a dot grid rotated 22 degrees off-axis (the
  // classic print-screen angle, avoiding an axis-aligned grid that would
  // moire against the pixel grid itself).
  mat2 rot = mat2(0.927, -0.375, 0.375, 0.927);
  vec2 grid = rot * fragCoord * 0.35;
  vec2 cellUv = fract(grid) - 0.5;
  float dotHash = hash1(floor(grid));
  float r = 0.2 + dotHash * 0.25;
  float d = length(cellUv) - r;
  return 1.0 - smoothstep(-0.05, 0.05, d) - 0.5;
}

void main() {
  vec2 uv = ((gl_FragCoord.xy - 0.5 * u_resolution) / min(u_resolution.x, u_resolution.y)) / max(u_scale, 0.01);

  int count = clamp(u_anchorCount, 2, 12);

  vec3 colSum = vec3(0.0);
  float weightSum = 0.0;

  for (int i = 0; i < 12; i++) {
    if (i >= count) break;
    float fi = float(i);
    float seed = hash1(vec2(fi * 12.9, fi * 7.3));
    float seed2 = hash1(vec2(fi * 3.7, fi * 21.1));

    // Explicit branching rather than indexing a local array by a
    // non-constant loop variable — dynamically-indexed local arrays in
    // a fragment shader are a real portability risk on some GPU/driver
    // combinations, not just a style choice. Extended to 12 anchors by
    // deriving the extra 8 from blends of the 4 base colours at
    // different ratios, rather than exposing 12 separate colour
    // pickers.
    vec3 anchorColor;
    if (i == 0) anchorColor = u_colorA;
    else if (i == 1) anchorColor = u_colorB;
    else if (i == 2) anchorColor = u_colorC;
    else if (i == 3) anchorColor = u_colorD;
    else if (i == 4) anchorColor = mix(u_colorA, u_colorC, 0.5);
    else if (i == 5) anchorColor = mix(u_colorB, u_colorD, 0.5);
    else if (i == 6) anchorColor = mix(u_colorA, u_colorB, 0.5);
    else if (i == 7) anchorColor = mix(u_colorC, u_colorD, 0.5);
    else if (i == 8) anchorColor = mix(u_colorA, u_colorD, 0.3);
    else if (i == 9) anchorColor = mix(u_colorB, u_colorC, 0.3);
    else if (i == 10) anchorColor = mix(u_colorA, u_colorD, 0.7);
    else anchorColor = mix(u_colorB, u_colorC, 0.7);

    vec2 rest = vec2(cos(fi * 2.4 + 1.0), sin(fi * 1.7 + 2.0)) * mix(0.2, 0.6, seed);
    vec2 drift = vec2(
      sin(u_time * u_driftSpeed * (0.6 + seed * 0.5) + fi * 3.1),
      cos(u_time * u_driftSpeed * (0.5 + seed2 * 0.6) + fi * 1.9)
    ) * u_driftRadius * 0.4;

    vec2 pos = rest + drift;
    float d = length(uv - pos);

    // Inverse-distance weighting with a soft power curve — this, not a
    // noise field, is what does all of the blending work here.
    float weight = 1.0 / pow(d + 0.15, u_softness * 2.0);
    colSum += anchorColor * weight;
    weightSum += weight;
  }

  vec3 col = weightSum > 0.0 ? colSum / weightSum : u_bg;
  // Anchors dominate only within their own neighbourhood; far from all
  // of them the blend fades back toward the background rather than
  // holding full saturation everywhere off to infinity.
  float coverage = clamp(weightSum * 0.35, 0.0, 1.0);
  col = mix(u_bg, col, coverage);

  col += grainFor(gl_FragCoord.xy, clamp(u_grainType, 0, 4)) * u_grain;

  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
