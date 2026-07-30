#version 300 es
precision highp float;

/* noise-field — fbm with domain warping. The warp is applied twice, which is
   what produces the filament structure rather than plain cloud noise. */

uniform float u_time;
uniform vec2 u_resolution;

uniform float u_scale;         // @label(Scale) @range(0.25, 32) @default(3) @log
uniform int u_octaves;         // @label(Octaves) @range(1, 8) @default(5)
uniform float u_lacunarity;    // @label(Lacunarity) @range(1.2, 4) @default(2) @advanced
uniform float u_gain;          // @label(Gain) @range(0.2, 0.8) @default(0.5) @advanced
uniform float u_warp;          // @label(Warp) @range(0, 4) @default(1.4)
uniform float u_speed;         // @label(Speed) @range(0, 2) @default(0.15)
uniform vec3 u_drift;          // @label(Drift axis) @range(-1, 1)
uniform vec3 u_low;            // @label(Low colour) @color @default(0.0, 0.0, 0.0)
uniform vec3 u_high;           // @label(High colour) @color @default(0.0, 0.83, 1.0)
uniform float u_contrast;      // @label(Contrast) @range(0.2, 4) @default(1.3) @log
uniform bool u_ridged;         // @label(Ridged) @default(false)

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
    mix(dot(hash2(i + vec2(0.0, 0.0)), f - vec2(0.0, 0.0)),
        dot(hash2(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0)), u.x),
    mix(dot(hash2(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0)),
        dot(hash2(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec2 p) {
  float sum = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 8; i++) {
    if (i >= u_octaves) break;
    float n = gnoise(p);
    if (u_ridged) n = 1.0 - abs(n) * 2.0;
    sum += n * amp;
    p *= u_lacunarity;
    amp *= u_gain;
  }
  return sum;
}

void main() {
  vec2 uv = (gl_FragCoord.xy * 2.0 - u_resolution) / min(u_resolution.x, u_resolution.y);
  vec2 p = uv * u_scale;

  float t = u_time * u_speed;
  vec2 drift = u_drift.xy * t;

  vec2 q = vec2(fbm(p + drift), fbm(p + vec2(5.2, 1.3) + drift));
  vec2 r = vec2(fbm(p + u_warp * q + vec2(1.7, 9.2) + t * u_drift.z),
                fbm(p + u_warp * q + vec2(8.3, 2.8)));

  float v = fbm(p + u_warp * r);
  v = clamp((v * 0.5 + 0.5 - 0.5) * u_contrast + 0.5, 0.0, 1.0);

  fragColor = vec4(mix(u_low, u_high, v), 1.0);
}
