#version 300 es
precision highp float;

/*
 * chroma-fracture — sibling to gradient-fold-tunnel.frag, same per-layer
 * fold/band/warp technique, but run twice: two independent dihedral-fold
 * gradient fields, each with its own fold angle, spin direction, spin
 * speed, band frequency and scroll speed, screen-blended together. The
 * counter-rotation is what makes this a genuinely different file rather
 * than a preset of Gradient Fold Tunnel — a single-layer shader has no
 * parameter that produces this moiré-interference read, since it comes
 * specifically from two independently-rotating fold axes overlapping.
 *
 * Layer A and Layer B share the same layer() function; they're
 * distinguished purely by the arguments passed in, so tuning one layer
 * to feel calmer/faster than the other is just spin/frequency deltas,
 * not different code paths.
 */

uniform float u_time;
uniform vec2 u_resolution;

// Composition
uniform vec2 u_center;          // @label(Center) @range(-1, 1) @group(Composition)
uniform float u_rotation;       // @label(Rotation) @range(-180, 180) @default(0) @unit(deg) @group(Composition)
uniform float u_scale;          // @label(Scale) @range(0.4, 2.5) @default(1.0) @group(Composition)

// Layer A
uniform float u_weightA;        // @label(Layer A fold angle) @range(0.1, 0.9) @default(0.62)
uniform float u_spinA;          // @label(Layer A spin speed) @range(-1, 1) @default(0.18) @mod
uniform float u_freqA;          // @label(Layer A frequency) @range(3, 20) @default(8) @mod
uniform float u_scrollA;        // @label(Layer A scroll speed) @range(-4, 4) @default(1.3) @mod

// Layer B
uniform float u_weightB;        // @label(Layer B fold angle) @range(0.1, 0.9) @default(0.45)
uniform float u_spinB;          // @label(Layer B spin speed) @range(-1, 1) @default(-0.25) @mod @hint(Defaults opposite in sign to Layer A spin speed — that's what produces the counter-rotation.)
uniform float u_freqB;          // @label(Layer B frequency) @range(3, 20) @default(6) @mod
uniform float u_scrollB;        // @label(Layer B scroll speed) @range(-4, 4) @default(-1.0) @mod

// Shared band shaping
uniform float u_bandVariety;    // @label(Band variety) @range(0, 2) @default(1.0) @mod @hint(Organic warp applied to both layers' band spacing.)
uniform float u_bandSharpness;  // @label(Band sharpness) @range(0.5, 4) @default(1.5) @mod

// Color
uniform vec3 u_colorA;          // @label(Layer A color) @color @default(0.75, 0.15, 1.0)
uniform vec3 u_colorB;          // @label(Layer B color) @color @default(0.25, 0.6, 1.0)
uniform vec3 u_bg;              // @label(Background) @color @default(0.02, 0.0, 0.05)

out vec4 fragColor;

float hash1(float x) { return fract(sin(x * 127.1) * 43758.5453); }
mat2 rot2(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

float layer(vec2 uv, float weight, float spin, float freq, float scroll, float variety, float sharpness) {
  vec2 p = rot2(u_time * spin) * uv;
  vec2 fp = abs(p);
  float w = clamp(weight, 0.05, 0.95);
  float stripe = fp.x * w + fp.y * (1.0 - w);

  float warp = sin(stripe * 1.6 + u_time * 0.05) * (0.6 * variety)
             + sin(stripe * 0.7 - u_time * 0.03) * (0.4 * variety);
  float phase = stripe * freq - u_time * scroll + warp;

  // Offsetting the hash seed by `weight` gives Layer A and Layer B
  // independent per-band duty-cycle streams even when their fold
  // angles happen to coincide, so the two layers never lock into an
  // identical band rhythm.
  float bandId = floor(phase);
  float ph = fract(phase);
  float duty = mix(0.3, 0.9, hash1(bandId * 3.13 + weight * 97.0));
  float edge = (1.0 - duty) * 0.5;
  float gap = smoothstep(0.0, max(edge, 0.01), ph) * smoothstep(1.0, 1.0 - max(edge, 0.01), ph);
  float tri = clamp(1.0 - abs(ph - 0.5) * 2.0 / max(duty, 0.05), 0.0, 1.0);
  return pow(tri, sharpness) * gap;
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / min(u_resolution.x, u_resolution.y);
  uv -= u_center;
  uv /= max(u_scale, 0.001);
  uv = rot2(radians(u_rotation)) * uv;

  float a = layer(uv, u_weightA, u_spinA, u_freqA, u_scrollA, u_bandVariety, u_bandSharpness);
  float b = layer(uv, u_weightB, u_spinB, u_freqB, u_scrollB, u_bandVariety, u_bandSharpness);

  vec3 colA = u_colorA * a;
  vec3 colB = u_colorB * b;

  // Screen-blend all three (background, layer A, layer B) together in one
  // formula rather than additive layering, so overlapping bright regions
  // don't blow out past white as the two fields cross each other.
  vec3 col = 1.0 - (1.0 - u_bg) * (1.0 - colA) * (1.0 - colB);

  fragColor = vec4(col, 1.0);
}
