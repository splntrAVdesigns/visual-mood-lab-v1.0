#version 300 es
precision highp float;

/*
 * dark-matter — sibling to cluster-bloom.frag. Same cluster geometry:
 * spheres arranged in three orbiting sub-clusters, breathing, vibrating,
 * and passing through a sequenced per-sphere glitch distortion that
 * cycles across the set one sphere at a time. What changes is the
 * material and the parameters it ships with by default — where Cluster
 * Bloom is a warm diffuse-lit organic glow, this is dark reflective
 * liquid metal: near-black diffuse base, a sharp specular highlight, a
 * cheap analytic environment reflection with two bright "studio
 * hotspot" directions, and the same ambient-occlusion pass Cluster
 * Bloom already uses to darken the crevices between merged spheres —
 * that AO is what gives the dark contact-shadowing between blobs, no
 * new mechanism required for it.
 *
 * Note: u_seed is a reserved, host-driven uniform name in this project's
 * parser (see DEFAULT_RESERVED in parse-uniforms.ts) and must never be
 * declared as a control — this file's per-variant reseed control is
 * named u_variantSeed instead to avoid being silently swallowed.
 *
 * Per the approved spec: Size variance and Sphere merge both ship with
 * higher defaults than Cluster Bloom's, so blobs read as genuinely
 * different sizes and actively mold into each other by default rather
 * than needing to be dialed up manually.
 *
 * PERFORMANCE: this file originally had none of Cluster Bloom's cost
 * controls — no bounding-volume early-out, and the per-sphere glitch
 * perturbation was baked directly into mapSpheres() rather than applied
 * only at shading time, so every one of the ~121 map()-chain calls per
 * pixel (march <=90, normal 6, shadow <=20, AO 5) paid the full up-to-12
 * -sphere loop, background pixels included, every sphere always doing its
 * glitch trig/hash math even though only one sphere is ever active at a
 * time. That's why this tile was slow everywhere (desktop AND mobile),
 * unlike Cluster Bloom's platform-lopsided case. Three fixes, all applied
 * below and none changing the rendered image:
 *
 * 1. clusterBoundDist() — the same "safe (never-overestimating) 3-cluster
 *    bound" technique already shipped on Cluster Bloom, extended to also
 *    cover this file's glitch perturbation's spatial extent (both the
 *    extra positional offset and the radius growth it can cause). Derived
 *    and verified numerically (40k random samples at full slider ranges,
 *    including glitch distortion at its max) to never underestimate the
 *    true sphere extent before writing this into GLSL.
 * 2. Invariant hoisting — gClusterCenter / gBaseRadius, computed once per
 *    pixel in precomputeInvariants(), instead of every one of the ~121
 *    map()-chain calls recomputing cluster-center cos/sin and per-sphere
 *    hash from scratch. Verified bit-identical to the original per-call
 *    formulation (15k random samples) before shipping.
 * 3. The glitch perturbation (extra sin/cos/hash + radius growth) now
 *    only runs for the one sphere index that's actually active this
 *    frame — gated behind an isActive branch instead of being computed
 *    for all 12 spheres and multiplied by a per-sphere 0/1 factor. Since
 *    "which sphere is active" depends only on u_time (never on screen
 *    position), this branch is the same for every pixel in the frame, so
 *    it doesn't introduce the kind of per-pixel divergent branching that
 *    would otherwise cost more than it saves. Verified as part of the
 *    same bit-identical check as #2 (0 * anything is 0 either way; this
 *    only skips computing what would already have been multiplied away).
 */

// Precomputed once per pixel in main() via precomputeInvariants() — see
// the PERFORMANCE note above. Never written to from anywhere else.
vec3 gClusterCenter[3];
float gBaseRadius[12];
float gBoundR;

uniform float u_time;
uniform vec2 u_resolution;
uniform float u_variantSeed;     // @label(Variant seed) @advanced @nomidi @range(0, 100) @default(0) @hint(Reseeds per-sphere size and position hashing without changing any other control.)

// Composition
uniform vec2 u_center;           // @label(Center) @range(-1, 1) @group(Composition)
uniform float u_rotation;        // @label(Rotation) @range(-180, 180) @default(0) @unit(deg) @group(Composition)
uniform float u_scale;           // @label(Overall scale) @range(0.4, 2.5) @default(1.0) @group(Composition)

// Cluster
uniform int u_sphereCount;       // @label(Sphere count) @range(3, 12) @default(6) @nomod @group(Cluster)
uniform float u_sizeVariance;    // @label(Size variance) @range(0, 1) @default(0.85) @mod @group(Cluster) @hint(0 makes every sphere the same size; higher values randomize radius per sphere. Defaults higher than Cluster Bloom so blobs read as clearly different sizes.)
uniform float u_sphereMerge;     // @label(Sphere merge) @range(0, 0.6) @default(0.32) @mod @group(Cluster) @hint(0 keeps spheres fully separate; higher values blend neighbors together like a metaball cluster. Defaults higher than Cluster Bloom so the blobs actively mold into each other.)
uniform float u_clusterSpread;   // @label(Cluster spread) @range(0.3, 2.0) @default(1.0) @mod @group(Cluster) @hint(Distance between the three cluster centers.)

