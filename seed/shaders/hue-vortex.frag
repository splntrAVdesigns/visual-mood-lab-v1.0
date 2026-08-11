#version 300 es
precision highp float;

uniform vec2 u_resolution;
uniform float u_time;
uniform float u_seed;

// --- controls ---
uniform float u_swirl;  // @label(Swirl Strength) @range(0, 8) @default(3.2) @mod
uniform float u_speed;  // @label(Rotation Speed) @range(-2, 2) @default(0.5) @mod
uniform int u_bands;    // @label(Bands) @range(1, 24) @default(9)
uniform float u_glow;   // @label(Glow) @range(0, 1) @default(0.5)
uniform vec3 u_tint;    // @label(Tint) @color @default(0.6, 0.9, 1.0)

out vec4 fragColor;

vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / u_resolution.y;
  float radius = length(uv);
  float angle = atan(uv.y, uv.x);

  // Spiral warp: angle shifts with radius, radius shifts with time.
  float spiral = angle + radius * u_swirl - u_time * u_speed;

  float hue = fract(spiral / 6.28318 + u_seed * 0.05);
  float bandPattern = sin(spiral * float(u_bands) - radius * 10.0);
  float bandMask = smoothstep(0.0, 0.15, bandPattern) - smoothstep(0.85, 1.0, bandPattern);

  vec3 hsvColor = hsv2rgb(vec3(hue, 0.9, 1.0));

  // Fake bloom: sum a few widened radial falloffs at increasing scale.
  float glowAccum = 0.0;
  for (int i = 1; i <= 4; i++) {
    float fi = float(i);
    glowAccum += (1.0 / fi) * smoothstep(0.9 / fi, 0.0, radius * fi * 0.4);
  }
  glowAccum *= u_glow;

  vec3 col = hsvColor * mix(0.35, 1.0, bandMask) + u_tint * glowAccum;

  fragColor = vec4(col, 1.0);
}
