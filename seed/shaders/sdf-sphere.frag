#version 300 es
precision highp float;

/* sdf-sphere — raymarched displaced sphere with soft lighting.
   Centring now relies on u_resolution matching the actual viewport, which
   it did not before. */

uniform float u_time;
uniform vec2 u_resolution;

uniform float u_radius;        // @label(Radius) @range(0.2, 1.6) @default(0.9)
uniform float u_displace;      // @label(Displacement) @range(0, 0.4) @default(0.08)
uniform float u_ripples;       // @label(Ripple frequency) @range(1, 40) @default(8) @log
uniform float u_speed;         // @label(Speed) @range(0, 3) @default(0.7)
uniform int u_mode;            // @label(Surface) @select(Ripples=0 | Bulges=1 | Facets=2 | Noise=3) @default(0)
uniform vec3 u_lightDir;       // @label(Light direction) @range(-1, 1)
uniform vec2 u_orbit;          // @label(Camera orbit) @range(-1, 1) @group(Composition)
uniform float u_autoOrbit;     // @label(Auto orbit) @range(-1, 1) @default(0.08) @group(Composition)
uniform float u_fov;           // @label(Field of view) @range(0.5, 3) @default(1.5) @group(Composition)
uniform vec3 u_surface;        // @label(Surface) @color @default(0.06, 0.07, 0.09)
uniform vec3 u_rim;            // @label(Rim light) @color @default(0.0, 0.83, 1.0)
uniform float u_rimPower;      // @label(Rim falloff) @range(0.5, 8) @default(2.4)
uniform bool u_showNormals;    // @label(Debug normals) @default(false) @advanced

out vec4 fragColor;

float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }

float sdSphere(vec3 p) {
  float d = length(p) - u_radius;
  float t = u_time * u_speed;

  if (u_mode == 1) {
    d += sin(p.x * u_ripples + t) * sin(p.y * u_ripples - t) * sin(p.z * u_ripples) * u_displace;
  } else if (u_mode == 2) {
    vec3 q = abs(normalize(p + 1e-5));
    d += (max(q.x, max(q.y, q.z)) - 0.6) * u_displace * 2.0;
  } else if (u_mode == 3) {
    d += (hash(floor(normalize(p + 1e-5) * u_ripples)) - 0.5) * u_displace;
  } else {
    d += sin(p.y * u_ripples + t) * u_displace * 0.5;
    d += sin(p.x * u_ripples * 0.7 - t * 0.8) * u_displace * 0.5;
  }
  return d;
}

vec3 calcNormal(vec3 p) {
  vec2 e = vec2(0.0018, 0.0);
  return normalize(vec3(
    sdSphere(p + e.xyy) - sdSphere(p - e.xyy),
    sdSphere(p + e.yxy) - sdSphere(p - e.yxy),
    sdSphere(p + e.yyx) - sdSphere(p - e.yyx)));
}

mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

void main() {
  /* Centred normalised coordinates. Requires u_resolution to be the real
     viewport size — see ShaderRenderer for the clamp that guarantees it. */
  vec2 uv = (gl_FragCoord.xy * 2.0 - u_resolution) / min(u_resolution.x, u_resolution.y);

  vec3 ro = vec3(0.0, 0.0, 3.4);
  vec3 rd = normalize(vec3(uv * u_fov, -2.2));

  float spin = u_orbit.x * 3.14159 + u_time * u_autoOrbit;
  ro.yz *= rot(u_orbit.y * 1.5);
  rd.yz *= rot(u_orbit.y * 1.5);
  ro.xz *= rot(spin);
  rd.xz *= rot(spin);

  float t = 0.0;
  bool hit = false;
  for (int i = 0; i < 96; i++) {
    vec3 p = ro + rd * t;
    float d = sdSphere(p);
    if (d < 0.001) { hit = true; break; }
    if (t > 8.0) break;
    t += d * 0.7;
  }

  vec3 col = vec3(0.0);

  if (hit) {
    vec3 p = ro + rd * t;
    vec3 n = calcNormal(p);

    if (u_showNormals) { fragColor = vec4(n * 0.5 + 0.5, 1.0); return; }

    vec3 l = normalize(u_lightDir + vec3(0.0001, 0.4, 0.6));
    float diff = clamp(dot(n, l), 0.0, 1.0);
    float rim = pow(1.0 - clamp(dot(n, -rd), 0.0, 1.0), u_rimPower);
    float spec = pow(clamp(dot(reflect(-l, n), -rd), 0.0, 1.0), 32.0);

    col = u_surface * (0.15 + diff * 0.9) + u_rim * rim + vec3(spec) * 0.35;
  }

  fragColor = vec4(col, 1.0);
}