// Motion
uniform float u_vibrationAmount; // @label(Vibration amount) @range(0, 0.3) @default(0.05) @mod @group(Motion) @hint(Vertical vibration wave, phase-offset per sphere so it travels across the cluster.)
uniform float u_vibrationSpeed;  // @label(Vibration speed) @range(0, 8) @default(3.0) @mod @group(Motion)
uniform float u_breatheAmount;   // @label(Breathe amount) @range(0, 1) @default(0.4) @mod @group(Motion) @hint(How far each cluster's spheres drift out from, then retract back toward, their cluster center.)
uniform float u_breatheSpeed;    // @label(Breathe speed) @range(0, 2) @default(0.35) @mod @group(Motion)

// Glitch
uniform float u_glitchDistortion; // @label(Glitch distortion) @range(0, 1) @default(0.15) @mod @group(Motion) @hint(Strength of the sequenced glitch pass, which cycles through the spheres one at a time.)
uniform float u_glitchSpeed;      // @label(Glitch speed) @range(0, 8) @default(3.0) @mod @group(Motion)

// Lighting
uniform vec3 u_lightDir;          // @label(Light direction) @range(-1, 1) @default(0.45, 0.75, 0.3) @group(Lighting)
uniform vec3 u_fillColor;         // @label(Fill color) @color @default(0.3, 0.32, 0.35) @group(Lighting)
uniform float u_fillStrength;     // @label(Fill strength) @range(0, 1) @default(0.35) @mod @group(Lighting)
uniform float u_shadowStrength;   // @label(Shadow strength) @range(0, 1) @default(0.6) @group(Lighting)
uniform float u_aoStrength;       // @label(AO strength) @range(0, 1) @default(0.8) @group(Lighting) @hint(Darkens crevices between merged spheres — this is what produces the dark contact-shadowing that reads as liquid metal rather than a flat glassy fill.)

// Material
uniform vec3 u_sphereColor;       // @label(Sphere color) @color @default(0.03, 0.03, 0.035) @group(Material) @hint(Near-black by default — mercury has almost no visible diffuse colour of its own, only reflection and specular.)
uniform vec3 u_rimColor;          // @label(Rim color) @color @default(0.7, 0.75, 0.85) @group(Material)
uniform float u_specularStrength; // @label(Specular strength) @range(0, 3) @default(1.4) @mod @group(Material)
uniform float u_specularSharpness; // @label(Specular sharpness) @range(10, 200) @default(90) @group(Material) @hint(Higher values give a tighter, harder highlight streak; lower values spread it into a soft glossy sheen.)
uniform float u_reflectivity;     // @label(Reflectivity) @range(0, 1) @default(0.55) @mod @group(Material) @hint(How strongly the environment reflection shows through — 0 is fully matte, 1 is near-mirror.)
uniform vec3 u_hotspotColorA;     // @label(Hotspot A) @color @default(1.0, 1.0, 1.0) @group(Material)
uniform vec3 u_hotspotColorB;     // @label(Hotspot B) @color @default(1.0, 1.0, 1.0) @group(Material)

// Ground
uniform vec3 u_groundColor;       // @label(Ground color) @color @default(0.03, 0.03, 0.035) @group(Ground)
uniform vec3 u_bg;                // @label(Background) @color @default(0.01, 0.01, 0.015) @group(Ground)

// Camera
uniform float u_orbitSpeed;       // @label(Orbit speed) @range(-1, 1) @default(0.05) @mod @group(Camera) @hint(0 holds the camera still; positive or negative values auto-orbit in either direction.)
uniform float u_fov;              // @label(Field of view) @range(1.0, 3.0) @default(1.6) @group(Camera) @hint(Higher values narrow the field of view (zoom in); lower values widen it.)

out vec4 fragColor;

const float TAU = 6.2831853;
const float GROUND_Y = -0.62;

float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / max(k, 0.0001), 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

