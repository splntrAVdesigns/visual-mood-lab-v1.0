#version 300 es
precision highp float;

/*
 * refract-orb — a single raymarched glass object with genuine Fresnel-
 * weighted reflection/refraction and per-channel chromatic dispersion,
 * not a painted highlight over a flat disc. Uses the standard real-time
 * "thin-shell" glass trick (bend once at the surface, sample the
 * environment directly along the bent ray) rather than a full double-
 * refraction march through solid glass — the same technique most
 * real-time shader-art glass relies on, and fast enough to stay well
 * inside the renderer pool's per-tile budget.
 *
 * u_glassShape swaps the underlying SDF, so each shape reads as a
 * genuinely different material rather than the same look recut into a
 * different silhouette: the hex prism and octahedron get their faceted
 * character for free from flat-faced geometry, the blob is an actual
 * smin'd union of three offset spheres, and u_roughness (applicable to
 * any shape) jitters the surface normal for a frosted look.
 *
 * The environment isn't a flat color — it's a few fixed glow "lights" at
 * different directions plus a soft diagonal band, so refraction and
 * reflection both have real structure to bend. A flat/soft-gradient
 * environment refracted through anything just produces another flat
 * gradient, which defeats the point of a refraction demo.
 */

uniform float u_time;
uniform vec2 u_resolution;
uniform float u_seed;

uniform int u_glassShape;      // @label(Glass shape) @select(Sphere=0 | Blob=1 | Facet Prism=2 | Lens=3 | Diamond=4) @default(0)
uniform float u_glassSize;     // @label(Size) @range(0.4, 1.1) @default(0.75)
uniform float u_ior;           // @label(Index of refraction) @range(1.02, 1.6) @default(1.25) @hint(Higher bends light more.)
uniform float u_dispersion;    // @label(Chromatic dispersion) @range(0, 0.15) @default(0.045) @hint(Spreads red, green, and blue apart for a chromatic-fringe edge.)
uniform float u_reflectivity;  // @label(Base reflectivity) @range(0, 1) @default(0.08) @hint(Reflectivity at a straight-on view — edges always brighten via Fresnel regardless of this.)
uniform float u_roughness;     // @label(Roughness) @range(0, 1) @default(0) @mod @hint(Frosts the surface, scattering refraction instead of a clean bend.)

uniform float u_rotationSpeed; // @label(Rotation speed) @range(-60, 60) @default(10) @unit(deg/s) @mod
uniform float u_bobAmount;     // @label(Bob amount) @range(0, 0.3) @default(0.08)
uniform float u_bobSpeed;      // @label(Bob speed) @range(0, 3) @default(0.5) @mod

uniform vec3 u_glassTint;      // @label(Glass tint) @color @default(0.85, 0.95, 1.0)
uniform vec3 u_envColorA;      // @label(Environment A) @color @default(0.05, 0.1, 0.25)
uniform vec3 u_envColorB;      // @label(Environment B) @color @default(0.6, 0.2, 0.5)
uniform vec3 u_glowColor1;     // @label(Glow spot 1) @color @default(0.2, 0.8, 1.0)
uniform vec3 u_glowColor2;     // @label(Glow spot 2) @color @default(1.0, 0.4, 0.7)
uniform vec3 u_glowColor3;     // @label(Glow spot 3) @color @default(0.9, 0.9, 0.3)
uniform vec3 u_bg;             // @label(Background) @color @default(0.01, 0.01, 0.02)

uniform vec2 u_orbit;          // @label(Camera orbit) @range(-1, 1) @group(Composition)
uniform float u_autoOrbit;     // @label(Auto orbit) @range(-1, 1) @default(0.08) @group(Composition)
uniform float u_fov;           // @label(Field of view) @range(0.5, 3) @default(1.6) @group(Composition)

out vec4 fragColor;

mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

const float TAU = 6.2831853;

