#version 300 es
precision highp float;

/*
 * god-rays — volumetric light shafts radiating from a movable source.
 *
 * Real god rays are a screen-space post-process: you march from each pixel
 * back toward the light, accumulating whatever occludes it. There is no
 * scene to occlude here, so the occluder is generated procedurally —
 * layered noise, optionally shaped into slats — and the same radial march
 * runs against that. The march is the honest part; the occluder is the
 * cheat, and it is what makes this work as a standalone asset rather than
 * something that needs a scene behind it.
 */

uniform float u_time;
uniform vec2 u_resolution;

uniform vec2 u_source;        // @label(Light source) @range(-1, 1) @default(0.0, 0.35) @group(Composition)
uniform int u_samples;        // @label(Ray samples) @range(8, 96) @default(48) @hint(More samples give smoother shafts at higher cost.)
uniform float u_density;      // @label(Density) @range(0.1, 2) @default(0.85) @mod
uniform float u_decay;        // @label(Decay) @range(0.85, 1.0) @default(0.965) @hint(How quickly a shaft fades along its length.)
uniform float u_weight;       // @label(Weight) @range(0.05, 1.2) @default(0.4)
uniform float u_exposure;     // @label(Exposure) @range(0.1, 3) @default(1.1) @mod

uniform int u_occluder;       // @label(Occluder) @select(Clouds=0 | Slats=1 | Speckle=2) @default(0)
uniform float u_occScale;     // @label(Occluder scale) @range(0.5, 12) @default(3.5) @log
uniform float u_occSpeed;     // @label(Drift speed) @range(0, 1.5) @default(0.18)
uniform float u_coverage;     // @label(Coverage) @range(0, 1) @default(0.5) @hint(How much of the field the occluder blocks.)

uniform vec3 u_lightColor;    // @label(Light) @color @default(0.6, 0.85, 1.0)
uniform vec3 u_bg;            // @label(Background) @color @default(0.0, 0.01, 0.03)
uniform float u_bloom;        // @label(Source bloom) @range(0, 2) @default(0.7)

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

float fbm(vec2 p) {
  float sum = 0.0, amp = 0.5;
  for (int i = 0; i < 5; i++) { sum += amp * gnoise(p); p *= 2.02; amp *= 0.5; }
  return sum;
}

/** 1.0 = fully lit, 0.0 = fully blocked. */
float occlusion(vec2 p) {
  float drift = u_time * u_occSpeed;
  if (u_occluder == 1) {
    float slat = sin((p.y + drift) * u_occScale * 6.0);
    return smoothstep(-0.2, 0.2, slat - (u_coverage * 2.0 - 1.0));
  }
  if (u_occluder == 2) {
    float n = gnoise(p * u_occScale * 6.0 + drift);
    return smoothstep(-0.1, 0.1, n - (u_coverage * 2.0 - 1.0));
  }
  float n = fbm(p * u_occScale + vec2(drift, drift * 0.4));
  return smoothstep(-0.25, 0.25, n - (u_coverage * 1.6 - 0.8));
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / min(u_resolution.x, u_resolution.y);
  vec2 src = u_source;

  vec2 delta = (uv - src) / float(u_samples) * u_density;
  vec2 pos = uv;
  float illum = 1.0;
  float accum = 0.0;

  for (int i = 0; i < 96; i++) {
    if (i >= u_samples) break;
    pos -= delta;
    accum += occlusion(pos) * illum * u_weight;
    illum *= u_decay;
  }

  accum /= float(u_samples);
  accum *= u_exposure * 12.0;

  float d = length(uv - src);
  float bloom = u_bloom * exp(-d * 6.0);

  vec3 col = u_bg + u_lightColor * (accum + bloom);
  fragColor = vec4(col, 1.0);
}
