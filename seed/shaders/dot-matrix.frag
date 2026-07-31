#version 300 es
precision highp float;

/*
 * dot-matrix — Visual Mood Lab seed asset 34
 *
 * Ported from a supplied "Dot Matrix 2" component built on the `ogl`
 * library as a real two-pass pipeline: pass one renders flowing colour
 * noise to an offscreen render target, pass two samples that target per
 * grid cell and draws a dot (or a glyph from a canvas-baked font atlas)
 * sized by the sampled brightness.
 *
 * This app's shader renderer runs one asset per fragment shader pass —
 * Feedback Trails is the one exception, and only because it needs its own
 * previous frame as an input, which is a different problem. Building
 * general multi-pass infrastructure for this one asset would be a real
 * architecture change to take on for a single visual. Collapsed here into
 * a single pass instead: the flowing-noise field and the per-cell dot
 * sampling both happen in the same shader invocation, using the same
 * gradient-noise helper Noise Field already uses elsewhere in this
 * library, rather than porting the original's simplex implementation
 * verbatim. Glyph-atlas text rendering is dropped in favour of procedural
 * dots/squares, consistent with how Ordered Dither and Halftone Screen
 * already render their cells — a canvas-baked font atlas has no
 * fragment-shader equivalent worth building for this one asset either.
 */

uniform float u_time;
uniform vec2 u_resolution;

uniform float u_cellSize;     // @label(Cell size) @range(4, 60) @default(20) @unit(px)
uniform float u_dotSize;      // @label(Dot size) @range(0.1, 1) @default(0.75) @hint(Fraction of the cell the dot can fill at full brightness.)
uniform int u_dotShape;       // @label(Dot shape) @select(Round=0 | Square=1) @default(0)

uniform float u_frequency;    // @label(Noise frequency) @range(0.3, 6) @default(1.6) @log @mod
uniform float u_speed;        // @label(Flow speed) @range(0, 2) @default(0.3) @mod
uniform float u_gamma;        // @label(Contrast) @range(0.4, 6) @default(2.2) @hint(Higher pushes brightness toward the extremes.)

uniform vec3 u_colorA;        // @label(Colour A) @color @default(0.0, 0.83, 1.0)
uniform vec3 u_colorB;        // @label(Colour B) @color @default(0.55, 0.1, 0.8)
uniform vec3 u_bg;            // @label(Background) @color @default(0.0, 0.0, 0.0)

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

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float aspect = u_resolution.x / max(u_resolution.y, 1.0);
  vec2 aspectUv = (uv - 0.5) * vec2(aspect, 1.0) + 0.5;

  float cellPx = max(u_cellSize, 2.0);
  vec2 cellCentrePx = (floor(gl_FragCoord.xy / cellPx) + 0.5) * cellPx;
  vec2 cellUvForSample = cellCentrePx / u_resolution;
  vec2 sampleUv = (cellUvForSample - 0.5) * vec2(aspect, 1.0) + 0.5;

  // Sample the flowing noise field once per CELL (not per pixel), matching
  // the original's two-pass behaviour where every pixel in a cell shared
  // one sampled value from the low-res render target.
  float n = gnoise(sampleUv * u_frequency * 4.0 + vec2(0.0, u_time * u_speed));
  float bright = pow(clamp(n * 0.5 + 0.5, 0.0, 1.0), 1.0 / max(u_gamma, 0.1));

  vec2 cellUv = fract(gl_FragCoord.xy / cellPx) - 0.5;
  float mark;
  if (u_dotShape == 1) {
    vec2 a = abs(cellUv);
    float halfSize = bright * u_dotSize * 0.5;
    mark = 1.0 - step(halfSize, max(a.x, a.y));
  } else {
    float dist = length(cellUv);
    float radius = bright * u_dotSize * 0.5;
    float aa = fwidth(dist) + 1e-4;
    mark = 1.0 - smoothstep(radius - aa, radius + aa, dist);
  }

  vec3 dotColor = mix(u_colorA, u_colorB, bright);
  vec3 col = mix(u_bg, dotColor, mark);

  fragColor = vec4(col, 1.0);
}