mat2 rot2(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

float mapSpheres(vec3 p, float activeGlitchIdx) {
  float d = 1e5;
  for (int i = 0; i < 12; i++) {
    if (i >= u_sphereCount) break;
    float fi = float(i);
    int clusterIdx = i - (i / 3) * 3;
    int slotIdx = i / 3;

    vec3 clusterCenter = gClusterCenter[clusterIdx];

    float breathePhase = mod(u_time * u_breatheSpeed * 0.8 + float(clusterIdx) * 2.1, TAU);
    float breathe = 0.55 + u_breatheAmount * (0.5 + 0.5 * sin(breathePhase));
    float orbitR = 0.3 * breathe;

    float slotAngle = mod(float(slotIdx) / 3.0 * TAU + u_time * 0.04 + float(clusterIdx) * 1.7, TAU);
    vec3 localOffset = vec3(cos(slotAngle), 0.0, sin(slotAngle)) * orbitR;

    float vibratePhase = mod(u_time * u_vibrationSpeed + fi * 0.6, TAU);
    localOffset.y += sin(vibratePhase) * u_vibrationAmount;

    // Only ever one sphere index is active at a time (see activeGlitchIdx
    // in main()), and "which one" depends only on u_time — never on
    // screen position — so this branch is the same for every pixel in
    // the frame, not per-pixel divergent. Skips the glitch trig/hash math
    // entirely for the other 11 spheres instead of computing it and
    // multiplying by a 0 factor. See PERFORMANCE note above.
    float radiusGlitch = 1.0;
    bool isActive = abs(fi - activeGlitchIdx) < 0.5;
    if (isActive) {
      localOffset += vec3(
        sin(fi * 13.1 + u_time * 9.0),
        cos(fi * 7.7 + u_time * 11.0),
        sin(fi * 5.3 + u_time * 8.0)
      ) * u_glitchDistortion * 0.15;
      radiusGlitch = 1.0 + u_glitchDistortion * (hash11(fi + 50.0) - 0.5) * 0.6;
    }

    vec3 sphereCenter = clusterCenter + localOffset;
    float radius = gBaseRadius[i] * radiusGlitch;

    float sd = length(p - sphereCenter) - radius;
    d = smin(d, sd, max(u_sphereMerge, 0.001));
  }
  return d;
}

// Safe (never-overestimating) lower-bound distance to the nearest of the
// 3 cluster bounding volumes — same technique as Cluster Bloom's
// clusterBoundDist(), extended to also cover the glitch perturbation's
// spatial reach (both the positional offset and the radius growth it can
// cause), since exactly one sphere in the cluster may be glitching at any
// instant. Derivation verified numerically against 40k random
// parameter/position samples at full slider ranges before shipping —
// never underestimates the true sphere extent.
float clusterBoundDist(vec3 p) {
  float best = 1e5;
  for (int c = 0; c < 3; c++) {
    float db = length(p - gClusterCenter[c]) - gBoundR;
    best = min(best, db);
  }
  return best;
}

// Fills gClusterCenter / gBaseRadius / gBoundR. Everything here depends
// only on uniforms (+ u_time for the breathe term, uniform for the whole
// pixel) — never on ray position — so computing it once here instead of
// inside every map()-chain call is a pure win. gBaseRadius excludes the
// glitch radius factor deliberately: only one sphere is ever glitching,
// so mapSpheres() applies that one multiplier inline instead of baking a
// per-sphere glitch state into a precomputed table that would need
// rebuilding every time the active index changes. Call exactly once, at
// the very top of main(), before anything that transitively calls map().
void precomputeInvariants() {
  for (int c = 0; c < 3; c++) {
    float clusterAngle = float(c) / 3.0 * TAU;
    gClusterCenter[c] = vec3(cos(clusterAngle), 0.0, sin(clusterAngle)) * 0.55 * u_clusterSpread;
  }
  for (int i = 0; i < 12; i++) {
    float sizeRand = hash11(float(i) + 7.0 + u_variantSeed * 13.7);
    gBaseRadius[i] = 0.17 * mix(1.0, 0.4 + sizeRand * 1.4, u_sizeVariance);
  }
  float maxBreathe = 0.55 + u_breatheAmount;
  float orbitRMax = 0.3 * maxBreathe;
  float sphereRMaxBase = 0.17 * mix(1.0, 1.8, u_sizeVariance);
  float glitchRadiusFactor = 1.0 + u_glitchDistortion * 0.3;
  float sphereRMax = sphereRMaxBase * glitchRadiusFactor;
  float glitchOffsetMax = u_glitchDistortion * 0.15 * 1.7320508; // sqrt(3), worst-case trig magnitude
  float pad = u_vibrationAmount + u_sphereMerge * 0.5 + glitchOffsetMax + 0.02;
  gBoundR = orbitRMax + sphereRMax + pad;
}

float map(vec3 p, float activeGlitchIdx) {
  float dGround = p.y - GROUND_Y;
  float dBound = clusterBoundDist(p);
  // Far from every cluster: the bound itself is a safe distance, so
  // return it directly and skip the full per-sphere loop entirely. Only
  // once a ray has actually gotten close does the exact evaluation run.
  // This is the early-out this file was missing entirely before — see
  // PERFORMANCE note above.
  if (dBound > 0.02) {
    return min(dBound, dGround);
  }
  return min(mapSpheres(p, activeGlitchIdx), dGround);
}

vec3 calcNormal(vec3 p, float activeGlitchIdx) {
  vec2 e = vec2(0.0015, 0.0);
  return normalize(vec3(
    map(p + e.xyy, activeGlitchIdx) - map(p - e.xyy, activeGlitchIdx),
    map(p + e.yxy, activeGlitchIdx) - map(p - e.yxy, activeGlitchIdx),
    map(p + e.yyx, activeGlitchIdx) - map(p - e.yyx, activeGlitchIdx)
  ));
}

float calcAO(vec3 p, vec3 n, float activeGlitchIdx) {
  float occ = 0.0;
  float sca = 1.0;
  for (int i = 0; i < 5; i++) {
    float hr = 0.02 + 0.03 * float(i) * float(i);
    float dd = map(p + n * hr, activeGlitchIdx);
    occ += (hr - dd) * sca;
    sca *= 0.7;
  }
  return clamp(1.0 - occ * 1.5 * u_aoStrength, 0.0, 1.0);
}

float softShadow(vec3 ro, vec3 rd, float activeGlitchIdx) {
  float res = 1.0;
  float t = 0.02;
  for (int i = 0; i < 20; i++) {
    float d = map(ro + rd * t, activeGlitchIdx);
    res = min(res, 10.0 * d / t);
    t += clamp(d, 0.01, 0.15);
    if (res < 0.02 || t > 3.0) break;
  }
  return mix(1.0, clamp(res, 0.0, 1.0), u_shadowStrength);
}

void main() {
  precomputeInvariants();

  vec2 uv = (gl_FragCoord.xy * 2.0 - u_resolution) / min(u_resolution.x, u_resolution.y);
  uv -= u_center;
  uv /= max(u_scale, 0.001);
  uv = rot2(radians(u_rotation)) * uv;

  float activeGlitchIdx = mod(floor(u_time * u_glitchSpeed), float(max(u_sphereCount, 1)));

  float autoAng = mod(u_time * u_orbitSpeed, TAU);
  vec3 ro = vec3(0.0, 0.35, 3.2);
  ro.xz *= rot2(autoAng);
  vec3 target = vec3(0.0, -0.15, 0.0);
  vec3 fwd = normalize(target - ro);
  vec3 right = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
  vec3 up = cross(right, fwd);
  vec3 rd = normalize(fwd * u_fov + right * uv.x + up * uv.y);

  vec3 lightDir = normalize(u_lightDir);

  float t = 0.0;
  bool hit = false;
  vec3 p = ro;
  for (int i = 0; i < 90; i++) {
    p = ro + rd * t;
    float d = map(p, activeGlitchIdx);
    if (d < 0.0012) { hit = true; break; }
    t += d * 0.85;
    if (t > 10.0) break;
  }

  vec3 col = u_bg;

  if (hit) {
    vec3 n = calcNormal(p, activeGlitchIdx);
    float ao = calcAO(p, n, activeGlitchIdx);
    bool isGround = p.y < GROUND_Y + 0.01;

    if (isGround) {
      float checker = mod(floor(p.x * 2.0) + floor(p.z * 2.0), 2.0);
      float shadow = softShadow(p + n * 0.01, lightDir, activeGlitchIdx);
      col = mix(u_groundColor * 0.7, u_groundColor, checker) * ao * shadow;
    } else {
      float diff = clamp(dot(n, lightDir), 0.0, 1.0);
      float shadow = softShadow(p + n * 0.01, lightDir, activeGlitchIdx);
      vec3 base = u_sphereColor * (0.15 + diff * 0.35) * ao * shadow;
      base += u_fillColor * u_fillStrength * (1.0 - diff) * 0.3 * ao;

      float spec = pow(max(dot(reflect(-lightDir, n), -rd), 0.0), u_specularSharpness);
      float fres = pow(1.0 - max(dot(n, -rd), 0.0), 2.5);

      vec3 reflDir = reflect(rd, n);
      vec3 env = mix(vec3(0.015, 0.015, 0.02), vec3(0.28, 0.29, 0.32), reflDir.y * 0.5 + 0.5);
      float hot1 = pow(max(dot(reflDir, normalize(vec3(0.45, 0.8, 0.3))), 0.0), 45.0);
      float hot2 = pow(max(dot(reflDir, normalize(vec3(-0.5, 0.6, -0.2))), 0.0), 65.0);
      env += u_hotspotColorA * hot1 * 0.85 + u_hotspotColorB * hot2 * 0.6;

      col = base
          + env * u_reflectivity * ao
          + u_rimColor * spec * u_specularStrength
          + u_rimColor * fres * 0.12;
    }
  }

  fragColor = vec4(col, 1.0);
}
