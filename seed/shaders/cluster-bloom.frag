#version 300 es
precision highp float;

/*
 * cluster-bloom — up to six raymarched spheres arranged into three
 * breathing sub-clusters, on a real ground plane, with a grounded
 * two-light setup (key + warm fill), soft shadows, and ambient
 * occlusion. This is the depth-cue layer the library's other raymarch
 * pieces (sdf-sphere, orbit-debris) don't reach for — a single flat
 * diffuse+rim term reads as "3D shape" but not "real 3D scene"; a
 * contact shadow landing on a ground plane and AO darkening where
 * spheres crowd each other is what actually sells dimensionality.
 *
 * Spheres round-robin into their cluster as u_sphereCount rises (sphere
 * i belongs to cluster i mod 3), so any count from 1 to 6 distributes
 * evenly across all three clusters (up to two per cluster) rather than
 * filling one before the next ever gets a sphere.
 *
 * PERFORMANCE: map() checks a cheap 3-cluster bounding volume before
 * ever touching the full per-sphere loop. Every raymarch step, for
 * every pixel on screen — including background pixels that never hit
 * anything — used to test distance against every active sphere
 * unconditionally; that cost scales linearly with sphere count with no
 * way to skip it, so going from 3 spheres to 6 roughly doubled the cost
 * of every single step everywhere on the canvas, not just near the
 * geometry. The bounding check is a safe (never-overestimating) lower
 * bound built from the worst-case orbit radius, sphere radius, vibration
 * amplitude, and merge padding for a cluster, so a ray far from all
 * three clusters can take one big, cheap step using just 3 distance
 * checks instead of paying for the full 6-sphere loop on every step of
 * its march. Only rays that have actually gotten close to a cluster
 * fall through to the exact per-sphere evaluation.
 *
 * The glitch pass is sequenced, not simultaneous: exactly one sphere is
 * "active" at a time, cycling on a timer, and only that sphere's surface
 * gets a brief jagged perturbation before the pass moves to the next —
 * distinct from a constant per-frame noise wobble across everything.
 */

uniform float u_time;
uniform vec2 u_resolution;
uniform float u_seed;

uniform int u_sphereCount;       // @label(Sphere count) @range(1, 6) @default(5)
uniform float u_scale;           // @label(Overall scale) @range(0.5, 1.8) @default(1.0)
uniform float u_sizeVariance;    // @label(Size variance) @range(0, 1) @default(0.5) @hint(0 makes every sphere the same size; higher values randomize radius per sphere.)
uniform float u_merge;           // @label(Sphere merge) @range(0, 0.25) @default(0.06) @hint(0 keeps spheres fully separate; higher values blend neighbors together like a metaball cluster.)
uniform float u_clusterSpread;   // @label(Cluster spread) @range(0.5, 2) @default(1.0) @hint(Distance between the three cluster centers.)

uniform float u_vibrationAmount; // @label(Vibration amount) @range(0, 0.3) @default(0.06) @mod @hint(Vertical vibration wave, phase-offset per sphere so it travels across the cluster.)
uniform float u_vibrationSpeed;  // @label(Vibration speed) @range(0, 12) @default(4) @mod

uniform float u_breatheAmount;   // @label(Breathe amount) @range(0, 1) @default(0.4) @hint(How far each cluster's spheres drift out from, then retract back toward, their cluster center.)
uniform float u_breatheSpeed;    // @label(Breathe speed) @range(0, 2) @default(0.4) @mod

uniform float u_distortAmount;   // @label(Glitch distortion) @range(0, 1) @default(0.35) @mod @hint(Strength of the sequenced glitch pass, which cycles through the spheres one at a time.)
uniform float u_distortSpeed;    // @label(Glitch speed) @range(0.2, 4) @default(1.2) @mod

