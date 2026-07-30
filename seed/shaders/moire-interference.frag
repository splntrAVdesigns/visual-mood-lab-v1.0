#version 300 es
precision highp float;

/* moire-interference — several rotating line grids multiplied together.
   Almost nothing is drawn: the visible pattern is entirely emergent from
   interference between layers, which is why it stays hypnotic at very low
   visual complexity. Fits the minimal aesthetic exactly. */

uniform float u_time;
uniform vec2 u_resolution;

uniform int u_layers;          // @label(Layers) @range(2, 6) @default(3)
uniform float u_frequency;     // @label(Frequency) @range(4, 200) @default(38) @log @unit(lines)
uniform float u_spreadAngle;   // @label(Angle spread) @range(0, 90) @default(7) @unit(deg) @hint(Small values give wide, slow beats.)
uniform float u_spin;          // @label(Spin) @range(-1, 1) @default(0.05)
uniform float u_scaleDrift;    // @label(Scale drift) @range(0, 0.5) @default(0.06) @hint(Slowly detunes layer spacing.)

uniform int u_shape;           // @label(Grid) @select(Lines=0 | Rings=1 | Radial=2 | Squares=3) @default(0)
uniform float u_duty;          // @label(Line weight) @range(0.05, 0.95) @default(0.5)
uniform float u_softness;      // @label(Softness) @range(0.001, 0.5) @default(0.08)

uniform vec2 u_center;         // @label(Centre) @range(-1, 1) @group(Composition)
uniform float u_warp;          // @label(Lens warp) @range(-1, 1) @default(0.15) @group(Composition)

uniform vec3 u_ink;            // @label(Ink) @color @default(0.0, 0.83, 1.0)
uniform vec3 u_paper;          // @label(Paper) @color @default(0.0, 0.0, 0.02)
uniform float u_bloom;         // @label(Bloom) @range(0, 1) @default(0.35)
uniform bool u_invert;         // @label(Invert) @default(false)

out vec4 fragColor;

mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

float grid(vec2 p, float freq) {
  float v;
  if (u_shape == 1) {
    v = fract(length(p) * freq * 0.15);
  } else if (u_shape == 2) {
    v = fract(atan(p.y, p.x) / 6.2831 * freq * 0.5);
  } else if (u_shape == 3) {
    vec2 g = fract(p * freq * 0.08);
    v = max(abs(g.x - 0.5), abs(g.y - 0.5)) + 0.5;
    v = fract(v);
  } else {
    v = fract(p.x * freq * 0.08);
  }
  float edge = abs(v - 0.5) * 2.0;
  return smoothstep(u_duty - u_softness, u_duty + u_softness, edge);
}

void main() {
  vec2 uv = (gl_FragCoord.xy * 2.0 - u_resolution) / min(u_resolution.x, u_resolution.y);
  uv -= u_center;

  /* Gentle lens warp keeps the interference from looking mechanical. */
  float r = length(uv);
  uv *= 1.0 + u_warp * r * r;

  float acc = 1.0;
  for (int i = 0; i < 6; i++) {
    if (i >= u_layers) break;
    float fi = float(i);
    float a = radians(u_spreadAngle) * (fi - float(u_layers - 1) * 0.5)
            + u_time * u_spin * (1.0 + fi * 0.15);
    float freq = u_frequency * (1.0 + sin(u_time * 0.2 + fi) * u_scaleDrift);
    acc *= grid(rot(a) * uv, freq);
  }

  if (u_invert) acc = 1.0 - acc;

  vec3 col = mix(u_paper, u_ink, acc);
  col += u_ink * acc * u_bloom * (1.0 - smoothstep(0.0, 1.4, r));

  fragColor = vec4(col, 1.0);
}
