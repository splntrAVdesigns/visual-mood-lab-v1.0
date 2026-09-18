#version 300 es
precision highp float;

/*
 * wireframe-morph — a noise-folded implicit sphere (three sine-product
 * bump terms displacing the radius, the same "brain-folding" idea as
 * this project's reference imagery) raymarched with a genuinely orbiting
 * 3D camera, shaded not with lighting but with a wireframe grid computed
 * directly from the hit point's spherical coordinates: thin glowing
 * lines at each grid boundary, brighter dots where two boundaries meet.
 *
 * This is close kin to warp-mesh.frag (also wireframe, also noise-
 * displaced) but a genuinely different technique rather than a preset
 * of it: warp-mesh displaces a flat 2D grid tilted into fake ground-
 * plane perspective, where this raymarches a true 3D volume with real
 * depth, self-occlusion, and an orbiting camera — the grid lines follow
 * a closed spherical surface, not a plane.
 *
 * Sibling file superform-wire.frag reuses this exact wireframe-grid
 * rendering approach (spherical-coordinate fract() lines + vertex dots)
 * against a different surface function — the superformula radius curve
 * instead of noise displacement — which is different core geometry, not
 * a palette swap, hence its own file.
 */

uniform float u_time;
uniform vec2 u_resolution;

// Composition
uniform vec2 u_center;            // @label(Center) @range(-1, 1) @group(Composition)
uniform float u_rotation;         // @label(Rotation) @range(-180, 180) @default(0) @unit(deg) @group(Composition) @hint(Static offset added to the camera's orbit angle.)
uniform float u_scale;            // @label(Scale) @range(0.4, 2.0) @default(1.0) @group(Composition)

// Surface
uniform float u_baseRadius;       // @label(Base radius) @range(0.5, 1.3) @default(0.85)
uniform float u_foldAmount;       // @label(Fold amount) @range(0, 2) @default(1.0) @mod @hint(Overall strength of the noise displacement — 0 gives a plain sphere, higher values carve deeper folds.)
uniform float u_foldFrequency;    // @label(Fold frequency) @range(0.5, 2.5) @default(1.0) @mod
uniform float u_foldSpeed;        // @label(Fold speed) @range(0, 2) @default(1.0) @mod

// Grid
uniform float u_gridTheta;        // @label(Grid theta) @range(8, 48) @default(26) @mod @hint(Grid line count around the vertical axis.)
uniform float u_gridPhi;          // @label(Grid phi) @range(6, 30) @default(15) @mod @hint(Grid line count from pole to pole.)
uniform float u_lineSharpness;    // @label(Line sharpness) @range(500, 8000) @default(3500) @mod @hint(Higher values pinch the grid lines thinner and sharper; lower values give a softer, wider glow.)
uniform float u_vertexBrightness; // @label(Vertex brightness) @range(0, 5) @default(2.2) @mod @hint(How much brighter a grid intersection glows compared to a plain edge line.)

// Color
uniform vec3 u_meshColor;         // @label(Mesh color) @color @default(0.85, 1.0, 0.22)
uniform vec3 u_baseColor;         // @label(Base color) @color @default(0.015, 0.017, 0.0)
uniform float u_meshBrightness;   // @label(Mesh brightness) @range(0, 3) @default(1.05) @mod

// Camera
uniform float u_orbitSpeed;       // @label(Orbit speed) @range(-1, 1) @default(0.15) @mod
uniform float u_cameraDistance;   // @label(Camera distance) @range(1.5, 4.0) @default(2.4)

out vec4 fragColor;

float surfCore(vec3 p) {
  float r = length(p);
  float bump = sin(p.x * 3.0 * u_foldFrequency + u_time * 0.12 * u_foldSpeed)
             * sin(p.y * 3.3 * u_foldFrequency - u_time * 0.09 * u_foldSpeed)
             * sin(p.z * 2.7 * u_foldFrequency + u_time * 0.14 * u_foldSpeed) * 0.16;
  bump += sin(p.x * 6.0 * u_foldFrequency - p.y * 4.0 * u_foldFrequency + u_time * 0.2 * u_foldSpeed) * 0.07;
  bump += sin(p.y * 5.5 * u_foldFrequency + p.z * 4.5 * u_foldFrequency - u_time * 0.16 * u_foldSpeed) * 0.06;
  return r - (u_baseRadius + bump * u_foldAmount);
}

float surf(vec3 p) {
  return surfCore(p / max(u_scale, 0.001)) * u_scale;
}

vec3 calcNormal(vec3 p) {
  vec2 e = vec2(0.0015, 0.0);
  return normalize(vec3(
    surf(p + e.xyy) - surf(p - e.xyy),
    surf(p + e.yxy) - surf(p - e.yxy),
    surf(p + e.yyx) - surf(p - e.yyx)
  ));
}

void main() {
  vec2 uv = (gl_FragCoord.xy * 2.0 - u_resolution) / min(u_resolution.x, u_resolution.y);
  uv -= u_center;

  float ry = u_time * u_orbitSpeed + radians(u_rotation);
  vec3 ro = vec3(sin(ry) * u_cameraDistance, 0.3, cos(ry) * u_cameraDistance);
  vec3 target = vec3(0.0);
  vec3 fwd = normalize(target - ro);
  vec3 right = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
  vec3 up = cross(right, fwd);
  vec3 rd = normalize(fwd * 1.7 + right * uv.x + up * uv.y);

  float t = 0.0;
  bool hit = false;
  vec3 p = ro;
  for (int i = 0; i < 80; i++) {
    p = ro + rd * t;
    float d = surf(p);
    if (d < 0.0012) { hit = true; break; }
    t += d * 0.8;
    if (t > 7.0) break;
  }

  vec3 col = vec3(0.0);

  if (hit) {
    vec3 n = calcNormal(p);
    vec3 dir = normalize(p);
    float theta = atan(dir.z, dir.x);
    float phi = acos(clamp(dir.y, -1.0, 1.0));

    float ft = fract(theta / 6.2831853 * u_gridTheta + 0.5);
    float fp = fract(phi / 3.14159265 * u_gridPhi + 0.5);
    float lineT = min(ft, 1.0 - ft);
    float lineP = min(fp, 1.0 - fp);

    // Vertex sharpness is coupled to line sharpness at a fixed ratio
    // (rather than a second exposed slider) so "Line sharpness" alone
    // controls overall crispness without two sliders needing to be
    // tuned in lockstep.
    float vertexSharp = u_lineSharpness * 0.629;
    float edge = exp(-lineT * lineT * u_lineSharpness) + exp(-lineP * lineP * u_lineSharpness);
    float vertex = exp(-(lineT * lineT + lineP * lineP) * vertexSharp) * u_vertexBrightness;
    float mesh = clamp(edge * 0.55 + vertex, 0.0, 1.0);

    float lightDiff = clamp(dot(n, normalize(vec3(0.4, 0.7, 0.4))), 0.0, 1.0);
    vec3 base = u_baseColor * (0.3 + lightDiff * 0.5);
    col = base + u_meshColor * mesh * u_meshBrightness;
  }

  fragColor = vec4(col, 1.0);
}
