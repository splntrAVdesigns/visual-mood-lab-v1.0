#version 300 es
precision highp float;

/*
 * gradient-grid — Visual Mood Lab seed asset 01
 *
 * A cell lattice where each cell samples a two-stop gradient by its own
 * position, with adjustable skew, cell aspect, and edge treatment. Serves as
 * the reference implementation for the shader authoring convention: every
 * user-facing uniform carries annotations, everything host-driven comes from
 * DEFAULT_RESERVED and is never annotated.
 */

/* ---- host-driven (reserved — no controls generated) ---- */
uniform float u_time;
uniform vec2 u_resolution;
uniform vec2 u_mouse;

/* ---- user-facing ---- */

uniform float u_density;      // @label(Grid density) @range(1, 64) @default(12) @log @unit(cells)
uniform float u_cellAspect;   // @label(Cell aspect) @range(0.25, 4) @default(1) @log
uniform float u_skew;         // @label(Skew) @range(-1, 1) @default(0)
uniform vec2 u_center;        // @label(Center) @range(-1, 1) @group(Composition)
uniform float u_rotation;     // @label(Rotation) @range(-180, 180) @default(0) @unit(deg) @group(Composition)

uniform vec3 u_colorA;        // @label(Gradient start) @color @default(0.0, 0.83, 1.0)
uniform vec3 u_colorB;        // @label(Gradient end) @color @default(0.06, 0.06, 0.09)
uniform int u_ramp;           // @label(Ramp) @select(Linear=0 | Smooth=1 | Stepped=2 | Radial=3) @default(1)
uniform int u_steps;          // @label(Ramp steps) @range(2, 24) @default(6) @group(Composition)

uniform float u_gutter;       // @label(Gutter) @range(0, 0.45) @default(0.06)
uniform float u_cornerRadius; // @label(Corner radius) @range(0, 0.5) @default(0.08)
uniform float u_drift;        // @label(Drift) @range(0, 2) @default(0.25) @hint(Animates cell phase over time.)
uniform bool u_alternate;     // @label(Alternate rows) @default(true)
uniform bool u_showGrid;      // @label(Show lattice) @default(false) @advanced
uniform float u_jitter;       // @label(Jitter) @range(0, 1) @default(0) @advanced @nomod

out vec4 fragColor;

const float PI = 3.141592653589793;

mat2 rot(float a) {
  float c = cos(a), s = sin(a);
  return mat2(c, -s, s, c);
}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

/* Signed distance to a rounded box, used for the cell mask. */
float sdRoundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

float applyRamp(float t) {
  if (u_ramp == 0) return t;
  if (u_ramp == 1) return smoothstep(0.0, 1.0, t);
  if (u_ramp == 2) return floor(t * float(u_steps)) / float(max(u_steps - 1, 1));
  return 1.0 - abs(t * 2.0 - 1.0);
}

void main() {
  vec2 uv = (gl_FragCoord.xy * 2.0 - u_resolution) / min(u_resolution.x, u_resolution.y);

  uv -= u_center;
  uv *= rot(radians(u_rotation));
  uv.x += uv.y * u_skew;
  uv.x *= u_cellAspect;

  vec2 grid = uv * u_density;
  vec2 cellId = floor(grid);

  if (u_alternate && mod(cellId.y, 2.0) > 0.5) {
    grid.x += 0.5;
    cellId = floor(grid);
  }

  vec2 cellUv = fract(grid) - 0.5;

  float jitterPhase = u_jitter * (hash(cellId) - 0.5);
  float phase = u_time * u_drift + jitterPhase * 6.2831;

  /* Gradient parameter runs along the lattice diagonal so density changes
     read as a change in resolution rather than a change in palette. */
  float t = fract((cellId.x + cellId.y) / max(u_density, 1.0) * 0.5 + phase * 0.15);
  t = applyRamp(t);

  vec3 col = mix(u_colorB, u_colorA, t);

  float half_ = 0.5 - u_gutter;
  float d = sdRoundBox(cellUv, vec2(half_), u_cornerRadius * half_ * 2.0);
  float mask = 1.0 - smoothstep(-0.01, 0.01, d);

  col *= mask;

  if (u_showGrid) {
    vec2 g = abs(fract(grid) - 0.5);
    float line = 1.0 - smoothstep(0.0, 0.02, min(g.x, g.y));
    col = mix(col, vec3(0.15), line * 0.5);
  }

  fragColor = vec4(col, 1.0);
}
