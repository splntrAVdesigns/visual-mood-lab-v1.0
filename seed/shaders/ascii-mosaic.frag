#version 300 es
precision highp float;

/* ascii-mosaic — luminance quantised into a procedural bitmap glyph set.
   No font atlas: glyphs are bit-packed into integers, so the shader is
   self-contained and the "font" is part of the source. */

uniform float u_time;
uniform vec2 u_resolution;

uniform sampler2D u_src;       // @label(Source)
uniform float u_cell;          // @label(Cell size) @range(4, 48) @default(12) @log @unit(px)
uniform int u_levels;          // @label(Glyph levels) @range(2, 8) @default(6)
uniform float u_contrast;      // @label(Contrast) @range(0.25, 4) @default(1.4) @log
uniform float u_gamma;         // @label(Gamma) @range(0.25, 3) @default(1) @advanced
uniform vec3 u_ink;            // @label(Ink) @color @default(0.0, 0.83, 1.0)
uniform vec3 u_paper;          // @label(Paper) @color @default(0.0, 0.0, 0.0)
uniform bool u_invert;         // @label(Invert) @default(false)
uniform bool u_colorFromSource; // @label(Tint from source) @default(true)
uniform float u_scanJitter;    // @label(Scan jitter) @range(0, 1) @default(0) @advanced @nomod

out vec4 fragColor;

/* 5x5 glyphs packed low-bit-first into 25 bits, ordered light -> dark. */
int glyphAt(int level) {
  if (level <= 0) return 0;                 /* blank   */
  if (level == 1) return 1048576;           /* dot     */
  if (level == 2) return 1116704;           /* colon   */
  if (level == 3) return 4329604;           /* plus    */
  if (level == 4) return 11512810;          /* star    */
  if (level == 5) return 32505856;          /* dense   */
  if (level == 6) return 33532415;          /* denser  */
  return 33554431;                          /* block   */
}

float glyphMask(int level, vec2 p) {
  ivec2 g = ivec2(floor(p * 5.0));
  if (g.x < 0 || g.x > 4 || g.y < 0 || g.y > 4) return 0.0;
  int bit = g.y * 5 + g.x;
  int bits = glyphAt(level);
  return float((bits >> bit) & 1);
}

void main() {
  vec2 cell = vec2(u_cell) / u_resolution;
  vec2 cellId = floor(gl_FragCoord.xy / u_cell);
  vec2 cellUv = fract(gl_FragCoord.xy / u_cell);

  vec2 sampleUv = (cellId + 0.5) * cell;
  sampleUv.x += sin(cellId.y * 3.7 + u_time) * u_scanJitter * cell.x * 2.0;

  vec3 src = texture(u_src, sampleUv).rgb;
  float lum = dot(src, vec3(0.2126, 0.7152, 0.0722));

  lum = pow(clamp((lum - 0.5) * u_contrast + 0.5, 0.0, 1.0), u_gamma);
  if (u_invert) lum = 1.0 - lum;

  int level = int(floor(lum * float(u_levels) + 0.5));
  float mask = glyphMask(level, cellUv);

  vec3 ink = u_colorFromSource ? src : u_ink;
  fragColor = vec4(mix(u_paper, ink, mask), 1.0);
}
