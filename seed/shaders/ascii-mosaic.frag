#version 300 es
precision highp float;

/* ascii-mosaic — luminance quantised into procedural bitmap glyphs.
   Generates its own animated source when nothing is linked, so it is never
   a black rectangle. */

uniform float u_time;
uniform vec2 u_resolution;
uniform bool u_hasSource;
uniform sampler2D u_src;       // @label(Source) @hint(Optional. Leave empty for the built-in pattern.)

uniform float u_cell;          // @label(Cell size) @range(4, 48) @default(11) @log @unit(px)
uniform int u_levels;          // @label(Glyph levels) @range(2, 8) @default(7)
uniform float u_contrast;      // @label(Contrast) @range(0.25, 4) @default(1.5) @log
uniform float u_gamma;         // @label(Gamma) @range(0.25, 3) @default(1)
uniform int u_pattern;         // @label(Built-in pattern) @select(Ripples=0 | Plasma=1 | Tunnel=2 | Spiral=3) @default(1)
uniform float u_speed;         // @label(Speed) @range(0, 3) @default(0.6)
uniform float u_swirl;         // @label(Swirl) @range(0, 4) @default(1.1)
uniform vec3 u_ink;            // @label(Ink) @color @default(0.0, 0.83, 1.0)
uniform vec3 u_paper;          // @label(Paper) @color @default(0.0, 0.0, 0.0)
uniform bool u_invert;         // @label(Invert) @default(false)
uniform bool u_colorRamp;      // @label(Colour ramp) @default(true) @hint(Tint brighter glyphs toward white.)
uniform float u_scanJitter;    // @label(Scan jitter) @range(0, 1) @default(0) @advanced

out vec4 fragColor;

int glyphAt(int level) {
  if (level <= 0) return 0;
  if (level == 1) return 1048576;
  if (level == 2) return 1116704;
  if (level == 3) return 4329604;
  if (level == 4) return 11512810;
  if (level == 5) return 32505856;
  if (level == 6) return 33532415;
  return 33554431;
}

float glyphMask(int level, vec2 p) {
  ivec2 g = ivec2(floor(p * 5.0));
  if (g.x < 0 || g.x > 4 || g.y < 0 || g.y > 4) return 0.0;
  int bit = g.y * 5 + g.x;
  return float((glyphAt(level) >> bit) & 1);
}

/* Built-in animated source. Returns 0..1 luminance. */
float builtin(vec2 uv) {
  vec2 p = (uv - 0.5) * 2.0;
  p.x *= u_resolution.x / max(u_resolution.y, 1.0);
  float t = u_time * u_speed;
  float r = length(p);
  float a = atan(p.y, p.x);

  if (u_pattern == 0) {
    return 0.5 + 0.5 * sin(r * 12.0 - t * 3.0);
  }
  if (u_pattern == 2) {
    return 0.5 + 0.5 * sin(1.0 / max(r, 0.08) * 3.0 + t * 2.0);
  }
  if (u_pattern == 3) {
    return 0.5 + 0.5 * sin(a * 4.0 + r * 10.0 * u_swirl - t * 2.0);
  }
  /* Plasma */
  float v = sin(p.x * 4.0 + t);
  v += sin(p.y * 4.0 - t * 0.8);
  v += sin((p.x + p.y) * 3.0 + t * 1.3);
  v += sin(r * 8.0 * u_swirl - t * 1.7);
  return 0.5 + 0.25 * v * 0.5;
}

void main() {
  vec2 cellId = floor(gl_FragCoord.xy / u_cell);
  vec2 cellUv = fract(gl_FragCoord.xy / u_cell);
  vec2 uv = (cellId + 0.5) * u_cell / u_resolution;
  uv.x += sin(cellId.y * 3.7 + u_time) * u_scanJitter * 0.02;

  vec3 src = u_hasSource ? texture(u_src, uv).rgb : vec3(builtin(uv));
  float lum = dot(src, vec3(0.2126, 0.7152, 0.0722));

  lum = pow(clamp((lum - 0.5) * u_contrast + 0.5, 0.0, 1.0), u_gamma);
  if (u_invert) lum = 1.0 - lum;

  int level = int(floor(lum * float(u_levels) + 0.5));
  float mask = glyphMask(level, cellUv);

  vec3 ink = u_hasSource ? src : u_ink;
  if (u_colorRamp) ink = mix(ink, vec3(1.0), lum * 0.55);

  fragColor = vec4(mix(u_paper, ink, mask), 1.0);
}