uniform vec3 u_lightDir;         // @label(Key light direction) @range(-1, 1)
uniform vec3 u_fillColor;        // @label(Fill light color) @color @default(1.0, 0.55, 0.35)
uniform float u_fillStrength;    // @label(Fill light strength) @range(0, 1) @default(0.35)
uniform float u_shadowStrength;  // @label(Shadow strength) @range(0, 1) @default(0.7)
uniform float u_aoStrength;      // @label(Occlusion strength) @range(0, 1) @default(0.5)

uniform vec3 u_sphereColor;      // @label(Sphere color) @color @default(0.1, 0.85, 0.95)
uniform vec3 u_rimColor;         // @label(Rim light) @color @default(1.0, 1.0, 1.0)
uniform vec3 u_groundColor;      // @label(Ground color) @color @default(0.03, 0.05, 0.06)
uniform vec3 u_bg;               // @label(Background) @color @default(0.02, 0.02, 0.03)

uniform vec2 u_orbit;            // @label(Camera orbit) @range(-1, 1) @group(Composition)
uniform float u_autoOrbit;       // @label(Auto orbit) @range(-1, 1) @default(0.06) @group(Composition)
uniform float u_fov;             // @label(Field of view) @range(0.5, 3) @default(1.6) @group(Composition)

out vec4 fragColor;

const float TAU = 6.2831853;
const float GROUND_Y = -0.62;

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

mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

// Sphere-cluster-only distance (ground handled separately in map()).
// No glitch perturbation here — the distance value must stay a true,
// continuous distance estimate or the raymarcher's step sizing breaks
// down (see module doc). Glitch is applied at shading time instead, via
// sphereMaterialIndex() below.
float mapSpheres(vec3 p) {
  int count = clamp(u_sphereCount, 1, 6);
  float d = 1e5;
  for (int i = 0; i < 6; i++) {
    if (i >= count) break;
    float fi = float(i);
    int clusterIdx = i - (i / 3) * 3;
    int slotIdx = i / 3;

    float clusterAngle = float(clusterIdx) / 3.0 * TAU;
    vec3 clusterCenter = vec3(cos(clusterAngle), 0.0, sin(clusterAngle)) * 0.55 * u_clusterSpread;

    float breathePhase = mod(u_time * u_breatheSpeed * 0.8 + float(clusterIdx) * 2.1, TAU);
    float breathe = 0.55 + u_breatheAmount * (0.5 + 0.5 * sin(breathePhase));
    float orbitR = 0.3 * breathe;
    float slotAngle = mod(float(slotIdx) / 3.0 * TAU + u_time * 0.04 + float(clusterIdx) * 1.7, TAU);
    vec3 localOffset = vec3(cos(slotAngle), 0.0, sin(slotAngle)) * orbitR;

    float vibratePhase = mod(u_time * u_vibrationSpeed + fi * 0.6, TAU);
    localOffset.y += sin(vibratePhase) * u_vibrationAmount;

    vec3 sphereCenter = clusterCenter + localOffset;
    float sizeRand = hash11(fi + 7.0);
    float radius = 0.17 * mix(1.0, 0.4 + sizeRand * 1.4, u_sizeVariance) * u_scale;

    float sd = length(p - sphereCenter) - radius;
    d = smin(d, sd, u_merge);
  }
  return d;
}

