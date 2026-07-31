#version 300 es
precision highp float;

/*
 * wormhole — an endless tunnel built from polar coordinates.
 *
 * The whole illusion is one substitution: instead of texturing by (x, y),
 * texture by (angle, 1/radius). Because 1/r grows without bound as r
 * approaches zero, marching that coordinate forward in time produces
 * perfectly periodic depth — bands rush outward from the centre forever
 * with no geometry, no raymarching, and no seam to hide. Everything else
 * here is shaping on top of that.
 */

uniform float u_time;
uniform vec2 u_resolution;

uniform float u_speed;        // @label(Travel speed) @range(-3, 3) @default(0.55) @mod
uniform float u_twist;        // @label(Twist) @range(-4, 4) @default(0.6) @mod @hint(Rotation applied proportional to depth.)
uniform float u_depthScale;   // @label(Depth scale) @range(0.1, 3) @default(0.6) @log
uniform float u_flare;        // @label(Centre flare) @range(0, 2) @default(0.7)

uniform int u_pattern;        // @label(Wall pattern) @select(Rings=0 | Grid=1 | Noise=2 | Panels=3) @default(1)
uniform float u_rings;        // @label(Ring density) @range(1, 40) @default(10) @log
uniform float u_spokes;       // @label(Spoke count) @range(2, 64) @default(16)
uniform float u_lineWidth;    // @label(Line width) @range(0.01, 0.5) @default(0.08)

uniform float u_wobble;       // @label(Wobble) @range(0, 0.6) @default(0.08) @hint(Off-axis sway of the tunnel mouth.)
uniform float u_wobbleRate;   // @label(Wobble rate) @range(0.05, 3) @default(0.4)

uniform vec3 u_nearColor;     // @label(Near) @color @default(0.0, 0.83, 1.0)
uniform vec3 u_farColor;      // @label(Far) @color @default(0.35, 0.05, 0.6)
uniform vec3 u_bg;            // @label(Void) @color @default(0.0, 0.0, 0.01)
uniform float u_fog;          // @label(Depth fog) @range(0, 1) @default(0.55)

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
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / min(u_resolution.x, u_resolution.y);

  // Sway the tunnel mouth so the centre isn't nailed to the exact middle.
  uv -= u_wobble * vec2(cos(u_time * u_wobbleRate), sin(u_time * u_wobbleRate * 1.31));

  float r = max(length(uv), 1e-4);
  float a = atan(uv.y, uv.x);

  // The substitution: depth is 1/r, so it grows without bound toward the
  // centre and marching it in time loops seamlessly.
  float depth = u_depthScale / r + u_time * u_speed;
  float angle = a / 6.28318 + depth * u_twist * 0.1;

  float mark;
  float aa;
  if (u_pattern == 0) {
    float band = fract(depth * u_rings * 0.25);
    aa = fwidth(band) + 1e-4;
    mark = 1.0 - smoothstep(u_lineWidth - aa, u_lineWidth + aa, abs(band - 0.5) * 2.0);
  } else if (u_pattern == 2) {
    float n = gnoise(vec2(angle * u_spokes, depth * u_rings * 0.4));
    mark = smoothstep(-0.1, 0.35, n);
  } else if (u_pattern == 3) {
    vec2 cell = vec2(floor(angle * u_spokes), floor(depth * u_rings * 0.3));
    float h = fract(sin(dot(cell, vec2(41.3, 289.1))) * 43758.5453);
    vec2 f = fract(vec2(angle * u_spokes, depth * u_rings * 0.3));
    vec2 e = abs(f - 0.5);
    aa = fwidth(max(e.x, e.y)) + 1e-4;
    float border = 1.0 - smoothstep(0.5 - u_lineWidth - aa, 0.5 - u_lineWidth + aa, max(e.x, e.y));
    mark = border * step(0.35, h);
  } else {
    vec2 g = abs(fract(vec2(angle * u_spokes, depth * u_rings * 0.3)) - 0.5);
    float lines = min(g.x, g.y);
    aa = fwidth(lines) + 1e-4;
    mark = 1.0 - smoothstep(u_lineWidth - aa, u_lineWidth + aa, lines);
  }

  // Fog by radius: far walls (small r, near the centre) sink toward the void.
  float fogT = clamp(pow(r * 2.2, 0.7), 0.0, 1.0);
  vec3 wall = mix(u_farColor, u_nearColor, fogT);
  vec3 col = mix(u_bg, wall, mark * mix(1.0, fogT, u_fog));

  // Bright core where the tunnel recedes to nothing.
  col += u_nearColor * u_flare * pow(clamp(1.0 - r * 3.0, 0.0, 1.0), 3.0);

  fragColor = vec4(col, 1.0);
}
