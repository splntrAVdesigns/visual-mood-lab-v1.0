#version 300 es
precision highp float;

uniform vec2 u_resolution;
uniform float u_time;

uniform int   u_mode;         // @label(Pattern Mode) @select(Halftone Warp=0 | Topographic=1 | Flow Lines=2) @default(0)
uniform float u_direction;    // @label(Direction) @range(0.0, 360.0) @default(45.0) @group(Motion)
uniform float u_speed;        // @label(Speed) @range(0.1, 3.0) @default(1.0) @group(Motion)
uniform float u_turbulence;   // @label(Turbulence Amount) @range(0.0, 2.0) @default(0.8) @group(Motion)
uniform float u_morphSpeed;   // @label(Morph Speed) @range(0.05, 2.0) @default(0.4) @group(Motion)
uniform float u_complexity;   // @label(Complexity) @range(0.4, 2.2) @default(1.0) @group(Pattern)
uniform vec3  u_bgColor;      // @label(Background) @color @default(0.0, 0.0, 0.0) @group(Color)
uniform vec3  u_colorA;       // @label(Color A) @color @default(0.92, 0.95, 1.0) @group(Color)
uniform vec3  u_colorB;       // @label(Color B) @color @default(0.37, 0.45, 0.84) @group(Color)
uniform float u_density;      // @label(Density) @range(0.2, 1.0) @default(0.5) @group(Pattern)
uniform float u_thickness;    // @label(Thickness) @range(0.3, 2.2) @default(1.0) @group(Pattern)
uniform float u_contrast;     // @label(Contrast) @range(0.5, 2.0) @default(1.0) @group(Pattern)

out vec4 fragColor;

const float TAU = 6.28318530718;

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float valueNoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  float a = hash(i), b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}
float fbm(vec2 p){
  float total = 0.0, amp = 0.5, freq = 1.0;
  for(int o = 0; o < 3; o++){
    total += valueNoise(p * freq) * amp;
    amp *= 0.5; freq *= 2.0;
  }
  return total;
}

vec2 morphWarp(vec2 p, float t, float amount){
  float wx = fbm(p * 0.6 + vec2(3.1, 1.7) + t * 0.15);
  float wy = fbm(p * 0.6 + vec2(9.4, 2.3) - t * 0.13);
  return vec2(wx, wy) * amount;
}

void main(){
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  float aspect = u_resolution.x / u_resolution.y;
  vec2 p = vec2(uv.x * aspect, uv.y);

  float tm = mod(u_time, TAU * 50.0) * u_speed;
  float morphT = mod(u_time, TAU * 50.0) * u_morphSpeed;
  float dirRad = u_direction * 3.14159265 / 180.0;
  vec2 drift = vec2(cos(dirRad), sin(dirRad)) * tm;

  vec3 col = u_bgColor;

  if(u_mode == 0){
    float freq = mix(16.0, 60.0, u_density) * u_complexity;
    vec2 gp = p * freq;
    vec2 gcell = floor(gp);
    float bestAlpha = 0.0;
    vec3 bestCol = u_bgColor;
    for(int oy = -1; oy <= 1; oy++){
      for(int ox = -1; ox <= 1; ox++){
        vec2 cell = gcell + vec2(float(ox), float(oy));
        vec2 cellCenter = cell + 0.5;
        vec2 sampleP = cell * 0.16 * u_turbulence - drift * 0.3;
        vec2 warp = morphWarp(sampleP, morphT, u_turbulence * 0.6);
        float ang = fbm(sampleP + warp) * TAU;
        float mag = clamp((fbm(sampleP + warp + 40.0) + 1.0) * 0.5 * u_contrast, 0.0, 1.0);
        vec2 dotPos = cellCenter + vec2(cos(ang), sin(ang)) * mag * 0.42;
        float d = length(gp - dotPos);
        float r = (0.09 + mag * 0.24) * u_thickness;
        float a = 1.0 - smoothstep(r - 0.05, r, d);
        if(a > bestAlpha){ bestAlpha = a; bestCol = mix(u_colorA, u_colorB, mag); }
      }
    }
    col = mix(u_bgColor, bestCol, bestAlpha);

  } else if(u_mode == 1){
    float freq = 1.8 * u_complexity;
    vec2 warp = morphWarp(p * freq * 0.6, morphT, u_turbulence);
    float h = fbm(p * freq - drift * 0.15 + warp);
    float levels = 12.0 * u_density * 1.6;
    float band = fract(h * levels);
    float lineW = 0.045 * u_thickness;
    float line = 1.0 - smoothstep(0.0, lineW, min(band, 1.0 - band));
    vec3 elevColor = mix(u_colorA, u_colorB, clamp(h * u_contrast, 0.0, 1.0));
    col = mix(u_bgColor, elevColor, line);

  } else {
    /* Flow lines — the real bug in the previous version: LIC needs
       high-frequency, low-correlation "grain" as its base texture (that's
       what real LIC implementations use white noise for). I was
       averaging smooth 3-octave fbm along the flow direction — smooth
       noise averaged with more smooth noise just produces more smooth
       noise, not streaks, no matter how many taps. Two fixes: swap the
       base texture for actual high-frequency grain, and widen the tap
       spacing enough to traverse real noise variation (the old spacing
       moved each tap by a small fraction of one noise cell — visually
       almost the same sample repeated). Averaging also mechanically
       reduces contrast (basic box-filter behavior), so contrast is
       explicitly restored after the average rather than left flat. */
    float freq = u_complexity;
    vec2 sp = p * (3.0 * freq) - drift * 0.1;
    vec2 warp = morphWarp(sp * 0.5, morphT, u_turbulence * 1.3);
    vec2 curlP = sp + warp;
    float eps = 0.02;
    float n1 = fbm(curlP + vec2(0.0, eps)), n2 = fbm(curlP - vec2(0.0, eps));
    float n3 = fbm(curlP + vec2(eps, 0.0)), n4 = fbm(curlP - vec2(eps, 0.0));
    vec2 curl = vec2((n1 - n2) / (2.0 * eps), -(n3 - n4) / (2.0 * eps));
    float curlLen = length(curl) + 1e-5;
    vec2 dir = curl / curlLen;

    float licSum = 0.0, licWeight = 0.0;
    const int TAPS = 14;
    for(int i = -TAPS; i <= TAPS; i++){
      float fi = float(i);
      float w = 1.0 - abs(fi) / float(TAPS + 1);
      vec2 samplePos = p * (9.0 * freq) + dir * fi * 0.6 * u_thickness;
      float grain = valueNoise(samplePos) * 0.65 + valueNoise(samplePos * 2.3 + 11.0) * 0.35;
      licSum += grain * w;
      licWeight += w;
    }
    float lic = licSum / max(0.001, licWeight);
    lic = clamp((lic - 0.5) * 3.2 + 0.5, 0.0, 1.0); // restore contrast lost to averaging
    float streak = smoothstep(0.5 - 0.16/u_contrast, 0.5 + 0.16/u_contrast, lic);
    vec3 streakCol = mix(u_colorA, u_colorB, clamp(curlLen * 2.0, 0.0, 1.0));
    col = mix(u_bgColor, streakCol, streak);
  }

  fragColor = vec4(col, 1.0);
}
