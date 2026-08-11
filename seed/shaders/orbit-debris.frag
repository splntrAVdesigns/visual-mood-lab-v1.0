#version 300 es
precision highp float;

uniform vec2 u_resolution;
uniform float u_time;
uniform float u_seed;

// --- controls ---
uniform int u_pieces;         // @label(Debris Pieces) @range(2, 8) @default(5)
uniform float u_orbitRadius;  // @label(Orbit Radius) @range(0.5, 3) @default(1.6)
uniform float u_decayRate;    // @label(Decay Rate) @range(0, 1) @default(0.06) @mod
uniform float u_tumbleSpeed;  // @label(Tumble Speed) @range(0, 2) @default(0.7) @mod
uniform vec3 u_debrisColor;   // @label(Debris Color) @color @default(0.55, 0.6, 0.65)

out vec4 fragColor;

mat3 rotX(float a) {
  float s = sin(a), c = cos(a);
  return mat3(1.0, 0.0, 0.0, 0.0, c, -s, 0.0, s, c);
}
mat3 rotY(float a) {
  float s = sin(a), c = cos(a);
  return mat3(c, 0.0, s, 0.0, 1.0, 0.0, -s, 0.0, c);
}

float sdBox(vec3 p, vec3 b) {
  vec3 q = abs(p) - b;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
}

float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

float map(vec3 p) {
  float radius = u_orbitRadius * (0.75 + 0.25 * sin(u_time * u_decayRate + u_seed));
  float d = 1e5;
  for (int i = 0; i < 8; i++) {
    if (i >= u_pieces) break;
    float fi = float(i);
    float orbitAngle = u_time * (0.15 + 0.05 * fi) + fi * 2.4 + u_seed;
    vec3 center = radius * vec3(cos(orbitAngle), sin(orbitAngle * 0.6), sin(orbitAngle));

    vec3 lp = p - center;
    float tumble = u_time * u_tumbleSpeed * (0.5 + hash11(fi)) + fi * 5.0;
    lp = rotY(tumble) * rotX(tumble * 0.7) * lp;

    vec3 size = vec3(0.12 + 0.06 * hash11(fi + 1.0),
                      0.08 + 0.05 * hash11(fi + 2.0),
                      0.1 + 0.04 * hash11(fi + 3.0));
    d = min(d, sdBox(lp, size));
  }
  return d;
}

vec3 calcNormal(vec3 p) {
  vec2 e = vec2(0.001, 0.0);
  return normalize(vec3(
    map(p + e.xyy) - map(p - e.xyy),
    map(p + e.yxy) - map(p - e.yxy),
    map(p + e.yyx) - map(p - e.yyx)
  ));
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / u_resolution.y;

  vec3 ro = vec3(0.0, 0.0, -4.0);
  vec3 rd = normalize(vec3(uv, 1.4));

  float t = 0.0;
  vec3 col = mix(vec3(0.01, 0.01, 0.015), vec3(0.04, 0.05, 0.07), length(uv));
  bool hit = false;

  for (int i = 0; i < 64; i++) {
    vec3 p = ro + rd * t;
    float d = map(p);
    if (d < 0.001) { hit = true; break; }
    t += d;
    if (t > 12.0) break;
  }

  if (hit) {
    vec3 p = ro + rd * t;
    vec3 n = calcNormal(p);
    vec3 lightDir = normalize(vec3(0.5, 0.8, -0.4));
    float diff = clamp(dot(n, lightDir), 0.0, 1.0);
    float rim = pow(1.0 - clamp(dot(n, -rd), 0.0, 1.0), 2.0);
    col = u_debrisColor * (0.15 + diff * 0.85) + vec3(0.3, 0.4, 0.5) * rim * 0.3;
  }

  fragColor = vec4(col, 1.0);
}