// Duplicates mapSpheres()'s position math to find which sphere owns the
// surface at a hit point — same duplicate-pass approach as
// orbit-debris's pieceMaterial(). Only called from inside the glitch
// window (see main()), never unconditionally per pixel.
float sphereMaterialIndex(vec3 p) {
  int count = clamp(u_sphereCount, 1, 6);
  float best = 1e5;
  float bestIdx = 0.0;
  for (int i = 0; i < 6; i++) {
    if (i >= count) break;
    float fi = float(i);
    int clusterIdx = i - (i / 3) * 3;
    int slotIdx = i / 3;

    float clusterAngle = float(clusterIdx) / 3.0 * TAU;
    vec3 clusterCenter = vec3(cos(clusterAngle), 0.0, sin(clusterAngle)) * 0.55 * u_clusterSpread;

    float breathePhase = mod(u_time * u_breatheSpeed * 0.8 + float(clusterIdx) * 2.1, TAU);
    float breathe = 0.55 + u_breatheAmount * (0.5 + 0.5 * sin(breathePhase));
    float orbitR = 0.3 * breathe;
    float slotAngle = mod(float(slotIdx) / 3.0 * TAU + u_time * 0.04 + float(clusterIdx) * 1.7, TAU);
    vec3 localOffset = vec3(cos(slotAngle), 0.0, sin(slotAngle)) * orbitR;

    float vibratePhase = mod(u_time * u_vibrationSpeed + fi * 0.6, TAU);
    localOffset.y += sin(vibratePhase) * u_vibrationAmount;

    vec3 sphereCenter = clusterCenter + localOffset;
    float sizeRand = hash11(fi + 7.0);
    float radius = 0.17 * mix(1.0, 0.4 + sizeRand * 1.4, u_sizeVariance) * u_scale;

    float sd = length(p - sphereCenter) - radius;
    if (sd < best) { best = sd; bestIdx = fi; }
  }
  return bestIdx;
}

// Cheap, safe (never-overestimating) lower-bound distance to the
// nearest of the 3 cluster bounding volumes — 3 distance checks instead
// of looping every sphere. boundR is built from the worst case for any
// sphere in a cluster: max orbit radius (breathe fully extended), max
// individual sphere radius (size variance fully applied), vibration
// amplitude, and a safety pad for merge smoothing — so it can never be
// larger than the true distance to any real sphere surface, which is
// what keeps the raymarcher safe to step by this value when far away.
float clusterBoundDist(vec3 p) {
  float maxBreathe = 0.55 + u_breatheAmount;
  float orbitRMax = 0.3 * maxBreathe;
  float sphereRMax = 0.17 * mix(1.0, 1.8, u_sizeVariance) * u_scale;
  float pad = u_vibrationAmount + u_merge * 0.5 + 0.02;
  float boundR = orbitRMax + sphereRMax + pad;

  float best = 1e5;
  for (int c = 0; c < 3; c++) {
    float clusterAngle = float(c) / 3.0 * TAU;
    vec3 clusterCenter = vec3(cos(clusterAngle), 0.0, sin(clusterAngle)) * 0.55 * u_clusterSpread;
    float db = length(p - clusterCenter) - boundR;
    best = min(best, db);
  }
  return best;
}

float map(vec3 p) {
  float dGround = p.y - GROUND_Y;
  float dBound = clusterBoundDist(p);
  // Far from every cluster: the bound itself is a safe distance, so
  // return it directly and skip the full per-sphere loop entirely. Only
  // once a ray has actually gotten close does the exact evaluation run.
  if (dBound > 0.02) {
    return min(dBound, dGround);
  }
  float dSpheres = mapSpheres(p);
  return min(dSpheres, dGround);
}

vec3 calcNormal(vec3 p) {
  vec2 e = vec2(0.0015, 0.0);
  return normalize(vec3(
    map(p + e.xyy) - map(p - e.xyy),
    map(p + e.yxy) - map(p - e.yxy),
    map(p + e.yyx) - map(p - e.yyx)));
}

float softShadow(vec3 ro, vec3 rd, float mint, float maxt, float k) {
  float res = 1.0;
  float t = mint;
  for (int i = 0; i < 14; i++) {
    if (t >= maxt) break;
    float h = map(ro + rd * t);
    if (h < 0.001) return 0.0;
    res = min(res, k * h / t);
    t += clamp(h * 0.9, 0.01, 0.2);
  }
  return clamp(res, 0.0, 1.0);
}

float calcAO(vec3 p, vec3 n) {
  float occ = 0.0;
  float sca = 1.0;
  for (int i = 0; i < 5; i++) {
    float hr = 0.02 + 0.03 * float(i) * float(i);
    float dd = map(p + n * hr);
    occ += (hr - dd) * sca;
    sca *= 0.7;
  }
  return clamp(1.0 - occ * u_aoStrength * 3.0, 0.0, 1.0);
}

