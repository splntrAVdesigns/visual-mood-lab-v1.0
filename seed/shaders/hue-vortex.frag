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
uniform int u_pattern;  // @label(Pattern) @select(Swirl=0 | Spiral Bands=1 | Pinwheel=2) @default(0)
uniform vec3 u_tint;    // @label(Tint) @color @default(0.6, 0.9, 1.0)
uniform vec3 u_secondaryTint; // @label(Secondary Tint) @color @default(1.0, 0.3, 0.7)

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

  // Three pattern modes share the same rotation/radius inputs but combine
  // them differently:
  //   0 Swirl        — angle bends proportionally to radius (the original).
  //   1 Spiral Bands  — a tighter logarithmic spiral, reads as nested bands
  //                     curling inward rather than one continuous twist.
  //   2 Pinwheel      — no radius-dependent bend at all, just rotating
  //                     angular segments, so it reads as flat fan blades.
  float spiral;
  if (u_pattern == 1) {
    spiral = angle + log(radius + 0.05) * u_swirl * 1.5 - u_time * u_speed;
  } else if (u_pattern == 2) {
    spiral = angle * float(u_bands) * 0.5 - u_time * u_speed;
  } else {
    spiral = angle + radius * u_swirl - u_time * u_speed;
  }

  float hue = fract(spiral / 6.28318 + u_seed * 0.05);
  float bandPattern = sin(spiral * float(u_bands) - radius * 10.0);
  float bandMask = smoothstep(0.0, 0.15, bandPattern) - smoothstep(0.85, 1.0, bandPattern);

  vec3 hsvColor = hsv2rgb(vec3(hue, 0.9, 1.0));

  // Real tinting: the rainbow is now multiplied against a duotone made
  // from the two tint colors (angle-driven, so it sweeps around the wheel
  // the same way the rainbow does) rather than the old approach of adding
  // a single tint on top as a glow, which only ever brightened the center
  // and never actually recolored the body of the pattern.
  float tintMix = fract(spiral / 6.28318);
  vec3 duotone = mix(u_tint, u_secondaryTint, tintMix);
  vec3 col = mix(hsvColor, hsvColor * duotone * 1.4, 0.7) * mix(0.35, 1.0, bandMask);

  // Fake bloom, now colored from the duotone instead of a flat single tint.
  float glowAccum = 0.0;
  for (int i = 1; i <= 4; i++) {
    float fi = float(i);
    glowAccum += (1.0 / fi) * smoothstep(0.9 / fi, 0.0, radius * fi * 0.4);
  }
  col += duotone * glowAccum * u_glow;

  fragColor = vec4(col, 1.0);
}
