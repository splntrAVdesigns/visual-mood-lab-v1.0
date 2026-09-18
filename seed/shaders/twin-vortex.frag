#version 300 es
precision highp float;

/*
 * twin-vortex — sibling to vortex-bloom.frag, same per-layer spiral-fold
 * technique (polar N-fold segment with a 1/r inward twist and phase-
 * banded tendrils), run twice as two independent layers with their own
 * fold count, spiral amount, spin direction/speed, band frequency and
 * scroll speed, then screen-blended together with a single shared hot
 * core. The counter-rotation between two differently-folded layers is
 * what produces the shifting moiré read — no single-layer parameter
 * reproduces it, which is why this is a separate file rather than a
 * preset of vortex-bloom.frag (the same reasoning chroma-fracture.frag
 * follows relative to gradient-fold-tunnel.frag).
 *
 * Jag amount and Band sharpness are shared across both layers (rather
 * than doubled into per-layer copies) to keep the control surface sane —
 * the two layers' distinct character comes from fold count, spiral
 * amount, spin and frequency, which is already enough to make them read
 * as clearly independent fields.
 */

uniform float u_time;
uniform vec2 u_resolution;

// Composition
uniform vec2 u_center;            // @label(Center) @range(-1, 1) @group(Composition)
uniform float u_rotation;         // @label(Rotation) @range(-180, 180) @default(0) @unit(deg) @group(Composition)
uniform float u_scale;            // @label(Scale) @range(0.4, 2.5) @default(1.0) @group(Composition)

// Layer A
uniform int u_foldCountA;         // @label(Layer A fold count) @range(4, 16) @default(9) @nomod
uniform float u_spiralAmountA;    // @label(Layer A spiral amount) @range(0.2, 4.0) @default(1.6) @mod
uniform float u_spinSpeedA;       // @label(Layer A spin speed) @range(-2, 2) @default(0.4) @mod
uniform float u_freqA;            // @label(Layer A frequency) @range(4, 20) @default(10) @mod
uniform float u_scrollSpeedA;     // @label(Layer A scroll speed) @range(-4, 4) @default(1.3) @mod

// Layer B
uniform int u_foldCountB;         // @label(Layer B fold count) @range(4, 16) @default(7) @nomod
uniform float u_spiralAmountB;    // @label(Layer B spiral amount) @range(0.2, 4.0) @default(1.2) @mod
uniform float u_spinSpeedB;       // @label(Layer B spin speed) @range(-2, 2) @default(-0.55) @mod @hint(Defaults opposite in sign to Layer A spin speed — that's what produces the counter-rotation.)
uniform float u_freqB;            // @label(Layer B frequency) @range(4, 20) @default(8) @mod
uniform float u_scrollSpeedB;     // @label(Layer B scroll speed) @range(-4, 4) @default(-1.0) @mod

// Shared band shaping
uniform float u_jagAmount;        // @label(Jag amount) @range(0, 2) @default(1.0) @mod
uniform float u_bandSharpness;    // @label(Band sharpness) @range(0.5, 4) @default(2.3) @mod

// Color
uniform vec3 u_colorDeep;         // @label(Deep) @color @default(0.0, 0.01, 0.02)
uniform vec3 u_colorA;            // @label(Layer A color) @color @default(0.15, 0.7, 0.65)
uniform vec3 u_colorB;            // @label(Layer B color) @color @default(0.85, 0.15, 0.6)
uniform vec3 u_coreColor;         // @label(Core color) @color @default(1.0, 0.95, 1.0)
uniform float u_coreSize;         // @label(Core size) @range(4, 30) @default(12)
uniform float u_coreBrightness;   // @label(Core brightness) @range(0, 3) @default(1.2) @mod
uniform float u_vignette;         // @label(Vignette) @range(0, 1) @default(1.0)

out vec4 fragColor;

mat2 rot2(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

float layer(vec2 uv, float foldCount, float spiralAmount, float spinSpeed, float freq, float scrollSpeed, float jagAmount, float sharpness) {
  float r = length(uv);
  float ang = atan(uv.y, uv.x);
  float spiralTwist = spiralAmount / (r + 0.18) - u_time * spinSpeed;
  float seg = 6.2831853 / max(foldCount, 3.0);
  float a = mod(ang + spiralTwist, seg);
  a = abs(a - seg * 0.5);

  float jag = (sin(a * 14.0 + u_time * 0.8) * 0.06 + sin(a * 23.0 - u_time * 1.1) * 0.03) * jagAmount;
  float warp = sin(r * 8.0 + a * 3.0 + u_time * 0.3) * 0.15;
  float phase = r * freq + jag * 5.0 + warp - u_time * scrollSpeed;
  float ph = fract(phase);
  float tri = 1.0 - abs(ph - 0.5) * 2.0;
  return pow(max(tri, 0.0), sharpness);
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / min(u_resolution.x, u_resolution.y);
  uv -= u_center;
  uv /= max(u_scale, 0.001);
  uv = rot2(radians(u_rotation)) * uv;

  float r = length(uv);
  float a = layer(uv, float(max(u_foldCountA, 3)), u_spiralAmountA, u_spinSpeedA, u_freqA, u_scrollSpeedA, u_jagAmount, u_bandSharpness);
  float b = layer(uv, float(max(u_foldCountB, 3)), u_spiralAmountB, u_spinSpeedB, u_freqB, u_scrollSpeedB, u_jagAmount, u_bandSharpness);

  vec3 colA = u_colorA * a;
  vec3 colB = u_colorB * b;

  // Screen-blend deep background with both layers together in one
  // formula, same as chroma-fracture.frag, so overlapping bright regions
  // never blow out past white as the two folds cross each other.
  vec3 col = 1.0 - (1.0 - u_colorDeep) * (1.0 - colA) * (1.0 - colB);

  float core = exp(-r * r * u_coreSize);
  col += u_coreColor * core * u_coreBrightness;

  float vigMin = mix(1.0, 0.4, u_vignette);
  float vig = smoothstep(1.4, 0.3, r);
  col *= mix(vigMin, 1.0, vig);

  fragColor = vec4(col, 1.0);
}
