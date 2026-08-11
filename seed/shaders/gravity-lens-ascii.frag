#version 300 es
precision highp float;

uniform vec2 u_resolution;
uniform float u_time;
uniform float u_seed;

// --- controls ---
uniform float u_orbitSpeed;   // @label(Singularity Orbit Speed) @range(0, 2) @default(0.25) @mod
uniform float u_orbitRadius;  // @label(Orbit Radius) @range(0, 1) @default(0.35)
uniform float u_lensStrength; // @label(Lens Strength) @range(0, 0.5) @default(0.08) @mod
uniform int u_density;        // @label(Star Grid Density) @range(10, 60) @default(28)
uniform vec3 u_starColor;     // @label(Star Color) @color @default(0.85, 0.9, 1.0)

out vec4 fragColor;

float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// Same procedural "glyph" cell trick as digital-matrix — small hashed bars per cell,
// reused here so the two glyph-based assets share a visual language without duplicating a texture.
float glyphMask(vec2 cellUv, float id) {
  float m = 0.0;
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    float on = step(0.45, hash21(vec2(id, fi)));
    float y = (fi + 0.5) / 4.0;
    float w = 0.2 + 0.4 * hash21(vec2(id + fi, fi));
    m = max(m, on * smoothstep(w * 0.5, 0.0, abs(cellUv.x - 0.5))
                  * smoothstep(0.1, 0.0, abs(cellUv.y - y)));
  }
  return m;
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / u_resolution.y;

  vec2 singularity = u_orbitRadius * vec2(
    cos(u_time * u_orbitSpeed + u_seed),
    sin(u_time * u_orbitSpeed * 0.8 + u_seed)
  );

  // Gravitational lensing: bend the sample coordinate around the singularity.
  vec2 toSing = uv - singularity;
  float d2 = dot(toSing, toSing) + 0.01;
  vec2 lensedUv = uv + u_lensStrength * toSing / d2;

  // Star grid sampled at the lensed coordinate — characters bend because the
  // grid itself is warped, not because brightness is remapped after the fact.
  vec2 grid = lensedUv * float(u_density);
  vec2 cellId = floor(grid);
  vec2 cellUv = fract(grid);

  float starChance = hash21(cellId);
  float isStar = step(0.86, starChance);
  float glyphId = floor(u_time * 0.6 + hash21(cellId + 7.0) * 40.0);
  float g = glyphMask(cellUv, glyphId) * isStar;

  float twinkle = 0.6 + 0.4 * sin(u_time * (2.0 + starChance * 5.0) + starChance * 30.0);

  // Faint halo right at the singularity itself.
  float halo = 0.02 / d2;

  vec3 col = u_starColor * g * twinkle + u_starColor * halo * 0.15;

  fragColor = vec4(col, 1.0);
}
