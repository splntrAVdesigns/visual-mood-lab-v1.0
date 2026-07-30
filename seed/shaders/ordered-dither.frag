#version 300 es
precision highp float;

/* ordered-dither — Bayer thresholding over an animated procedural source,
   with palette control and motion. */

uniform float u_time;
uniform vec2 u_resolution;
uniform bool u_hasSource;
uniform sampler2D u_src;       // @label(Source) @hint(Optional. Leave empty for the built-in field.)

uniform int u_matrix;          // @label(Matrix) @select(Bayer 2x2=0 | Bayer 4x4=1 | Bayer 8x8=2 | Blue noise=3) @default(1)
uniform int u_paletteSize;     // @label(Palette steps) @range(2, 16) @default(3)
uniform float u_spread;        // @label(Spread) @range(0, 1) @default(0.6)
uniform float u_pixelSize;     // @label(Pixel size) @range(1, 16) @default(3) @log @unit(px)
uniform bool u_animateMatrix;  // @label(Animate matrix) @default(false) @hint(Cycles the threshold grid — adds shimmer.)

uniform int u_pattern;         // @label(Built-in pattern) @select(Tunnel=0 | Metaballs=1 | Ripples=2 | Terrain=3) @default(1)
uniform float u_speed;         // @label(Speed) @range(0, 3) @default(0.65)
uniform float u_scale;         // @label(Pattern scale) @range(0.2, 6) @default(1.5) @log
uniform float u_contrast;      // @label(Contrast) @range(0.2, 4) @default(1.3) @log

uniform vec3 u_dark;           // @label(Dark) @color @default(0.02, 0.02, 0.03)
uniform vec3 u_light;          // @label(Light) @color @default(0.0, 0.83, 1.0)
uniform bool u_monochrome;     // @label(Monochrome) @default(true)
uniform bool u_serpentine;     // @label(Serpentine offset) @default(false) @advanced

out vec4 fragColor;

float bayer2(vec2 a) { a = floor(a); return fract(a.x / 2.0 + a.y * a.y * 0.75); }
float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
float bayer8(vec2 a) { return bayer4(0.5 * a) * 0.25 + bayer2(a); }
float hashNoise(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

float threshold(vec2 p) {
  if (u_animateMatrix) p += floor(vec2(u_time * 6.0, u_time * 4.0));
  if (u_matrix == 0) return bayer2(p) / 0.75;
  if (u_matrix == 1) return bayer4(p) / 0.9375;
  if (u_matrix == 2) return bayer8(p) / 0.984375;
  return hashNoise(p);
}

float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hashNoise(i), hashNoise(i + vec2(1, 0)), u.x),
             mix(hashNoise(i + vec2(0, 1)), hashNoise(i + vec2(1, 1)), u.x), u.y);
}

vec3 builtin(vec2 uv) {
  vec2 p = (uv - 0.5) * 2.0 * u_scale;
  p.x *= u_resolution.x / max(u_resolution.y, 1.0);
  float t = u_time * u_speed;
  float r = length(p);

  if (u_pattern == 0) {
    float v = 0.5 + 0.5 * sin(1.0 / max(r, 0.1) * 2.5 + t * 2.0);
    return vec3(v);
  }
  if (u_pattern == 2) {
    return vec3(0.5 + 0.5 * sin(r * 10.0 - t * 3.0));
  }
  if (u_pattern == 3) {
    float n = noise(p * 2.0 + vec2(t * 0.3, 0.0));
    n += 0.5 * noise(p * 4.0 - vec2(0.0, t * 0.2));
    n += 0.25 * noise(p * 8.0);
    return vec3(clamp(n * 0.6, 0.0, 1.0));
  }
  /* Metaballs */
  float v = 0.0;
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    vec2 c = vec2(sin(t * (0.4 + fi * 0.19) + fi * 2.1),
                  cos(t * (0.33 + fi * 0.23) - fi * 1.7)) * 0.62;
    v += 0.16 / max(length(p - c), 0.1);
  }
  return vec3(clamp(v - 0.5, 0.0, 1.0));
}

void main() {
  vec2 px = floor(gl_FragCoord.xy / u_pixelSize);
  vec2 uv = (px * u_pixelSize + u_pixelSize * 0.5) / u_resolution;

  vec2 tp = px;
  if (u_serpentine && mod(px.y, 2.0) > 0.5) tp.x += 0.5;

  vec3 src = u_hasSource ? texture(u_src, uv).rgb : builtin(uv);
  src = clamp((src - 0.5) * u_contrast + 0.5, 0.0, 1.0);

  float t = (threshold(tp) - 0.5) * u_spread;
  float steps = float(max(u_paletteSize - 1, 1));
  vec3 v = u_monochrome ? vec3(dot(src, vec3(0.2126, 0.7152, 0.0722))) : src;
  vec3 q = floor(clamp(v + t, 0.0, 1.0) * steps + 0.5) / steps;

  fragColor = vec4(mix(u_dark, u_light, q), 1.0);
}
