#version 300 es
precision highp float;

/*
 * mask-field — a soft, large-scale flowing gradient revealed or clipped by
 * a scattering of animated geometric shapes, for a kinetic album-cover /
 * cut-paper collage read.
 *
 * The gradient and the mask shapes are computed completely independently
 * of each other — the gradient never knows a shape exists, the shapes
 * never sample the gradient — then combined with a single mix() at the
 * very end. Reveal mode shows the gradient only where a shape covers the
 * pixel and a flat colour everywhere else; Clip mode is the exact
 * inverse. Same two fields, one sign flip on the mask, genuinely
 * different composition — the geometry is doing the work a mask layer
 * would do in a design tool, not a metaball/liquid technique at all.
 */

uniform float u_time;
uniform vec2 u_resolution;

uniform int u_shapeCount;       // @label(Shape count) @range(1, 10) @default(5)
uniform int u_shapeType;        // @label(Shape type) @select(Circle=0 | Bar=1 | Triangle=2 | Square=3 | Octagon=4 | X=5 | Mixed=6) @default(6)
uniform float u_shapeSize;      // @label(Shape size) @range(0.05, 0.6) @default(0.28) @mod
uniform float u_sizeVariance;   // @label(Size variance) @range(0, 1) @default(0.4)
uniform float u_driftSpeed;     // @label(Drift speed) @range(0, 2) @default(0.3) @mod
uniform float u_rotationSpeed;  // @label(Rotation speed) @range(-2, 2) @default(0.4) @mod
uniform float u_softness;       // @label(Edge softness) @range(0, 0.1) @default(0.01)

uniform int u_mode;             // @label(Mode) @select(Reveal=0 | Clip=1) @default(0) @hint(Reveal shows the gradient inside the shapes and a flat colour outside; Clip is the exact inverse.)

uniform float u_gradientScale;  // @label(Gradient scale) @range(0.3, 4) @default(1.2)
uniform float u_gradientSpeed;  // @label(Gradient flow speed) @range(0, 1.5) @default(0.25) @mod
uniform vec3 u_gradA;           // @label(Gradient A) @color @default(1.0, 0.35, 0.15)
uniform vec3 u_gradB;           // @label(Gradient B) @color @default(0.1, 0.15, 0.95)
uniform vec3 u_gradC;           // @label(Gradient C) @color @default(1.0, 0.85, 0.1)

uniform vec3 u_flatColor;       // @label(Flat color) @color @default(0.02, 0.02, 0.03)

out vec4 fragColor;

float hash11(float p) { return fract(sin(p * 127.1) * 43758.5453); }

float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash11(dot(i, vec2(1.0, 57.0)));
  float b = hash11(dot(i + vec2(1.0, 0.0), vec2(1.0, 57.0)));
  float c = hash11(dot(i + vec2(0.0, 1.0), vec2(1.0, 57.0)));
  float d = hash11(dot(i + vec2(1.0, 1.0), vec2(1.0, 57.0)));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.0; a *= 0.5; }
  return v;
}

mat2 rot(float a) { return mat2(cos(a), -sin(a), sin(a), cos(a)); }

float sdCircle(vec2 p, float r) { return length(p) - r; }

float sdBar(vec2 p, vec2 b) {
  vec2 q = abs(p) - b;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
}

/* Inigo Quilez's equilateral-triangle SDF. */
float sdTriangle(vec2 p, float r) {
  const float k = 1.7320508;
  p.x = abs(p.x) - r;
  p.y = p.y + r / k;
  if (p.x + k * p.y > 0.0) p = vec2(p.x - k * p.y, -k * p.x - p.y) / 2.0;
  p.x -= clamp(p.x, -2.0 * r, 0.0);
  return -length(p) * sign(p.y);
}

/* Chamfered box — a regular octagon is exactly this SDF at chamfer =
   r*(sqrt(2)-1), not a coincidence worth hiding behind a separate
   implementation. */
float sdChamferBox(vec2 p, vec2 b, float c) {
  vec2 q = abs(p) - b;
  float d = max(q.x, q.y);
  return max(d, (q.x + q.y + c) * 0.70710678);
}

float sdOctagon(vec2 p, float r) {
  return sdChamferBox(p, vec2(r), r * 0.41421356);
}

/* Two crossed bars. */
float sdX(vec2 p, float r, float thickness) {
  mat2 rot45 = mat2(0.70710678, -0.70710678, 0.70710678, 0.70710678);
  float d1 = sdBar(p, vec2(r, thickness));
  float d2 = sdBar(rot45 * p, vec2(r, thickness));
  return min(d1, d2);
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / min(u_resolution.x, u_resolution.y);

  // Background flowing gradient — large scale, smooth, deliberately fewer
  // octaves and a simpler blend than Liquid Panel/Liquid Gradient's
  // lava-lamp complexity, closer to a modern brand/product ambient
  // gradient than a liquid simulation.
  vec2 gp = uv * u_gradientScale;
  float gt = u_time * u_gradientSpeed;
  float n1 = fbm(gp + vec2(gt, -gt * 0.7));
  float n2 = fbm(gp * 1.6 - vec2(gt * 0.5, gt));
  vec3 gradient = mix(u_gradA, u_gradB, smoothstep(0.2, 0.8, n1));
  gradient = mix(gradient, u_gradC, smoothstep(0.35, 0.9, n2) * 0.6);

  // Mask shapes — one unioned SDF value per pixel, the nearest of every
  // shape currently on screen.
  int count = clamp(u_shapeCount, 1, 10);
  float shapeDist = 1e6;
  for (int i = 0; i < 10; i++) {
    if (i >= count) break;
    float fi = float(i);
    float seed = hash11(fi * 12.9 + 3.0);
    float seed2 = hash11(fi * 7.7 + 11.0);

    vec2 center = vec2(
      sin(u_time * u_driftSpeed * (0.5 + seed * 0.6) + seed * 30.0),
      cos(u_time * u_driftSpeed * (0.4 + seed2 * 0.7) + seed2 * 17.0)
    ) * mix(0.15, 0.65, seed2);

    vec2 p = uv - center;
    p = rot(u_time * u_rotationSpeed * (0.5 + seed) + seed * 6.283) * p;

    float size = u_shapeSize * mix(1.0 - u_sizeVariance, 1.0 + u_sizeVariance, seed);

    int shapeType = u_shapeType;
    if (shapeType == 6) shapeType = int(mod(fi, 6.0));

    float d;
    if (shapeType == 0) d = sdCircle(p, size);
    else if (shapeType == 1) d = sdBar(p, vec2(size * 1.6, size * 0.55));
    else if (shapeType == 2) d = sdTriangle(p, size);
    else if (shapeType == 3) d = sdBar(p, vec2(size, size));
    else if (shapeType == 4) d = sdOctagon(p, size);
    else d = sdX(p, size, size * 0.32);

    shapeDist = min(shapeDist, d);
  }

  float aa = fwidth(shapeDist) + u_softness + 1e-4;
  float insideMask = 1.0 - smoothstep(-aa, aa, shapeDist);

  float revealMask = (u_mode == 1) ? (1.0 - insideMask) : insideMask;
  vec3 col = mix(u_flatColor, gradient, revealMask);

  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
