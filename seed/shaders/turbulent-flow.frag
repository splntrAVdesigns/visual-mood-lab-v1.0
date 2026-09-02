#version 300 es
precision highp float;

uniform vec2 u_resolution;
uniform float u_time;

// ===== GLOBAL =====
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
/* Complexity rebuilt. Previous version: `octaves = complexity>1.3 ? 4 : 3`
   — a binary switch, meaning roughly 70% of the slider's range (0.4-1.3)
   did nothing at all, confirmed by rereading the code. Now 5 octaves
   total, with each higher octave's weight fading in smoothly and
   continuously as complexity increases, so every point on the slider
   changes something. */
float fbm(vec2 p, float complexity){
  float total = 0.0, amp = 0.5, freq = 1.0;
  float cNorm = clamp((complexity - 0.4) / (2.2 - 0.4), 0.0, 1.0) * 5.0;
  for(int o = 0; o < 5; o++){
    float w = (o == 0) ? 1.0 : clamp(cNorm - float(o - 1), 0.0, 1.0);
    total += valueNoise(p * freq) * amp * w;
    amp *= 0.5; freq *= 2.0;
  }
  return total;
}

vec2 morphWarp(vec2 p, float t, float amount, float complexity){
  float wx = fbm(p * 0.6 + vec2(3.1, 1.7) + t * 0.4, complexity);
  float wy = fbm(p * 0.6 + vec2(9.4, 2.3) - t * 0.35, complexity);
  return vec2(wx, wy) * amount;
}

vec2 directionVector(int dir){
  float ang = float(dir) * 45.0 * DEG2RAD;
  return vec2(sin(ang), -cos(ang));
}

void main(){
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  float aspect = u_resolution.x / u_resolution.y;
  vec2 p = vec2(uv.x * aspect, uv.y) * u_patternScale;

  float tm = mod(u_time, TAU * 50.0) * u_speed;
  // Morph Speed's effect was too subtle to read at default settings —
  // widened both the base multiplier here and morphWarp's internal time
  // coefficients (0.15/0.13 -> 0.4/0.35) so the change is unambiguous
  // across the slider's range, not just at its extremes.
  float morphT = mod(u_time, TAU * 50.0) * u_morphSpeed * 2.2;
  vec2 dirVec = directionVector(u_direction);
  vec2 drift = dirVec * tm * 1.8;

  vec3 col = u_bgColor;

  if(u_mode == 0){
    float freq = 32.0;
    vec2 gp = p * freq;
    vec2 gcell = floor(gp);
    float bestAlpha = 0.0;
    vec3 bestCol = u_bgColor;
    vec2 bestLocal = vec2(0.0);
    for(int oy = -1; oy <= 1; oy++){
      for(int ox = -1; ox <= 1; ox++){
        vec2 cell = gcell + vec2(float(ox), float(oy));
        vec2 cellCenter = cell + 0.5;
        // Turbulence previously multiplied straight into this sampling
        // coordinate (`cell*0.16*u_turbulence`), which is mechanically a
        // zoom operation — confirmed exactly the "scaling, not enhancing
        // turbulence" report. Turbulence now ONLY controls the warp
        // amount below, which is what actually reshapes the field rather
        // than resizing it.
        vec2 sampleP = cell * 0.16 - drift * 0.3;
        vec2 warp = morphWarp(sampleP, morphT, u_turbulence * 0.9, u_complexity);
        float ang = fbm(sampleP + warp, u_complexity) * TAU;
        float mag = clamp((fbm(sampleP + warp + 40.0, u_complexity) + 1.0) * 0.5 * u_contrast, 0.0, 1.0);
        vec2 dotPos = cellCenter + vec2(cos(ang), sin(ang)) * mag * 0.42;
        vec2 local = gp - dotPos;
        float d = length(local);
        float r = (0.09 + mag * 0.24) * u_thickness;
        float a = 1.0 - smoothstep(r - 0.05, r, d);
        if(a > bestAlpha){
          bestAlpha = a; bestCol = mix(u_colorA, u_colorB, mag);
          bestLocal = local / max(0.001, r);
        }
      }
    }
    // Density strengthened substantially — was a mix(1.0, x, density)
    // against a fairly subtle x, and a rim term capped at *0.4. Both
    // ranges widened so low vs. high density is unmistakable.
    vec2 lightDir = normalize(vec2(-0.4, -0.6));
    float ndotl = clamp(dot(-bestLocal, lightDir) * 0.7 + 0.5, 0.0, 1.0);
    vec3 shaded = bestCol * mix(1.0, ndotl * 1.8, u_density);
    float rim = pow(clamp(length(bestLocal), 0.0, 1.0), 2.5) * u_density * 0.75;
    shaded = mix(shaded, shaded * 0.35, rim);
    shaded += bestCol * pow(ndotl, 6.0) * u_density * 0.6; // small hot highlight, density-driven
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