float hash11(float p) {
  p = fract(p * 0.1031 + u_seed * 0.017);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / max(k, 0.0001), 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

float sdSphereP(vec3 p, float r) { return length(p) - r; }

float sdBlobP(vec3 p, float r) {
  float d = sdSphereP(p, r * 0.7);
  d = smin(d, sdSphereP(p - vec3(r * 0.5, r * 0.3, 0.0), r * 0.5), 0.35 * r);
  d = smin(d, sdSphereP(p + vec3(r * 0.4, -r * 0.25, r * 0.3), r * 0.45), 0.35 * r);
  return d;
}

float sdHexPrismP(vec3 p, float h, float r) {
  const vec3 k = vec3(-0.8660254, 0.5, 0.57735);
  p = abs(p);
  p.xy -= 2.0 * min(dot(k.xy, p.xy), 0.0) * k.xy;
  vec2 d = vec2(
    length(p.xy - vec2(clamp(p.x, -k.z * r, k.z * r), r)) * sign(p.y - r),
    p.z - h);
  return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
}

float sdLensP(vec3 p, float r) {
  vec3 q = p / vec3(1.3, 0.68, 1.3);
  return (length(q) - r) * 0.75;
}

float sdOctahedronP(vec3 p, float s) {
  p = abs(p);
  float m = p.x + p.y + p.z - s;
  vec3 q;
  if (3.0 * p.x < m) q = p.xyz;
  else if (3.0 * p.y < m) q = p.yzx;
  else if (3.0 * p.z < m) q = p.zxy;
  else return m * 0.57735027;
  float k = clamp(0.5 * (q.z - q.y + s), 0.0, s);
  return length(vec3(q.x, q.y - s + k, q.z - k));
}

float glassSDF(vec3 p, int shapeType, float size) {
  if (shapeType == 1) return sdBlobP(p, size);
  if (shapeType == 2) return sdHexPrismP(p, size * 0.55, size * 0.85);
  if (shapeType == 3) return sdLensP(p, size);
  if (shapeType == 4) return sdOctahedronP(p, size * 1.1);
  return sdSphereP(p, size);
}

float map(vec3 p) {
  vec3 lp = p - vec3(0.0, sin(mod(u_time * u_bobSpeed, TAU)) * u_bobAmount, 0.0);
  float ang = mod(u_time * u_rotationSpeed * (3.14159265 / 180.0), TAU);
  lp.xz *= rot(ang);
  return glassSDF(lp, u_glassShape, u_glassSize);
}

vec3 calcNormal(vec3 p) {
  vec2 e = vec2(0.0015, 0.0);
  return normalize(vec3(
    map(p + e.xyy) - map(p - e.xyy),
    map(p + e.yxy) - map(p - e.yxy),
    map(p + e.yyx) - map(p - e.yyx)));
}

vec3 roughNormal(vec3 n, vec3 p) {
  if (u_roughness <= 0.0) return n;
  vec3 jitter = vec3(
    hash11(dot(p, vec3(12.9, 78.2, 45.1)) + u_time * 2.0) - 0.5,
    hash11(dot(p, vec3(93.9, 67.1, 12.3)) + u_time * 2.0) - 0.5,
    hash11(dot(p, vec3(41.7, 29.3, 88.1)) + u_time * 2.0) - 0.5);
  return normalize(mix(n, normalize(n + jitter * 1.2), u_roughness));
}

vec3 envColor(vec3 rd) {
  vec3 col = mix(u_envColorA, u_envColorB, 0.5 + 0.5 * rd.y);
  vec3 l1 = normalize(vec3(0.6, 0.5, -0.3));
  vec3 l2 = normalize(vec3(-0.7, 0.2, 0.5));
  vec3 l3 = normalize(vec3(0.1, -0.6, 0.8));
  col += u_glowColor1 * pow(max(0.0, dot(rd, l1)), 36.0) * 1.4;
  col += u_glowColor2 * pow(max(0.0, dot(rd, l2)), 30.0) * 1.4;
  col += u_glowColor3 * pow(max(0.0, dot(rd, l3)), 42.0) * 1.4;
  float bands = sin(rd.x * 8.0 + rd.y * 5.0 + mod(u_time * 0.25, TAU));
  col += mix(u_glowColor1, u_glowColor2, 0.5) * smoothstep(0.75, 1.0, bands) * 0.15;
  return col;
}

void main() {
  vec2 uv = (gl_FragCoord.xy * 2.0 - u_resolution) / min(u_resolution.x, u_resolution.y);

  float autoAng = mod(u_time * u_autoOrbit * 0.3, TAU);
  vec3 ro = vec3(0.0, 0.0, 3.0);
  ro.xz *= rot(u_orbit.x * 1.6 + autoAng);
  ro.yz *= rot(u_orbit.y * 0.8);

  vec3 fwd = normalize(-ro);
  vec3 right = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
  vec3 up = cross(right, fwd);
  vec3 rd = normalize(fwd * u_fov + right * uv.x + up * uv.y);

  vec3 col = envColor(rd) * 0.5 + u_bg;

  float t = 0.0;
  bool hit = false;
  for (int i = 0; i < 80; i++) {
    vec3 p = ro + rd * t;
    float d = map(p);
    if (d < 0.0015) { hit = true; break; }
    t += d;
    if (t > 10.0) break;
  }

  if (hit) {
    vec3 p = ro + rd * t;
    vec3 n = calcNormal(p);
    n = roughNormal(n, p);

    float f0 = u_reflectivity;
    float fresnel = f0 + (1.0 - f0) * pow(1.0 - clamp(dot(-rd, n), 0.0, 1.0), 5.0);

    vec3 reflDir = reflect(rd, n);
    vec3 reflCol = envColor(reflDir);

    float iorR = u_ior - u_dispersion;
    float iorG = u_ior;
    float iorB = u_ior + u_dispersion;
    vec3 refrDirR = refract(rd, n, 1.0 / iorR);
    vec3 refrDirG = refract(rd, n, 1.0 / iorG);
    vec3 refrDirB = refract(rd, n, 1.0 / iorB);
    if (dot(refrDirR, refrDirR) < 0.001) refrDirR = reflDir;
    if (dot(refrDirG, refrDirG) < 0.001) refrDirG = reflDir;
    if (dot(refrDirB, refrDirB) < 0.001) refrDirB = reflDir;
    vec3 refrCol = vec3(envColor(refrDirR).r, envColor(refrDirG).g, envColor(refrDirB).b);

    vec3 glassCol = mix(refrCol, reflCol, clamp(fresnel, 0.0, 1.0));
    glassCol = mix(glassCol, glassCol * u_glassTint, 0.5);

    float spec = pow(max(0.0, dot(reflect(-normalize(vec3(0.5, 0.8, 0.3)), n), -rd)), 60.0);
    glassCol += vec3(1.0) * spec * 0.5;

    col = glassCol;
  }

  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
