#version 300 es
precision highp float;

/*
 * mandelbrot — the escape-time set, with a continuous-colour palette and a
 * live morph toward the Julia set.
 *
 * Escape-time fractals band badly if you colour by raw iteration count —
 * the integer boundary between "escaped at 40" and "escaped at 41" becomes
 * a visible contour. The smooth-iteration formula below subtracts the
 * fractional overshoot, which is what turns those bands into a continuous
 * gradient. That single line is most of what separates a fractal that looks
 * rendered from one that looks computed.
 */

uniform float u_time;
uniform vec2 u_resolution;

uniform float u_zoom;         // @label(Zoom) @range(0.2, 400) @default(0.9) @log @mod
uniform vec2 u_center;        // @label(Centre) @range(-2, 2) @default(-0.6, 0.0) @group(Composition)
uniform int u_iterations;     // @label(Iterations) @range(24, 400) @default(120) @hint(Higher resolves deeper detail but costs more per pixel.)
uniform float u_escape;       // @label(Escape radius) @range(2, 64) @default(16) @log

uniform float u_julia;        // @label(Julia morph) @range(0, 1) @default(0) @mod @hint(Blends from the Mandelbrot set toward a Julia set of the seed below.)
uniform vec2 u_juliaSeed;     // @label(Julia seed) @range(-1.5, 1.5) @default(-0.79, 0.15)
uniform bool u_animateSeed;   // @label(Drift seed) @default(false)
uniform float u_driftSpeed;   // @label(Drift speed) @range(0.02, 1.5) @default(0.15)

uniform float u_paletteScale; // @label(Palette scale) @range(0.02, 2) @default(0.14) @log
uniform float u_paletteShift; // @label(Palette shift) @range(0, 1) @default(0) @mod
uniform vec3 u_colorA;        // @label(Colour A) @color @default(0.0, 0.83, 1.0)
uniform vec3 u_colorB;        // @label(Colour B) @color @default(0.55, 0.1, 0.8)
uniform vec3 u_interior;      // @label(Interior) @color @default(0.0, 0.0, 0.02)
uniform float u_glow;         // @label(Edge glow) @range(0, 2) @default(0.6)

out vec4 fragColor;

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / min(u_resolution.x, u_resolution.y);
  vec2 c = uv / u_zoom + u_center;

  vec2 seed = u_juliaSeed;
  if (u_animateSeed) {
    float a = u_time * u_driftSpeed;
    seed += 0.18 * vec2(cos(a), sin(a * 1.3));
  }

  // Blend the starting conditions rather than branching: at julia=0 this is
  // the Mandelbrot iteration (z starts at 0, c is the pixel), at julia=1 it
  // is the Julia iteration (z starts at the pixel, c is the fixed seed).
  vec2 z = mix(vec2(0.0), c, u_julia);
  vec2 k = mix(c, seed, u_julia);

  float esc = u_escape;
  float esc2 = esc * esc;
  int steps = 0;
  float m2 = 0.0;

  for (int i = 0; i < 400; i++) {
    if (i >= u_iterations) break;
    z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + k;
    m2 = dot(z, z);
    if (m2 > esc2) break;
    steps++;
  }

  vec3 col;
  if (steps >= u_iterations) {
    col = u_interior;
  } else {
    // Smooth (continuous) iteration count — removes the integer banding.
    float nu = float(steps) - log2(max(log2(sqrt(m2)) / log2(esc), 1e-6));
    float t = fract(nu * u_paletteScale + u_paletteShift);
    col = mix(u_colorA, u_colorB, 0.5 + 0.5 * cos(6.28318 * t));

    float edge = 1.0 - clamp(float(steps) / float(u_iterations), 0.0, 1.0);
    col += u_colorA * pow(edge, 3.0) * u_glow;
  }

  fragColor = vec4(col, 1.0);
}
