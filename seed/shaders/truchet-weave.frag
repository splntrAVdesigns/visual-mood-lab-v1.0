#version 300 es
precision highp float;

/* truchet-weave — animated Truchet tiling with per-tile rotation, depth
   shading and a travelling pulse along the paths. Far less flat than a
   simple pan. */

uniform float u_time;
uniform vec2 u_resolution;

uniform float u_tiles;         // @label(Tiles) @range(2, 30) @default(5) @log
uniform float u_lineWidth;     // @label(Line width) @range(0.02, 0.45) @default(0.15)
uniform int u_style;           // @label(Style) @select(Arcs=0 | Diagonals=1 | Weave=2 | Maze=3) @default(2)
uniform int u_patternSeed;     // @label(Seed) @advanced @nomidi @range(0, 64) @default(7)

uniform float u_flip;          // @label(Tile flip) @range(0, 2) @default(0.55) @hint(Animates tiles rotating between orientations.)
uniform float u_flipSpeed;     // @label(Flip speed) @range(0, 2) @default(0.35)
uniform float u_pulse;         // @label(Travelling pulse) @range(0, 1) @default(0.55)
uniform float u_pulseSpeed;    // @label(Pulse speed) @range(0, 4) @default(1.2)
uniform float u_drift;         // @label(Drift) @range(-1, 1) @default(0.06)
uniform float u_parallax;      // @label(Depth parallax) @range(0, 1) @default(0.35) @hint(Offsets a second layer for a sense of depth.)

uniform vec3 u_line;           // @label(Line) @color @default(0.0, 0.83, 1.0)
uniform vec3 u_lineFar;        // @label(Far line) @color @default(0.1, 0.15, 0.35)
uniform vec3 u_ground;         // @label(Ground) @color @default(0.02, 0.02, 0.03)
uniform float u_softness;      // @label(Softness) @range(0.001, 0.08) @default(0.014) @advanced
uniform bool u_showTiles;      // @label(Show tile edges) @default(false) @advanced

out vec4 fragColor;

float hash(vec2 p, int seed) {
  p += float(seed) * 13.37;
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

/* Distance to the tile's path, plus the arc-length coordinate so a pulse can
   travel along it. */
vec2 arcs(vec2 f, float w, float soft) {
  float d1 = abs(length(f) - 0.5);
  float d2 = abs(length(f - 1.0) - 0.5);
  float d = min(d1, d2);
  float s = d1 < d2 ? atan(f.y, f.x) : atan(1.0 - f.y, 1.0 - f.x);
  return vec2(1.0 - smoothstep(w - soft, w + soft, d), s);
}

vec2 diagonal(vec2 f, float w, float soft) {
  float d = abs(f.y - f.x) * 0.7071;
  return vec2(1.0 - smoothstep(w - soft, w + soft, d), (f.x + f.y) * 0.5);
}

vec2 tileAt(vec2 uv, float scale, float phaseOffset) {
  vec2 grid = uv * scale + vec2(u_time * u_drift, 0.0);
  vec2 id = floor(grid);
  vec2 f = fract(grid);

  float h = hash(id, u_patternSeed);

  /* Continuous rotation between the two Truchet orientations, staggered per
     tile — this is what makes the weave feel alive rather than panned. */
  float phase = u_time * u_flipSpeed + h * 6.2831 + phaseOffset;
  float turn = floor(mod(phase * u_flip, 2.0));
  if (turn > 0.5) f.x = 1.0 - f.x;
  if (h > 0.5) f.y = 1.0 - f.y;

  vec2 res;
  if (u_style == 1) {
    res = diagonal(f, u_lineWidth, u_softness);
  } else if (u_style == 2) {
    vec2 a = arcs(f, u_lineWidth, u_softness);
    vec2 b = arcs(vec2(1.0 - f.x, f.y), u_lineWidth * 0.5, u_softness);
    res = vec2(max(a.x - b.x * step(0.5, fract(h * 7.0)), 0.0), a.y);
  } else if (u_style == 3) {
    vec2 a = diagonal(f, u_lineWidth, u_softness);
    vec2 b = arcs(f, u_lineWidth, u_softness);
    res = mix(a, b, step(0.5, fract(h * 3.0)));
  } else {
    res = arcs(f, u_lineWidth, u_softness);
  }

  res.y += h * 6.2831;
  return res;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  uv.x *= u_resolution.x / u_resolution.y;

  /* Far layer first, then near — cheap parallax that reads as depth. */
  vec2 far = tileAt(uv + vec2(0.13, 0.07), u_tiles * 0.62, 1.7);
  vec2 near = tileAt(uv, u_tiles, 0.0);

  vec3 col = u_ground;
  col = mix(col, u_lineFar, far.x * u_parallax);

  float pulse = 0.5 + 0.5 * sin(near.y * 2.0 - u_time * u_pulseSpeed * 3.0);
  vec3 lineCol = mix(u_line * 0.35, u_line, mix(1.0, pulse, u_pulse));
  col = mix(col, lineCol, near.x);

  if (u_showTiles) {
    vec2 e = abs(fract(uv * u_tiles) - 0.5);
    float edge = smoothstep(0.47, 0.5, max(e.x, e.y));
    col = mix(col, vec3(0.15), edge * 0.25);
  }

  fragColor = vec4(col, 1.0);
}
