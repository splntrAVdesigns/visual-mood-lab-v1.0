#version 300 es
precision highp float;

/* kaleidoscope — polar mirror segments with adjustable pivot and twist. */

uniform float u_time;
uniform vec2 u_resolution;
uniform sampler2D u_src;       // @label(Source)

uniform int u_segments;        // @label(Segments) @range(2, 32) @default(8)
uniform vec2 u_center;         // @label(Pivot) @range(-1, 1) @group(Composition)
uniform float u_rotation;      // @label(Rotation) @range(-180, 180) @default(0) @unit(deg) @group(Composition)
uniform float u_spin;          // @label(Spin) @range(-2, 2) @default(0.15) @group(Composition)
uniform float u_zoom;          // @label(Zoom) @range(0.2, 5) @default(1) @log
uniform float u_twist;         // @label(Twist) @range(-3, 3) @default(0)
uniform float u_edgeFade;      // @label(Edge fade) @range(0, 1) @default(0.25)
uniform bool u_mirror;         // @label(Mirror segments) @default(true)
uniform vec3 u_wash;           // @label(Colour wash) @color @default(1.0, 1.0, 1.0) @advanced

out vec4 fragColor;

const float TAU = 6.283185307179586;

void main() {
  vec2 uv = (gl_FragCoord.xy * 2.0 - u_resolution) / min(u_resolution.x, u_resolution.y);
  uv -= u_center;

  float r = length(uv);
  float a = atan(uv.y, uv.x) + radians(u_rotation) + u_time * u_spin;

  a += r * u_twist;

  float seg = TAU / float(u_segments);
  a = mod(a, seg);
  if (u_mirror) a = abs(a - seg * 0.5);

  vec2 p = vec2(cos(a), sin(a)) * r / u_zoom;
  vec3 col = texture(u_src, p * 0.5 + 0.5).rgb * u_wash;

  col *= 1.0 - smoothstep(1.0 - u_edgeFade, 1.0, r);

  fragColor = vec4(col, 1.0);
}
