#version 300 es
precision highp float;

uniform vec2 u_resolution;
uniform float u_time;

uniform int   u_mode;        // @label(Pattern Mode) @select(Halftone Warp=0 | Topographic=1 | Flow Lines=2) @default(0)
uniform float u_direction;   // @label(Direction) @range(0.0, 360.0) @default(45.0) @group(Motion)
uniform float u_speed;       // @label(Speed) @range(0.1, 3.0) @default(1.0) @group(Motion)
uniform float u_turbulence;  // @label(Turbulence) @range(0.3, 2.2) @default(1.0) @group(Motion)
uniform vec3  u_bgColor;     // @label(Background) @color @default(0.0, 0.0, 0.0) @group(Color)
uniform vec3  u_colorA;      // @label(Color A) @color @default(0.92, 0.95, 1.0) @group(Color)
uniform vec3  u_colorB;      // @label(Color B) @color @default(0.37, 0.45, 0.84) @group(Color)
uniform float u_density;     // @label(Density) @range(0.2, 1.0) @default(0.5) @group(Pattern)
uniform float u_thickness;   // @label(Thickness) @range(0.3, 2.2) @default(1.0) @group(Pattern)

out vec4 fragColor;

const float TAU = 6.28318530718;

/* Direction genuinely advects the noise sampling coordinates over time
   along the chosen angle, rather than just animating a fixed field in
   place — that's what makes the whole pattern visibly drift that way,
   the same technique used in the design-mockup pass this translates. */

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
  for(int o = 0; o < 4; o++){
    total += valueNoise(p * freq) * amp;
    amp *= 0.5; freq *= 2.0;
  }
  return total;
}

void main(){
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  float aspect = u_resolution.x / u_resolution.y;
  vec2 p = vec2(uv.x * aspect, uv.y);

  float tm = mod(u_time, TAU * 50.0) * u_speed;
  float dirRad = u_direction * 3.14159265 / 180.0;
  vec2 drift = vec2(cos(dirRad), sin(dirRad)) * tm;

  vec3 col = u_bgColor;

  if(u_mode == 0){
    /* Halftone warp: dot grid displaced along a flowing noise field. */
    float freq = u_turbulence * 1.4 * u_density;
    vec2 gp = p * (10.0 * u_density);
    vec2 cell = floor(gp);
    vec2 cellUV = fract(gp) - 0.5;
    vec2 sampleP = cell * 0.22 * freq - drift * 0.3;
    float ang = fbm(sampleP) * TAU;
    float mag = (fbm(sampleP + 40.0) + 1.0) * 0.5;
    vec2 offset = vec2(cos(ang), sin(ang)) * mag * 0.35;
    float d = length(cellUV - offset);
    float r = (0.08 + mag * 0.22) * u_thickness;
    float dotMask = 1.0 - smoothstep(r - 0.03, r, d);
    col = mix(u_bgColor, mix(u_colorA, u_colorB, mag), dotMask * (0.5 + mag * 0.5));

  } else if(u_mode == 1){
    /* Topographic: banded isolines of a drifting fbm heightfield, tinted
       by elevation (colorA = low band, colorB = high band). */
    float freq = u_turbulence * 2.2 * u_density;
    float h = fbm(p * freq - drift * 0.15);
    float levels = 12.0;
    float band = fract(h * levels);
    float lineW = 0.045 * u_thickness;
    float line = 1.0 - smoothstep(0.0, lineW, min(band, 1.0 - band));
    vec3 elevColor = mix(u_colorA, u_colorB, clamp(h, 0.0, 1.0));
    col = mix(u_bgColor, elevColor, line);

  } else {
    /* Flow lines: short streaks traced along the curl of the drifting
       field — curl noise is divergence-free by construction, which is
       what keeps this from collapsing into a radial "flower" artifact
       the way naive angle-from-noise sampling can. */
    float freq = u_turbulence * 1.1 * u_density;
    vec2 sp = p * freq - drift * 0.12;
    float eps = 0.02;
    float n1 = fbm(sp + vec2(0.0, eps)), n2 = fbm(sp - vec2(0.0, eps));
    float n3 = fbm(sp + vec2(eps, 0.0)), n4 = fbm(sp - vec2(eps, 0.0));
    vec2 curl = vec2((n1 - n2) / (2.0 * eps), -(n3 - n4) / (2.0 * eps));
    float curlLen = length(curl) + 1e-5;
    vec2 dir = curl / curlLen;
    float streak = 0.0;
    for(int i = -3; i <= 3; i++){
      float fi = float(i);
      vec2 samplePos = sp + dir * fi * 0.06;
      float v = fbm(samplePos * 3.0);
      streak += smoothstep(0.55, 0.62, v) * (1.0 - abs(fi) / 4.0);
    }
    streak = clamp(streak * u_thickness, 0.0, 1.0);
    col = mix(u_bgColor, mix(u_colorA, u_colorB, clamp(curlLen * 2.0, 0.0, 1.0)), streak);
  }

  fragColor = vec4(col, 1.0);
}
