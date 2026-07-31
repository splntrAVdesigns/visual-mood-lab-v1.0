#version 300 es
precision highp float;

/*
 * rorschach-metaball — mirrored metaballs that merge and separate like an
 * inkblot forming in real time.
 *
 * Metaballs are the classic case for signed distance fields: sum the
 * inverse-square influence of every source, then threshold. The merge
 * happens for free — two fields overlapping exceed the threshold in the gap
 * between them, so blobs reach for each other before they touch. Mirroring
 * the coordinate before evaluating (rather than mirroring the result after)
 * is what makes the seam invisible: the field itself is symmetric, so blobs
 * crossing the centre line merge with their own reflection.
 */

uniform float u_time;
uniform vec2 u_resolution;

uniform int u_count;          // @label(Blobs) @range(2, 12) @default(6)
uniform float u_radius;       // @label(Blob size) @range(0.02, 0.5) @default(0.16) @mod
uniform float u_threshold;    // @label(Threshold) @range(0.3, 3) @default(1) @log @mod @hint(Lower fuses blobs together; higher separates them.)
uniform float u_speed;        // @label(Motion speed) @range(0, 2) @default(0.35) @mod
uniform float u_spread;       // @label(Spread) @range(0.1, 1.2) @default(0.55)
uniform float u_seedOffset;   // @label(Arrangement) @range(0, 20) @default(3) @hint(Shifts the motion pattern of every blob.)

uniform bool u_mirrorX;       // @label(Mirror horizontally) @default(true)
uniform bool u_mirrorY;       // @label(Mirror vertically) @default(false)

uniform int u_style;          // @label(Style) @select(Filled=0 | Outline=1 | Contours=2) @default(0)
uniform float u_edgeWidth;    // @label(Edge width) @range(0.01, 0.4) @default(0.08)
uniform float u_contours;     // @label(Contour count) @range(2, 24) @default(7)

uniform vec3 u_inkColor;      // @label(Ink) @color @default(0.0, 0.83, 1.0)
uniform vec3 u_edgeColor;     // @label(Edge) @color @default(0.9, 0.3, 0.75)
uniform vec3 u_bg;            // @label(Paper) @color @default(0.0, 0.0, 0.01)

out vec4 fragColor;

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / min(u_resolution.x, u_resolution.y);

  // Mirror the COORDINATE, not the result — a symmetric field lets blobs
  // merge across the centre line instead of butting against a hard seam.
  if (u_mirrorX) uv.x = abs(uv.x);
  if (u_mirrorY) uv.y = abs(uv.y);

  float field = 0.0;
  float t = u_time * u_speed;

  for (int i = 0; i < 12; i++) {
    if (i >= u_count) break;
    float fi = float(i) + u_seedOffset;

    vec2 c = vec2(
      sin(t * (0.7 + fi * 0.13) + fi * 2.1),
      cos(t * (0.5 + fi * 0.17) + fi * 1.3)
    ) * u_spread;

    float d = length(uv - c);
    // Inverse-square influence, the standard metaball falloff.
    field += (u_radius * u_radius) / max(d * d, 1e-4);
  }

  float v = field / max(u_threshold, 0.001);

  vec3 col;
  float aa = fwidth(v) + 1e-4;

  if (u_style == 1) {
    float inner = smoothstep(1.0 - u_edgeWidth - aa, 1.0 - u_edgeWidth + aa, v);
    float outer = smoothstep(1.0 - aa, 1.0 + aa, v);
    float ring = clamp(inner - outer, 0.0, 1.0);
    col = mix(u_bg, u_edgeColor, ring);
  } else if (u_style == 2) {
    float bands = fract(v * u_contours);
    float ba = fwidth(bands) * 2.0 + 1e-4;
    float ring = 1.0 - smoothstep(u_edgeWidth - ba, u_edgeWidth + ba, abs(bands - 0.5) * 2.0);
    float inside = smoothstep(1.0 - aa, 1.0 + aa, v);
    col = mix(u_bg, mix(u_inkColor, u_edgeColor, ring), max(ring, inside * 0.25));
  } else {
    float inside = smoothstep(1.0 - aa, 1.0 + aa, v);
    float rim = clamp(smoothstep(1.0 - u_edgeWidth, 1.0, v) - inside, 0.0, 1.0);
    col = mix(u_bg, u_inkColor, inside);
    col = mix(col, u_edgeColor, rim);
  }

  fragColor = vec4(col, 1.0);
}
