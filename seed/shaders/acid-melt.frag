#version 300 es
precision highp float;

uniform vec2 u_resolution;
uniform float u_time;
uniform float u_seed;

// --- controls ---
uniform float u_warpAmount;  // @label(Warp Amount) @range(0, 3) @default(1.1) @mod
uniform float u_hueSpeed;    // @label(Hue Speed) @range(-2, 2) @default(0.35) @mod
uniform int u_segments;      // @label(Kaleidoscope Segments) @range(2, 16) @default(6)
uniform float u_scale;       // @label(Scale) @range(0.5, 6) @default(2.2)
uniform vec3 u_baseColor;    // @label(Base Color) @color @default(1.0, 0.2, 0.8)

out vec4 fragColor;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 5; i++) {
    v += amp * noise(p);
    p *= 2.02;
    amp *= 0.55;
  }
  return v;
}

vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / u_resolution.y;

  // Kaleidoscope fold.
  float ang = atan(uv.y, uv.x);
  float rad = length(uv);
  float segAngle = 3.14159265 * 2.0 / max(float(u_segments), 1.0);
  ang = mod(ang, segAngle);
  ang = abs(ang - segAngle * 0.5);
  uv = vec2(cos(ang), sin(ang)) * rad;

  vec2 p = uv * u_scale + u_seed * 0.1;

  // Domain warp — two fbm passes feeding into a third, classic melt technique.
  vec2 warpA = vec2(fbm(p + u_time * 0.15), fbm(p + vec2(5.2, 1.3) + u_time * 0.1));
  vec2 warpB = vec2(
    fbm(p + u_warpAmount * warpA + vec2(1.7, 9.2) - u_time * 0.08),
    fbm(p + u_warpAmount * warpA + vec2(8.3, 2.8) + u_time * 0.12)
  );
  float field = fbm(p + u_warpAmount * warpB);

  float hue = fract(field + u_time * u_hueSpeed + rad * 0.3);
  vec3 hsvColor = hsv2rgb(vec3(hue, 0.85, 1.0));
  vec3 col = mix(hsvColor, u_baseColor, 0.15) * hsvColor;

  fragColor = vec4(col, 1.0);
}
