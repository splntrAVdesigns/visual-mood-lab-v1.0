#version 300 es
precision highp float;

uniform vec2 u_resolution;
uniform float u_time;

// ===== GLOBAL (applies to all 3 pattern modes) =====
uniform int   u_mode;         // @label(Pattern Mode) @select(Halftone Warp=0 | Topographic=1 | Flow Lines=2) @default(0) @group(Global)
uniform float u_patternScale; // @label(Scale) @range(0.4, 2.5) @default(1.0) @group(Global)
uniform int   u_direction;    // @label(Direction) @select(North=0 | Northeast=1 | East=2 | Southeast=3 | South=4 | Southwest=5 | West=6 | Northwest=7) @default(2) @group(Global)
uniform float u_speed;        // @label(Speed) @range(0.1, 3.0) @default(1.0) @group(Global)
uniform float u_turbulence;   // @label(Turbulence Amount) @range(0.0, 2.0) @default(0.8) @group(Global)
uniform float u_morphSpeed;   // @label(Morph Speed) @range(0.05, 3.0) @default(0.6) @group(Global)
uniform float u_complexity;   // @label(Complexity) @range(0.4, 2.2) @default(1.0) @group(Global)
uniform float u_density;      // @label(Density) @range(0.2, 1.0) @default(0.5) @group(Global)
uniform float u_thickness;    // @label(Thickness) @range(0.3, 2.2) @default(1.0) @group(Global)
uniform float u_contrast;     // @label(Contrast) @range(0.5, 2.0) @default(1.0) @group(Global)

// ===== COLOR =====
uniform vec3  u_bgColor;      // @label(Background) @color @default(0.0, 0.0, 0.0) @group(Color)
uniform vec3  u_colorA;       // @label(Color A) @color @default(0.92, 0.95, 1.0) @group(Color)
uniform vec3  u_colorB;       // @label(Color B) @color @default(0.37, 0.45, 0.84) @group(Color)

out vec4 fragColor;

const float TAU = 6.28318530718;
const float DEG2RAD = 0.017453292;

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float valueNoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  float a = hash(i), b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}
/* Complexity now genuinely changes pattern DETAIL (extra octave blended
   in at high settings) rather than just resizing — Scale is the only
   thing that resizes now. Previously Complexity and Density both fed
   directly into the sampling frequency, which is why they read as doing
   the same job: they were. */
float fbm(vec2 p, float complexity){
  float total = 0.0, amp = 0.5, freq = 1.0;
  int octaves = complexity > 1.3 ? 4 : 3;
  for(int o = 0; o < 4; o++){
    if(o >= octaves) break;
    total += valueNoise(p * freq) * amp;
    amp *= 0.5; freq *= 2.0;
  }
  return total;
}

vec2 morphWarp(vec2 p, float t, float amount, float complexity){
  float wx = fbm(p * 0.6 + vec2(3.1, 1.7) + t * 0.15, complexity);
  float wy = fbm(p * 0.6 + vec2(9.4, 2.3) - t * 0.13, complexity);
  return vec2(wx, wy) * amount;
}

vec2 directionVector(int dir){
  float ang = float(dir) * 45.0 * DEG2RAD;
  // 0=North: screen-space "up" is -y in this shader's y-down uv convention,
  // so North maps to (0,-1) etc, going clockwise to match compass order
  return vec2(sin(ang), -cos(ang));
}

