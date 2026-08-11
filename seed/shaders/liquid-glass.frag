#version 300 es
precision highp float;

uniform vec2 u_resolution;
uniform float u_time;
uniform float u_seed;

// --- controls ---
// Fully self-animating — no pointer input, by design (see sprint notes).
uniform float u_refraction;   // @label(Refraction) @range(0, 1) @default(0.4) @mod
uniform float u_dispersion;   // @label(Chromatic Dispersion) @range(0, 0.05) @default(0.012)
uniform float u_blobSpeed;    // @label(Blob Speed) @range(0, 2) @default(0.6) @mod
uniform int u_reflections;    // @label(Fractal Reflections) @range(0, 6) @default(3)
uniform bool u_frost;         // @label(Frosted) @default(false)
uniform vec3 u_glassTint;     // @label(Glass Tint) @color @default(0.7, 0.85, 1.0)

out vec4 fragColor;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

// Sum of animated metaballs — a self-evolving color field, no external input.
float metaballField(vec2 uv, float t) {
  float field = 0.0;
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    float orbitR = 0.35 + 0.1 * sin(t * 0.3 + fi * 2.1);
    vec2 center = orbitR * vec2(
      cos(t * u_blobSpeed * (0.7 + 0.2 * fi) + fi * 2.4 + u_seed),
      sin(t * u_blobSpeed * (0.5 + 0.3 * fi) + fi * 1.7 + u_seed)
    );
    float d = length(uv - center);
    field += 0.045 / (d * d + 0.01);
  }
  return field;
}

vec3 fieldColor(float f, float t) {
  vec3 a = vec3(0.15, 0.05, 0.3);
  vec3 b = vec3(0.9, 0.3, 0.6);
  vec3 c = vec3(0.2, 0.7, 0.9);
  float m = clamp(f, 0.0, 1.0);
  vec3 col = mix(a, b, smoothstep(0.0, 0.6, m));
  col = mix(col, c, smoothstep(0.4, 1.0, m) * (0.5 + 0.5 * sin(t * 0.4)));
  return col;
}

// Recursive-ish domain fold for fractal reflections — a few unrolled iterations.
vec2 foldSpace(vec2 uv, int iterations) {
  for (int i = 0; i < 6; i++) {
    if (i >= iterations) break;
    uv = abs(uv) - 0.35;
    float a = 0.6 + float(i) * 0.15;
    mat2 rot = mat2(cos(a), -sin(a), sin(a), cos(a));
    uv = rot * uv;
  }
  return uv;
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / u_resolution.y;

  // Base field (behind the glass).
  float baseField = metaballField(uv, u_time);

  // Refraction: displace the lookup using the field's local gradient.
  float eps = 0.01;
  float gx = metaballField(uv + vec2(eps, 0.0), u_time) - baseField;
  float gy = metaballField(uv + vec2(0.0, eps), u_time) - baseField;
  vec2 refractedUv = uv - vec2(gx, gy) * u_refraction * 4.0;

  // Chromatic dispersion: sample the field per-channel at slightly offset UVs.
  float fieldR = metaballField(refractedUv + vec2(u_dispersion, 0.0), u_time);
  float fieldG = metaballField(refractedUv, u_time);
  float fieldB = metaballField(refractedUv - vec2(u_dispersion, 0.0), u_time);

  vec3 colR = fieldColor(fieldR, u_time);
  vec3 colG = fieldColor(fieldG, u_time);
  vec3 colB = fieldColor(fieldB, u_time);
  vec3 col = vec3(colR.r, colG.g, colB.b);

  // Fractal reflections: fold space, sample field again, blend in as a highlight layer.
  vec2 folded = foldSpace(refractedUv * 1.4, u_reflections);
  float reflField = metaballField(folded, u_time * 0.8 + 3.0);
  vec3 reflColor = fieldColor(reflField, u_time) * u_glassTint;
  col = mix(col, col + reflColor * 0.4, 0.5);

  if (u_frost) {
    float grain = hash(gl_FragCoord.xy * 0.3 + u_time * 60.0) * 0.06 - 0.03;
    col += grain;
    col = mix(col, vec3(dot(col, vec3(0.33))), 0.15);
  }

  // Subtle glass edge glow using the tint.
  col += u_glassTint * 0.05 * smoothstep(0.0, 1.0, baseField);

  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
