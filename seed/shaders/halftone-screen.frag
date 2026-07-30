#version 300 es
precision highp float;

/* halftone-screen — rotated CMYK dot screens with a live animated source.
   Now has motion and far more control than the static version. */

uniform float u_time;
uniform vec2 u_resolution;
uniform bool u_hasSource;
uniform sampler2D u_src;       // @label(Source) @hint(Optional. Leave empty for the built-in field.)

uniform float u_frequency;     // @label(Screen frequency) @range(4, 160) @default(26) @log @unit(lpi)
uniform float u_dotGain;       // @label(Dot gain) @range(-0.4, 0.6) @default(0.05)
uniform float u_softness;      // @label(Edge softness) @range(0.005, 0.3) @default(0.05)
uniform int u_shape;           // @label(Dot shape) @select(Round=0 | Square=1 | Diamond=2 | Line=3) @default(0)
uniform int u_channels;        // @label(Separation) @select(CMYK=0 | Duotone=1 | Single=2) @default(0)
uniform float u_angleOffset;   // @label(Screen angle) @range(-45, 45) @default(0) @unit(deg)
uniform float u_screenSpin;    // @label(Screen spin) @range(-1, 1) @default(0.04) @hint(Slowly rotates the whole screen.)

uniform int u_pattern;         // @label(Built-in pattern) @select(Waves=0 | Orbit=1 | Blobs=2 | Sweep=3) @default(1)
uniform float u_speed;         // @label(Speed) @range(0, 3) @default(0.7)
uniform float u_scale;         // @label(Pattern scale) @range(0.2, 6) @default(1.4) @log
uniform float u_contrast;      // @label(Contrast) @range(0.2, 4) @default(1.2) @log

uniform vec3 u_paper;          // @label(Paper) @color @default(0.0, 0.0, 0.0)
uniform vec3 u_spot;           // @label(Spot colour) @color @default(0.0, 0.83, 1.0)
uniform bool u_showChannels;   // @label(Debug separations) @default(false) @advanced

out vec4 fragColor;

mat2 rot(float d) {
  float a = radians(d + u_angleOffset) + u_time * u_screenSpin;
  float c = cos(a), s = sin(a);
  return mat2(c, -s, s, c);
}

float dotShape(vec2 cell, float radius) {
  if (u_shape == 1) return max(abs(cell.x), abs(cell.y));
  if (u_shape == 2) return abs(cell.x) + abs(cell.y);
  if (u_shape == 3) return abs(cell.y);
  return length(cell);
}

float screenAt(vec2 uv, float angle, float density) {
  vec2 p = rot(angle) * uv * u_frequency;
  vec2 cell = fract(p) - 0.5;
  float radius = sqrt(clamp(density + u_dotGain, 0.0, 1.0)) * 0.72;
  return 1.0 - smoothstep(radius - u_softness, radius + u_softness, dotShape(cell, radius));
}

/* Animated built-in source. Returns 0..1 per channel. */
vec3 builtin(vec2 uv) {
  vec2 p = (uv - 0.5) * 2.0 * u_scale;
  p.x *= u_resolution.x / max(u_resolution.y, 1.0);
  float t = u_time * u_speed;
  float r = length(p);

  if (u_pattern == 0) {
    float v = 0.5 + 0.5 * sin(p.x * 4.0 + t) * cos(p.y * 4.0 - t * 0.7);
    return vec3(v, v * 0.8 + 0.1, 1.0 - v);
  }
  if (u_pattern == 2) {
    float v = 0.0;
    for (int i = 0; i < 4; i++) {
      float fi = float(i);
      vec2 c = vec2(sin(t * (0.5 + fi * 0.21) + fi), cos(t * (0.4 + fi * 0.17) - fi)) * 0.6;
      v += 0.18 / max(length(p - c), 0.12);
    }
    v = clamp(v - 0.4, 0.0, 1.0);
    return vec3(v, v * 0.6, 1.0 - v * 0.8);
  }
  if (u_pattern == 3) {
    float v = 0.5 + 0.5 * sin((p.x + p.y) * 3.0 - t * 2.0);
    return vec3(v, 1.0 - v, v * 0.5 + 0.25);
  }
  /* Orbit */
  vec2 c = vec2(cos(t), sin(t * 1.3)) * 0.55;
  float v = 1.0 - clamp(length(p - c) * 0.9, 0.0, 1.0);
  float w = 1.0 - clamp(length(p + c) * 0.9, 0.0, 1.0);
  return clamp(vec3(v, w, (v + w) * 0.5), 0.0, 1.0);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec3 src = u_hasSource ? texture(u_src, uv).rgb : builtin(uv);
  src = clamp((src - 0.5) * u_contrast + 0.5, 0.0, 1.0);

  float k = 1.0 - max(max(src.r, src.g), src.b);
  vec3 cmy = k < 1.0 ? (1.0 - src - k) / (1.0 - k) : vec3(0.0);

  if (u_channels == 2) {
    float lum = 1.0 - dot(src, vec3(0.2126, 0.7152, 0.0722));
    fragColor = vec4(mix(u_paper, u_spot, screenAt(uv, 45.0, lum)), 1.0);
    return;
  }

  if (u_channels == 1) {
    float lum = 1.0 - dot(src, vec3(0.2126, 0.7152, 0.0722));
    float a = screenAt(uv, 45.0, lum);
    float b = screenAt(uv, 15.0, lum * 0.7);
    fragColor = vec4(mix(u_paper, u_spot, max(a, b * 0.6)), 1.0);
    return;
  }

  float dc = screenAt(uv, 15.0, cmy.x);
  float dm = screenAt(uv, 75.0, cmy.y);
  float dy = screenAt(uv, 0.0, cmy.z);
  float dk = screenAt(uv, 45.0, k);

  if (u_showChannels) { fragColor = vec4(dc, dm, dy, 1.0); return; }

  vec3 col = vec3(1.0);
  col -= vec3(0.0, 1.0, 1.0) * dc;
  col -= vec3(1.0, 0.0, 1.0) * dm;
  col -= vec3(1.0, 1.0, 0.0) * dy;
  col *= 1.0 - dk;

  fragColor = vec4(mix(u_paper, clamp(col, 0.0, 1.0), 1.0), 1.0);
}
