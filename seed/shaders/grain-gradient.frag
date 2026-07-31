#version 300 es
precision highp float;

/*
 * grain-gradient — a soft multi-stop gradient carrying real film grain.
 *
 * Two details matter more than they look. First, the grain is applied in a
 * roughly perceptual space rather than added flat: dark regions get less
 * absolute noise than midtones, matching how film actually behaves and
 * avoiding the muddy speckle you get from a uniform add. Second, the
 * gradient itself is dithered — banding is the default failure mode of any
 * smooth 8-bit gradient, and a sub-LSB dither is what removes it. The grain
 * here doubles as that dither, which is why even a very low grain amount
 * visibly cleans up the ramp.
 */

uniform float u_time;
uniform vec2 u_resolution;

uniform int u_shape;          // @label(Gradient) @select(Linear=0 | Radial=1 | Conic=2 | Mesh=3) @default(3)
uniform float u_angle;        // @label(Angle) @range(-180, 180) @default(35) @unit(deg)
uniform vec2 u_center;        // @label(Centre) @range(-1, 1) @default(0.0, 0.0) @group(Composition)
uniform float u_scale;        // @label(Scale) @range(0.2, 3) @default(1) @log

uniform vec3 u_colorA;        // @label(Colour A) @color @default(0.0, 0.45, 0.7)
uniform vec3 u_colorB;        // @label(Colour B) @color @default(0.35, 0.05, 0.5)
uniform vec3 u_colorC;        // @label(Colour C) @color @default(0.0, 0.83, 1.0)
uniform float u_mixBias;      // @label(Mix bias) @range(0, 1) @default(0.5) @mod

uniform float u_flow;         // @label(Flow) @range(0, 1) @default(0.12) @mod @hint(Slow drift of the mesh field. No effect on linear or radial.)
uniform float u_grain;        // @label(Grain) @range(0, 0.4) @default(0.07)
uniform float u_grainSize;    // @label(Grain size) @range(0.3, 4) @default(1) @log
uniform bool u_animateGrain;  // @label(Animate grain) @default(true)
uniform float u_contrast;     // @label(Contrast) @range(0.4, 2.5) @default(1)
uniform float u_vignette;     // @label(Vignette) @range(0, 1) @default(0.25)

out vec4 fragColor;

vec2 hash2(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return -1.0 + 2.0 * fract(sin(p) * 43758.5453);
}

float gnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(dot(hash2(i), f), dot(hash2(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0)), u.x),
    mix(dot(hash2(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0)),
        dot(hash2(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0)), u.x), u.y);
}

float whiteNoise(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec2 p = (uv - 0.5 - u_center * 0.5) / u_scale;
  p.x *= u_resolution.x / max(u_resolution.y, 1.0);

  float t;
  if (u_shape == 0) {
    float a = radians(u_angle);
    t = dot(p, vec2(cos(a), sin(a))) + 0.5;
  } else if (u_shape == 1) {
    t = length(p) * 1.4;
  } else if (u_shape == 2) {
    t = atan(p.y, p.x) / 6.28318 + 0.5;
  } else {
    float drift = u_time * u_flow;
    t = 0.5 + 0.5 * gnoise(p * 1.6 + vec2(drift, drift * 0.7));
    t += 0.25 * gnoise(p * 3.1 - vec2(drift * 0.6, drift));
  }

  t = clamp((t - 0.5) * u_contrast + 0.5, 0.0, 1.0);

  // Three-stop ramp through B in the middle, biased by u_mixBias.
  float bias = clamp(u_mixBias, 0.001, 0.999);
  vec3 col = t < bias
    ? mix(u_colorA, u_colorB, t / bias)
    : mix(u_colorB, u_colorC, (t - bias) / (1.0 - bias));

  // Grain doubles as dither: even a small amount breaks up 8-bit banding
  // in the ramp above, which is the real reason it's on by default.
  vec2 grainUv = gl_FragCoord.xy / max(u_grainSize, 0.01);
  if (u_animateGrain) grainUv += floor(u_time * 24.0);
  float n = whiteNoise(grainUv) - 0.5;
  float luma = dot(col, vec3(0.299, 0.587, 0.114));
  col += n * u_grain * mix(0.35, 1.0, sqrt(luma));

  float vig = 1.0 - u_vignette * smoothstep(0.35, 1.1, length(uv - 0.5) * 1.6);
  col *= vig;

  fragColor = vec4(col, 1.0);
}
