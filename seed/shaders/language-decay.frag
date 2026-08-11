#version 300 es
precision highp float;

uniform vec2 u_resolution;
uniform float u_time;
uniform float u_seed;

// --- controls ---
uniform float u_scale;       // @label(Glyph Scale) @range(2, 20) @default(8.0)
uniform float u_driftSpeed;  // @label(Drift Speed) @range(0, 1) @default(0.08) @mod
uniform float u_cycleSpeed;  // @label(Erode / Reform Cycle) @range(0, 1) @default(0.15) @mod
uniform float u_edgeSoft;    // @label(Edge Softness) @range(0.01, 0.3) @default(0.06)
uniform vec3 u_glyphColor;   // @label(Glyph Color) @color @default(0.7, 0.95, 0.5)

out vec4 fragColor;

float hash(vec2 p) {
  p = fract(p * vec2(127.1, 311.7));
  p += dot(p, p + 34.45);
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
  float amp = 0.55;
  for (int i = 0; i < 5; i++) {
    v += amp * noise(p);
    p = p * 2.05 + vec2(4.7, 1.3);
    amp *= 0.55;
  }
  return v;
}

// Sharpened noise field so it reads as glyph-like structure rather than a soft cloud.
float glyphField(vec2 uv) {
  vec2 p = uv * u_scale + u_seed;
  p += vec2(u_time * u_driftSpeed, -u_time * u_driftSpeed * 0.6);
  float base = fbm(p);
  float fine = fbm(p * 3.1 + 9.0);
  float structured = base + 0.3 * (fine - 0.5);
  return structured;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;

  float field = glyphField(uv);

  // The erosion/reform breathing: the threshold band itself slides over time,
  // so structure appears, holds, and dissolves without a feedback buffer.
  float bandCenter = 0.5 + 0.18 * sin(u_time * u_cycleSpeed + u_seed);
  float glyph = smoothstep(bandCenter - u_edgeSoft, bandCenter, field)
              - smoothstep(bandCenter, bandCenter + u_edgeSoft, field);
  glyph = clamp(glyph * 2.0, 0.0, 1.0);

  // A second, faster-drifting layer to read as "reforming into something new".
  float field2 = glyphField(uv * 1.7 + 30.0);
  float band2 = 0.5 + 0.15 * cos(u_time * u_cycleSpeed * 1.3 - u_seed);
  float glyph2 = smoothstep(band2 - u_edgeSoft, band2, field2)
               - smoothstep(band2, band2 + u_edgeSoft, field2);

  float mask = max(glyph, glyph2 * 0.6);

  vec3 col = u_glyphColor * mask;
  col += u_glyphColor * 0.05 * field; // faint ambient structure beneath the legible band

  fragColor = vec4(col, 1.0);
}
