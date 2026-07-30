#version 300 es
precision highp float;

/* truchet-weave — random quarter-arc tiles forming continuous paths.
   Classic Truchet, with an over/under weave option for a knotwork read. */

uniform float u_time;
uniform vec2 u_resolution;

uniform float u_tiles;         // @label(Tiles) @range(2, 40) @default(9) @log
uniform float u_lineWidth;     // @label(Line width) @range(0.02, 0.45) @default(0.13)
uniform int u_style;           // @label(Style) @select(Arcs=0 | Diagonals=1 | Weave=2 | Maze=3) @default(0)
uniform int u_seed;            // @label(Seed) @range(0, 64) @default(7)
uniform float u_drift;         // @label(Drift) @range(0, 1) @default(0.08)
uniform vec3 u_line;           // @label(Line) @color @default(0.0, 0.83, 1.0)
uniform vec3 u_ground;         // @label(Ground) @color @default(0.02, 0.02, 0.03)
uniform float u_softness;      // @label(Softness) @range(0.001, 0.08) @default(0.012) @advanced
uniform bool u_showTiles;      // @label(Show tile edges) @default(false) @advanced

out vec4 fragColor;

float hash(vec2 p, int seed) {
  p += float(seed) * 13.37;
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float arcs(vec2 f, bool flip, float w, float soft) {
  if (flip) f.x = 1.0 - f.x;
  float d1 = abs(length(f) - 0.5);
  float d2 = abs(length(f - 1.0) - 0.5);
  float d = min(d1, d2);
  return 1.0 - smoothstep(w - soft, w + soft, d);
}

float diagonal(vec2 f, bool flip, float w, float soft) {
  if (flip) f.x = 1.0 - f.x;
  float d = abs(f.y - f.x) * 0.7071;
  return 1.0 - smoothstep(w - soft, w + soft, d);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  uv.x *= u_resolution.x / u_resolution.y;

  vec2 grid = uv * u_tiles + vec2(u_time * u_drift, 0.0);
  vec2 id = floor(grid);
  vec2 f = fract(grid);

  float h = hash(id, u_seed);
  bool flip = h > 0.5;

  float mask;
  if (u_style == 1) {
    mask = diagonal(f, flip, u_lineWidth, u_softness);
  } else if (u_style == 2) {
    float a = arcs(f, flip, u_lineWidth, u_softness);
    float b = arcs(f, !flip, u_lineWidth * 0.55, u_softness);
    /* Punch the thinner pass out of the thicker one to fake over/under. */
    mask = max(a - b * step(0.5, fract(h * 7.0)), 0.0);
  } else if (u_style == 3) {
    float a = diagonal(f, flip, u_lineWidth, u_softness);
    float b = arcs(f, flip, u_lineWidth, u_softness);
    mask = mix(a, b, step(0.5, fract(h * 3.0)));
  } else {
    mask = arcs(f, flip, u_lineWidth, u_softness);
  }

  vec3 col = mix(u_ground, u_line, mask);

  if (u_showTiles) {
    vec2 e = abs(f - 0.5);
    float edge = 1.0 - smoothstep(0.48, 0.5, max(e.x, e.y));
    col = mix(col, vec3(0.15), (1.0 - edge) * 0.6);
  }

  fragColor = vec4(col, 1.0);
}
