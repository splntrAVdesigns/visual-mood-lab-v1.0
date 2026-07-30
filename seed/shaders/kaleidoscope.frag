#version 300 es
precision highp float;

/* kaleidoscope — proper mirrored polar segments over a procedural source.
   The previous version folded the angle but then sampled an unlinked 1x1
   texture, which is why it was just a blurred circle. It now generates a
   rich animated field of its own and mirrors that. */

uniform float u_time;
uniform vec2 u_resolution;
uniform bool u_hasSource;
uniform sampler2D u_src;       // @label(Source) @hint(Optional. Leave empty for the built-in field.)

uniform int u_segments;        // @label(Segments) @range(2, 24) @default(8)
uniform bool u_mirror;         // @label(Mirror segments) @default(true)
uniform float u_zoom;          // @label(Zoom) @range(0.2, 5) @default(0.85) @log
uniform vec2 u_center;         // @label(Pivot) @range(-1, 1) @group(Composition)
uniform float u_rotation;      // @label(Rotation) @range(-180, 180) @default(0) @unit(deg) @group(Composition)
uniform float u_spin;          // @label(Spin) @range(-2, 2) @default(0.22) @group(Composition)
uniform float u_twist;         // @label(Radial twist) @range(-4, 4) @default(0.8)
uniform float u_breathe;       // @label(Breathe) @range(0, 1) @default(0.18) @hint(Pulses zoom over time.)

uniform int u_source;          // @label(Field) @select(Rings=0 | Petals=1 | Cells=2 | Filaments=3) @default(1)
uniform float u_detail;        // @label(Field detail) @range(1, 24) @default(7) @log
uniform float u_flow;          // @label(Field flow) @range(0, 3) @default(0.7)
uniform vec3 u_colorA;         // @label(Colour A) @color @default(0.0, 0.83, 1.0)
uniform vec3 u_colorB;         // @label(Colour B) @color @default(0.55, 0.1, 0.9)
uniform vec3 u_colorC;         // @label(Colour C) @color @default(0.0, 0.0, 0.05)
uniform float u_bands;         // @label(Banding) @range(1, 12) @default(1) @hint(Higher values posterise into rings.)
uniform float u_edgeFade;      // @label(Edge fade) @range(0, 1) @default(0.15)
uniform float u_glow;          // @label(Centre glow) @range(0, 1) @default(0.25) @advanced

out vec4 fragColor;

const float TAU = 6.283185307179586;

mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x),
             mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}

/* Procedural field sampled through the kaleidoscopic fold. */
float field(vec2 p) {
  float t = u_time * u_flow;
  float d = u_detail;

  if (u_source == 0) {
    return 0.5 + 0.5 * sin(length(p) * d * 2.0 - t * 2.0);
  }
  if (u_source == 2) {
    vec2 g = p * d * 0.6;
    vec2 id = floor(g);
    float best = 1.0;
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec2 o = vec2(float(x), float(y));
        vec2 c = o + vec2(hash(id + o), hash(id + o + 3.7));
        c += 0.3 * sin(t + hash(id + o) * TAU);
        best = min(best, length(fract(g) - c));
      }
    }
    return 1.0 - best;
  }
  if (u_source == 3) {
    float n = noise(p * d + vec2(t * 0.3, 0.0));
    n += 0.5 * noise(p * d * 2.1 - vec2(0.0, t * 0.2));
    return fract(n * 2.0);
  }
  /* Petals */
  float a = atan(p.y, p.x);
  float r = length(p);
  return 0.5 + 0.5 * sin(a * d * 0.5 + sin(r * d - t * 1.5) * 2.0);
}

void main() {
  vec2 uv = (gl_FragCoord.xy * 2.0 - u_resolution) / min(u_resolution.x, u_resolution.y);
  uv -= u_center;

  float r = length(uv);
  float a = atan(uv.y, uv.x) + radians(u_rotation) + u_time * u_spin;

  /* Radial twist before folding — this is what makes segments interlock
     rather than sit as flat wedges. */
  a += r * u_twist;

  float seg = TAU / float(u_segments);
  a = mod(a, seg);
  if (u_mirror) a = abs(a - seg * 0.5);

  float zoom = u_zoom * (1.0 + sin(u_time * 0.7) * u_breathe);
  vec2 p = vec2(cos(a), sin(a)) * r / max(zoom, 0.01);

  float v;
  if (u_hasSource) {
    v = dot(texture(u_src, p * 0.5 + 0.5).rgb, vec3(0.2126, 0.7152, 0.0722));
  } else {
    v = clamp(field(p), 0.0, 1.0);
  }

  if (u_bands > 1.0) v = floor(v * u_bands) / (u_bands - 1.0);

  vec3 col = v < 0.5 ? mix(u_colorC, u_colorA, v * 2.0)
                     : mix(u_colorA, u_colorB, (v - 0.5) * 2.0);

  col += u_colorA * u_glow * exp(-r * 4.0);
  col *= 1.0 - smoothstep(1.0 - u_edgeFade, 1.05, r);

  fragColor = vec4(col, 1.0);
}
