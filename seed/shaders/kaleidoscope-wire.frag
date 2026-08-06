#version 300 es
precision highp float;

/*
 * kaleidoscope-wire — mirrored polar symmetry rendered as line work rather
 * than filled colour.
 *
 * The existing Kaleidoscope asset folds a colour field into wedges. This is
 * deliberately its opposite: the same fold, but every element is drawn as a
 * stroke, so the result reads as technical linework — a plotter drawing
 * rather than stained glass. All edges use fwidth-based antialiasing, which
 * matters far more here than in a filled shader: at these line weights,
 * aliased strokes shimmer badly under any rotation.
 */

uniform float u_time;
uniform vec2 u_resolution;

uniform int u_segments;       // @label(Segments) @range(2, 32) @default(8)
uniform float u_rotation;     // @label(Rotation) @range(-180, 180) @default(0) @unit(deg)
uniform float u_spin;         // @label(Auto spin) @range(-2, 2) @default(0.12) @mod
uniform float u_zoom;         // @label(Zoom) @range(0.2, 5) @default(1.1) @log @mod
uniform vec2 u_center;        // @label(Centre) @range(-1, 1) @default(0.0, 0.0) @group(Composition)

uniform int u_motif;          // @label(Motif) @select(Web=0 | Rings=1 | Lattice=2 | Spiral=3) @default(0)
uniform float u_density;      // @label(Density) @range(1, 30) @default(9) @log
uniform float u_lineWidth;    // @label(Line width) @range(0.002, 0.08) @default(0.012)
uniform float u_warp;         // @label(Warp) @range(0, 1.5) @default(0.25) @mod
uniform float u_warpRate;     // @label(Warp rate) @range(0.02, 2) @default(0.25)

uniform vec3 u_lineColor;     // @label(Lines) @color @default(0.0, 0.83, 1.0)
uniform vec3 u_accent;        // @label(Accent) @color @default(0.9, 0.25, 0.7)
uniform float u_accentMix;    // @label(Accent mix) @range(0, 1) @default(0.3)
uniform vec3 u_bg;            // @label(Background) @color @default(0.0, 0.0, 0.01)
uniform float u_glow;         // @label(Glow) @range(0, 1.5) @default(0.4)

out vec4 fragColor;

/** Antialiased line at a target value. */
float lineAt(float v, float target, float w) {
  float d = abs(v - target);
  float aa = fwidth(v) + 1e-5;
  return 1.0 - smoothstep(w - aa, w + aa, d);
}

/** Antialiased repeating stripe. */
float stripes(float v, float w) {
  float f = abs(fract(v) - 0.5) * 2.0;
  float aa = fwidth(v) * 2.0 + 1e-5;
  return 1.0 - smoothstep(w - aa, w + aa, f);
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / min(u_resolution.x, u_resolution.y);
  uv = (uv - u_center * 0.5) / u_zoom;

  float r = length(uv);
  float a = atan(uv.y, uv.x) + radians(u_rotation) + u_time * u_spin;

  // Fold into wedges, then mirror alternating wedges so edges meet cleanly.
  // u_segments MUST be an integer — atan2 wraps at ±π (the left edge of
  // screen), and this fold only tiles seamlessly across that wrap point
  // when 2π divides evenly into whole wedges. A fractional segment count
  // (this was `uniform float`, allowing values like 14.5) leaves a
  // leftover half-wedge exactly at the wrap seam — a visible break on the
  // left, independent of anything else in this shader.
  float seg = 6.28318 / max(float(u_segments), 2.0);
  a = mod(a, seg);
  a = abs(a - seg * 0.5);

  if (u_warp > 0.0) {
    r += u_warp * 0.08 * sin(a * 6.0 + u_time * u_warpRate * 3.0);
  }

  vec2 q = vec2(cos(a), sin(a)) * r;

  float mark = 0.0;
  if (u_motif == 1) {
    mark = stripes(r * u_density, u_lineWidth * u_density);
  } else if (u_motif == 2) {
    mark = max(stripes(q.x * u_density, u_lineWidth * u_density),
               stripes(q.y * u_density, u_lineWidth * u_density));
  } else if (u_motif == 3) {
    float spiral = r * u_density + a * u_density * 0.5;
    mark = stripes(spiral, u_lineWidth * u_density);
  } else {
    // Web: radial spokes plus concentric arcs.
    float spokes = stripes(a * u_density * 2.0, u_lineWidth * u_density * 2.0);
    float arcs = stripes(r * u_density, u_lineWidth * u_density);
    float diag = lineAt(q.x - q.y, 0.0, u_lineWidth);
    mark = max(max(spokes, arcs), diag * 0.7);
  }

  vec3 stroke = mix(u_lineColor, u_accent, u_accentMix * smoothstep(0.0, 1.2, r));
  vec3 col = mix(u_bg, stroke, mark);
  col += stroke * mark * u_glow * 0.5;

  fragColor = vec4(col, 1.0);
}
