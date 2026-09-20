#version 300 es
precision highp float;

/* julia-orbit — animated Julia set shaded by orbit traps.
   Instead of colouring by escape count (which gives flat bands), each point
   records how close its orbit passes to a set of geometric traps. That is
   what produces the filigree, glass-like structure. The seed travels a slow
   closed path, so the whole form continuously morphs without ever
   repeating exactly. */

uniform float u_time;
uniform vec2 u_resolution;

uniform int u_iterations;      // @label(Iterations) @range(16, 256) @default(120)
uniform float u_zoom;          // @label(Zoom) @range(0.2, 8) @default(1.1) @log
uniform vec2 u_center;         // @label(Centre) @range(-1.5, 1.5) @group(Composition)
uniform float u_rotation;      // @label(Rotation) @range(-180, 180) @default(0) @unit(deg) @group(Composition)

uniform float u_seedRadius;    // @label(Seed radius) @advanced @nomidi @range(0, 1) @default(0.72) @hint(Distance of the Julia seed from origin.)
uniform float u_seedSpeed;     // @label(Seed drift) @advanced @nomidi @range(0, 1) @default(0.06) @hint(How fast the form morphs.)
uniform float u_seedPhase;     // @label(Seed phase) @advanced @nomidi @range(0, 6.283) @default(0)

uniform int u_trap;            // @label(Orbit trap) @select(Cross=0 | Ring=1 | Point=2 | Spiral=3) @default(0)
uniform float u_trapScale;     // @label(Trap scale) @range(0.1, 4) @default(1)
uniform float u_glow;          // @label(Glow) @range(0.2, 6) @default(2.2) @log

uniform vec3 u_colorA;         // @label(Inner) @color @default(0.0, 0.83, 1.0)
uniform vec3 u_colorB;         // @label(Outer) @color @default(0.45, 0.1, 0.75)
uniform vec3 u_colorC;         // @label(Void) @color @default(0.0, 0.0, 0.03)
uniform float u_bands;         // @label(Banding) @range(1, 16) @default(1)
uniform bool u_showSet;        // @label(Fill the set) @default(true) @advanced

out vec4 fragColor;

mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

float trapDist(vec2 z) {
  vec2 p = z * u_trapScale;
  if (u_trap == 1) return abs(length(p) - 0.7);
  if (u_trap == 2) return length(p - vec2(0.4, 0.2));
  if (u_trap == 3) {
    float a = atan(p.y, p.x);
    float r = length(p);
    return abs(fract((log(max(r, 1e-4)) * 0.7 + a / 6.2831) * 2.0) - 0.5);
  }
  return min(abs(p.x), abs(p.y));   /* cross */
}

void main() {
  vec2 uv = (gl_FragCoord.xy * 2.0 - u_resolution) / min(u_resolution.x, u_resolution.y);
  uv = rot(radians(u_rotation)) * uv;
  vec2 z = uv / u_zoom + u_center;

  /* Seed travels a lissajous path so the set morphs continuously without
     ever exactly repeating. */
  float t = u_time * u_seedSpeed + u_seedPhase;
  vec2 c = u_seedRadius * vec2(cos(t) * 0.8 + cos(t * 2.3) * 0.2,
                               sin(t * 1.3) * 0.8 + sin(t * 0.7) * 0.2);

  float minTrap = 1e9;
  float escaped = 0.0;
  int taken = 0;

  for (int i = 0; i < 256; i++) {
    if (i >= u_iterations) break;
    z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c;
    minTrap = min(minTrap, trapDist(z));
    taken = i;
    if (dot(z, z) > 64.0) { escaped = 1.0; break; }
  }

  float trap = exp(-minTrap * u_glow);
  float frac = float(taken) / float(max(u_iterations - 1, 1));

  vec3 col;
  if (escaped < 0.5 && u_showSet) {
    /* Inside the set: shade purely by trap proximity — this is where the
       filigree lives. */
    col = mix(u_colorC, u_colorA, trap);
  } else {
    float v = frac;
    if (u_bands > 1.0) v = floor(v * u_bands) / (u_bands - 1.0);
    col = mix(u_colorC, u_colorB, v);
    col = mix(col, u_colorA, trap * 0.8);
  }

  fragColor = vec4(col, 1.0);
}