void main() {
  vec2 uv = (gl_FragCoord.xy * 2.0 - u_resolution) / min(u_resolution.x, u_resolution.y);

  float autoAng = mod(u_time * u_autoOrbit * 0.3, TAU);
  vec3 ro = vec3(0.0, 0.35, 3.2);
  ro.xz *= rot(u_orbit.x * 1.6 + autoAng);
  ro.yz *= rot(u_orbit.y * 0.8);

  vec3 target = vec3(0.0, -0.15, 0.0);
  vec3 fwd = normalize(target - ro);
  vec3 right = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
  vec3 up = cross(right, fwd);
  vec3 rd = normalize(fwd * u_fov + right * uv.x + up * uv.y);

  float t = 0.0;
  vec3 col = mix(u_bg * 0.6, u_bg * 1.4, length(uv) * 0.4 + 0.3);
  bool hit = false;

  for (int i = 0; i < 64; i++) {
    vec3 p = ro + rd * t;
    float d = map(p);
    if (d < 0.0012) { hit = true; break; }
    t += d * 0.9;
    if (t > 10.0) break;
  }

  if (hit) {
    vec3 p = ro + rd * t;
    vec3 n = calcNormal(p);
    float ao = calcAO(p, n);
    float shadow = softShadow(p + n * 0.02, normalize(u_lightDir), 0.02, 3.5, 12.0);
    shadow = mix(1.0, shadow, u_shadowStrength);

    float isGround = (p.y < GROUND_Y + 0.01) ? 1.0 : 0.0;
    float diff = clamp(dot(n, normalize(u_lightDir)), 0.0, 1.0);
    float fillDiff = clamp(dot(n, normalize(vec3(-u_lightDir.x, 0.3, -u_lightDir.z))), 0.0, 1.0);

    if (isGround > 0.5) {
      float checker = mod(floor(p.x * 2.0) + floor(p.z * 2.0), 2.0);
      vec3 groundBase = mix(u_groundColor * 0.85, u_groundColor * 1.15, checker);
      col = groundBase * (0.25 + diff * 0.75) * ao * shadow;
    } else {
      float rim = pow(1.0 - clamp(dot(n, -rd), 0.0, 1.0), 2.2);
      vec3 base = u_sphereColor * (0.18 + diff * 0.82) * ao * shadow;
      vec3 fill = u_fillColor * fillDiff * u_fillStrength * ao;

      // Shading-only glitch: exactly one sphere is "active" at a time,
      // cycling on a timer, and only its surface gets a brief RGB-
      // tinted slice flicker — never a perturbation of the SDF itself.
      // The cheap time check runs first; sphereMaterialIndex's 6-sphere
      // loop only gets paid for during the ~22% of each cycle the
      // glitch window is actually open.
      float distortCycle = 1.6 / max(u_distortSpeed, 0.05);
      float glitchPhase = fract(u_time / distortCycle);
      if (glitchPhase < 0.22 && u_distortAmount > 0.0) {
        float activeIdx = mod(floor(u_time / distortCycle), float(clamp(u_sphereCount, 1, 6)));
        float sIdx = sphereMaterialIndex(p);
        if (abs(sIdx - activeIdx) < 0.5) {
          float sliceId = floor(p.y * 26.0 + hash11(sIdx * 3.1) * 4.0);
          float sliceNoise = hash11(sliceId + floor(u_time * 30.0));
          float sliceOn = step(0.55, sliceNoise);
          vec3 glitchTint = mix(vec3(1.0, 0.35, 0.4), vec3(0.35, 0.6, 1.0), hash11(sliceId + 9.0));
          base = mix(base, glitchTint * (0.6 + 0.6 * diff), u_distortAmount * sliceOn);
        }
      }

      col = base + fill + u_rimColor * rim * 0.35;
    }
  }

  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
