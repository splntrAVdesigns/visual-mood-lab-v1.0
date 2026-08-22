#version 300 es
precision highp float;

/*
 * isometric-grid — extruding isometric blocks on a diamond lattice, each
 * with an animated height and classic 3-face isometric shading.
 *
 * REBUILT after four rounds of persistent jaggedness/seam reports that
 * survived several genuinely different fixes to the previous design (a
 * per-pixel search across multiple candidate cells, composited back to
 * front). Two real, specific issues were found and are fixed here:
 *
 *  1. Distance-scale calibration. The diamond and side-face boundaries
 *     were being measured with an ad-hoc scale factor rather than a
 *     properly gradient-normalized distance, which systematically
 *     under-antialiases edges by an amount that depends on the shape's
 *     aspect ratio. Fixed below with sdDiamond dividing by the L1
 *     gradient's true magnitude instead of an approximation.
 *
 *  2. Structural complexity. The previous version's defining difference
 *     from this library's OTHER hard-edged shader (Strobe Cut, confirmed
 *     clean) was a per-pixel loop searching several candidate cells and
 *     alpha-compositing whichever had coverage. That loop was rewritten
 *     three separate times (removing a kink-prone min(), removing an
 *     fwidth() call from inside divergent control flow, fixing a
 *     provably insufficient search depth) without resolving the report.
 *     Rather than a fifth variation on the same loop, this version has
 *     no loop at all: each pixel belongs to exactly one cell's
 *     rendering, the same single-shape-per-pixel structure Strobe Cut
 *     already uses successfully. The deliberate trade: a very tall
 *     block next to a much shorter one may not perfectly occlude it in
 *     extreme cases, in exchange for removing the entire class of
 *     multi-candidate-compositing complexity that every previous fix
 *     attempt was still operating inside of.
 */

uniform float u_time;
uniform vec2 u_resolution;

uniform float u_gridSize;        // @label(Grid size) @range(4, 24) @default(11) @hint(Tiles across the tile's shorter dimension.)
uniform float u_heightScale;     // @label(Height) @range(0, 1) @default(0.55) @mod @hint(How tall blocks get at their peak.)
uniform float u_pulseSpeed;      // @label(Pulse speed) @range(0, 2) @default(0.35) @mod
uniform float u_pulseScale;      // @label(Pulse scale) @range(0.5, 4) @default(1.4) @hint(Spatial scale of the height field driving the blocks.)
uniform float u_gap;             // @label(Block gap) @range(0, 0.3) @default(0.08)

uniform vec3 u_colorLow;         // @label(Color (low)) @color @default(0.05, 0.15, 0.3)
uniform vec3 u_colorHigh;        // @label(Color (high)) @color @default(0.1, 0.85, 0.95)
uniform vec3 u_bg;               // @label(Background) @color @default(0.02, 0.02, 0.05)
uniform float u_faceShadeSide;   // @label(Side shading) @range(0.2, 1) @default(0.55) @advanced @hint(How much darker the two side faces are than the top.)

out vec4 fragColor;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 3; i++) { v += a * noise(p); p *= 2.05; a *= 0.5; }
  return v;
}

float heightAt(vec2 cellId, float t) {
  return fbm(cellId * (0.35 / u_pulseScale) + t);
}

vec2 isoProject(vec2 cellId, float s) {
  return vec2((cellId.x - cellId.y) * 0.5, (cellId.x + cellId.y) * 0.25) * s;
}

vec2 isoUnproject(vec2 screen, float s) {
  vec2 n = screen / s;
  return vec2(n.x + 2.0 * n.y, 2.0 * n.y - n.x);
}

/* Diamond boundary as a properly gradient-normalized distance (negative
   inside, positive outside): the raw L1 expression |x|/halfW+|y|/halfH-1
   has gradient magnitude sqrt(1/halfW^2 + 1/halfH^2) everywhere, so
   dividing by exactly that (not an approximation like min(halfW,halfH))
   is what makes this behave as a true distance field regardless of the
   shape's aspect ratio — this matters here specifically because this
   diamond is elongated 2:1, unlike the square diamond Strobe Cut tests
   with, and the earlier approximation was calibrated for a case this
   shader doesn't actually use. */
float sdDiamond(vec2 p, vec2 halfSize) {
  float l1 = abs(p.x) / halfSize.x + abs(p.y) / halfSize.y - 1.0;
  float gradMag = sqrt(1.0 / (halfSize.x * halfSize.x) + 1.0 / (halfSize.y * halfSize.y));
  return l1 / gradMag;
}

/* Side-face band: bounded by two VERTICAL edges (x = x0, x = x1, true
   distance, gradient magnitude exactly 1 already) and two SLANTED edges
   parallel to the diamond's own boundary (the same fixed slope as
   halfH/halfW everywhere on this shape). The slanted pair's distance is
   measured vertically here for simplicity, then explicitly corrected by
   the same gradient-normalization idea as sdDiamond — dividing by
   sqrt(1+slope^2) — rather than left as an uncorrected approximation. */
float sdBand(vec2 p, float x0, float x1, float y0, float y1, float slope) {
  float dx = max(x0 - p.x, p.x - x1);
  float dyRaw = max(y0 - p.y, p.y - y1);
  float dy = dyRaw / sqrt(1.0 + slope * slope);
  return max(dx, dy);
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / min(u_resolution.x, u_resolution.y);

  float n = max(4.0, floor(u_gridSize + 0.5));
  float s = 1.7 / n;
  float halfW = s * 0.5 * (1.0 - u_gap);
  float halfH = s * 0.25 * (1.0 - u_gap);
  float slope = halfH / halfW;

  vec2 naiveCellF = isoUnproject(uv, s);
  vec2 cellId = floor(naiveCellF + 0.5);

  float h = heightAt(cellId, u_time * u_pulseSpeed) * u_heightScale;
  vec2 center = isoProject(cellId, s);
  vec2 local = uv - center;

  float topD = sdDiamond(local - vec2(0.0, h), vec2(halfW, halfH));

  float leftBaseY = -halfH * (1.0 + local.x / halfW);
  float leftD = sdBand(local, -halfW, 0.0, leftBaseY, leftBaseY + h, slope);
  float rightBaseY = halfH * (local.x / halfW - 1.0);
  float rightD = sdBand(local, 0.0, halfW, rightBaseY, rightBaseY + h, slope);

  float aa = (2.0 / min(u_resolution.x, u_resolution.y)) + 1e-4;
  float covTop = 1.0 - smoothstep(-aa, aa, topD);
  float covLeft = 1.0 - smoothstep(-aa, aa, leftD);
  float covRight = 1.0 - smoothstep(-aa, aa, rightD);
  float coverage = max(covTop, max(covLeft, covRight));

  float g0 = clamp(h / max(u_heightScale, 1e-4), 0.0, 1.0);
  vec3 faceCol = mix(u_colorLow, u_colorHigh, g0);
  if (covLeft > covTop && covLeft > covRight) faceCol *= u_faceShadeSide;
  else if (covRight > covTop && covRight > covLeft) faceCol *= u_faceShadeSide * 0.72;

  vec3 result = mix(u_bg, faceCol, coverage);

  fragColor = vec4(clamp(result, 0.0, 1.0), 1.0);
}