void main(){
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  float aspect = u_resolution.x / u_resolution.y;
  vec2 p = vec2(uv.x * aspect, uv.y) * u_patternScale;

  float tm = mod(u_time, TAU * 50.0) * u_speed;
  float morphT = mod(u_time, TAU * 50.0) * u_morphSpeed * 1.6;
  vec2 dirVec = directionVector(u_direction);
  // Direction previously moved the "drift" term by a small fraction
  // relative to the turbulence/morph terms, so the pattern technically
  // shifted but not by enough to read as a clear directional current.
  // Multiplier raised substantially so the set direction is unambiguous
  // at any turbulence setting.
  vec2 drift = dirVec * tm * 1.8;

  vec3 col = u_bgColor;

  if(u_mode == 0){
    // Density no longer drives sampling frequency (that was the redundancy
    // with Complexity) — dot count is now fixed and Density instead drives
    // the per-dot shading below.
    float freq = 32.0;
    vec2 gp = p * freq;
    vec2 gcell = floor(gp);
    float bestAlpha = 0.0;
    vec3 bestCol = u_bgColor;
    float bestLight = 0.0;
    vec2 bestLocal = vec2(0.0);
    for(int oy = -1; oy <= 1; oy++){
      for(int ox = -1; ox <= 1; ox++){
        vec2 cell = gcell + vec2(float(ox), float(oy));
        vec2 cellCenter = cell + 0.5;
        vec2 sampleP = cell * 0.16 * u_turbulence - drift * 0.3;
        vec2 warp = morphWarp(sampleP, morphT, u_turbulence * 0.6, u_complexity);
        float ang = fbm(sampleP + warp, u_complexity) * TAU;
        float mag = clamp((fbm(sampleP + warp + 40.0, u_complexity) + 1.0) * 0.5 * u_contrast, 0.0, 1.0);
        vec2 dotPos = cellCenter + vec2(cos(ang), sin(ang)) * mag * 0.42;
        vec2 local = gp - dotPos;
        float d = length(local);
        float r = (0.09 + mag * 0.24) * u_thickness;
        float a = 1.0 - smoothstep(r - 0.05, r, d);
        if(a > bestAlpha){
          bestAlpha = a; bestCol = mix(u_colorA, u_colorB, mag);
          bestLocal = local / max(0.001, r); bestLight = mag;
        }
      }
    }
    /* Density repurposed: it was doing the same job as Complexity (both
       just scaled frequency). Now it drives a fake-sphere radial shading
       per dot — a bright offset highlight fading to a darker rim — which
       is what actually reads as 3D instead of flat filled circles. */
    vec2 lightDir = normalize(vec2(-0.4, -0.6));
    float ndotl = clamp(dot(-bestLocal, lightDir) * 0.6 + 0.55, 0.0, 1.0);
    vec3 shaded = bestCol * mix(1.0, ndotl * 1.3, u_density);
    float rim = pow(clamp(length(bestLocal), 0.0, 1.0), 3.0) * u_density * 0.4;
    shaded = mix(shaded, shaded * 0.5, rim);
    col = mix(u_bgColor, shaded, bestAlpha);

  } else if(u_mode == 1){
    float freq = 1.8 * u_complexity;
    vec2 warp = morphWarp(p * freq * 0.6, morphT, u_turbulence, u_complexity);
    float h = fbm(p * freq - drift * 0.15 + warp, u_complexity);
    float levels = 12.0 * u_density * 1.6;
    float band = fract(h * levels);
    float lineW = 0.045 * u_thickness;
    float line = 1.0 - smoothstep(0.0, lineW, min(band, 1.0 - band));
    vec3 elevColor = mix(u_colorA, u_colorB, clamp(h * u_contrast, 0.0, 1.0));
    col = mix(u_bgColor, elevColor, line);

  } else {
    float freq = u_complexity;
    vec2 sp = p * (3.0 * freq) - drift * 0.1;
    vec2 warp = morphWarp(sp * 0.5, morphT, u_turbulence * 1.3, u_complexity);
    vec2 curlP = sp + warp;
    float eps = 0.02;
    float n1 = fbm(curlP + vec2(0.0, eps), u_complexity), n2 = fbm(curlP - vec2(0.0, eps), u_complexity);
    float n3 = fbm(curlP + vec2(eps, 0.0), u_complexity), n4 = fbm(curlP - vec2(eps, 0.0), u_complexity);
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
    lic = clamp((lic - 0.5) * 3.2 + 0.5, 0.0, 1.0);
    float streak = smoothstep(0.5 - 0.16/u_contrast, 0.5 + 0.16/u_contrast, lic);
    vec3 streakCol = mix(u_colorA, u_colorB, clamp(curlLen * 2.0, 0.0, 1.0));
    col = mix(u_bgColor, streakCol, streak);
  }

  fragColor = vec4(col, 1.0);
}
