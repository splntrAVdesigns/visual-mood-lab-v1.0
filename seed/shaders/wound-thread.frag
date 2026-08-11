#version 300 es
precision highp float;

uniform vec2 u_resolution;
uniform float u_time;
uniform float u_seed;

// --- controls ---
uniform int u_branches;      // @label(Branches) @range(3, 12) @default(7)
uniform float u_thickness;   // @label(Thread Thickness) @range(0.001, 0.03) @default(0.008) @mod
uniform float u_wander;      // @label(Wander) @range(0, 1) @default(0.4) @mod
uniform float u_pulseRate;   // @label(Pulse Rate) @range(0.1, 2) @default(0.5) @hint(Synced to a slow heartbeat pulse.)
uniform vec3 u_threadColor;  // @label(Thread Color) @color @default(0.75, 0.15, 0.2)

out vec4 fragColor;

float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

// Distance from a point to a wandering line path, evaluated by marching along
// the path in fixed steps — an unrolled stand-in for recursive L-system growth.
float threadDist(vec2 uv, float branchId) {
  float seed = branchId * 17.13 + u_seed;
  vec2 origin = vec2(hash11(seed) - 0.5, hash11(seed + 1.0) - 0.5) * 0.3;
  float dir = hash11(seed + 2.0) * 6.28318;

  vec2 pos = origin;
  float minDist = 1e5;
  const int STEPS = 24;
  for (int i = 0; i < STEPS; i++) {
    float fi = float(i);
    float wobble = (hash11(seed + fi * 0.37) - 0.5) * u_wander;
    dir += wobble * 0.5;
    vec2 nextPos = pos + vec2(cos(dir), sin(dir)) * 0.03;

    // segment distance from uv to (pos, nextPos)
    vec2 seg = nextPos - pos;
    float segLen2 = max(dot(seg, seg), 1e-6);
    float t = clamp(dot(uv - pos, seg) / segLen2, 0.0, 1.0);
    vec2 closest = pos + seg * t;
    minDist = min(minDist, length(uv - closest));

    pos = nextPos;
  }
  return minDist;
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / u_resolution.y;

  float field = 1e5;
  for (int b = 0; b < 12; b++) {
    if (b >= u_branches) break;
    field = min(field, threadDist(uv, float(b)));
  }

  float pulse = 0.6 + 0.4 * pow(0.5 + 0.5 * sin(u_time * u_pulseRate * 6.28318), 3.0);
  float thickness = u_thickness * pulse;

  float mask = smoothstep(thickness * 2.0, thickness * 0.3, field);
  vec3 col = u_threadColor * mask * pulse;

  // Faint bloom around the threads, pulsing in sync.
  col += u_threadColor * 0.3 * smoothstep(thickness * 6.0, thickness * 2.0, field) * pulse * 0.3;

  fragColor = vec4(col, 1.0);
}
